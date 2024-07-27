import {
    ProposerSelectorLogic,
    DummyProposerSelectorLogic,
    Signal
} from "./world"

import {
    ProposeMessage,
    VoteMessage,
    TimeoutMessage,
} from "./messages";

import { Data, Block } from "./data";
import { FakeCommitCertificate } from "./commitCertif";
import type { Orchestrator } from "./world";

export class Peer {
    name: string;
    knownPeers: Peer[];
    orchestrator: Orchestrator;

    replica = new Replica(this);

    constructor(name: string, orchestrator: Orchestrator) {
        this.name = name;
        this.knownPeers = [this];
        this.orchestrator = orchestrator;
    }

    addPeer(peer: Peer) {
        this.knownPeers.push(peer);
    }

    removePeer(peer: Peer) {
        this.knownPeers = this.knownPeers.filter(p => p !== peer);
    }

    processSignal(signal: Signal) {
        this.replica.processSignal(signal);
    }
}

class Replica {
    peer: Peer;
    proposerSelectorLogic: ProposerSelectorLogic;

    byzantine = false;

    // Configurability
    timeoutDelay = 100; // number of 'ticks' to wait to enter timeout.
    broadcastTimeout = true; // whether to broadcast timeout messages or just send them to the expected next leader.

    // Actually part of the BFT logic below
    lastVoteTime = 0;
    lastVoteLevel = 0;

    proposalsVoted = new Map<number, ProposeMessage>();
    votesReceived = new Map<number, Set<Peer>>();

    // TODO: this could actually be merged with votesReceived I believe.
    timeoutsReceived = new Map<number, Set<Peer>>();

    // The committed chain - this can actually have holes, conceptually, for blocks we haven't seen but we know must be there.
    committedChain = new Map<number, Block>(); // level -> block

    // Not BFT logic core below
    // internal optimisation
    hasProposedBlock = new Map<number, boolean>();

    constructor(peer: Peer) {
        this.peer = peer;
        this.proposerSelectorLogic = new DummyProposerSelectorLogic();
    }

    tick() {
        this.lastVoteTime++;
        // If the time since our last vote has gotten too high, we can assume
        // that the next leader proposer is byzantine.
        // This is a "timeout".
        // The procedure is to broadcast a message to all saying we're timing out.
        if (this.lastVoteTime >= this.timeoutDelay) {
            const message = new TimeoutMessage(this.peer, this.lastVoteLevel, undefined);
            if (this.broadcastTimeout)
                this.peer.knownPeers.forEach(p => {
                    const signal = new Signal(this.peer, p, message);
                    this.peer.orchestrator.addSignal(signal);
                });
            else
                this.peer.orchestrator.addSignal(new Signal(this.peer, this.proposerSelectorLogic.getProposer(this.lastVoteLevel + 2), message));
            // This counts as a "nil vote" for the proposal at the next level
            this.lastVoteTime = 0;
            this.lastVoteLevel = this.lastVoteLevel + 1;
        }
    }

    processSignal(signal: Signal) {
        try {
            if (signal.message instanceof ProposeMessage) {
                this.propose(signal.message);
            } else if (signal.message instanceof VoteMessage) {
                this.vote(signal.message);
            } else if (signal.message instanceof TimeoutMessage) {
                this.onTimeout(signal.message);
            }
        } catch (e) {
            console.error("Error processing signal", e.toString());
        }
    }

    propose(signal: ProposeMessage) {
        console.debug(`${this.peer.name} received propose message`);

        if (this.byzantine)
            return;

        // Safety checks
        if (!signal.commitCertificate)
            return; // TODO: handle genesis block?

        // validity - sender is the leader at this height
        if (signal.sender != this.proposerSelectorLogic.getProposer(signal.level))
            throw new Error("Invalid proposer");

        // consistency - Actually on the right level
        if (signal.level != signal.commitCertificate!.getLevel() + 1)
            throw new Error("Level mismatch");

        // validity - Certificate is valid (enough signatures)
        if (!signal.commitCertificate!.checkCertificate(this.proposerSelectorLogic.getAllPeers(signal.level - 1).length)) {
            console.warn(signal.commitCertificate.peers.size)
            throw new Error(`Invalid commit certificate at level ${signal.level}`);
        }

        // non equivocation - did we vote for a different proposal at this level already ?
        if (this.proposalsVoted.has(signal.level)) // this doesn't actually check for "different", it should
            throw new Error("Already voted for a proposal at this level");
        // If I have already voted at a higher level proposal, ignore.
        if (this.lastVoteLevel > signal.level)
            throw new Error(`Peer ${this.peer.name} already voted at a higher level ${this.lastVoteLevel}`);

        // validity - certificate builds on top of the last committed value (level - 2)
        // TODO: this is actually kind of annoying to write

        /// validity - block is itself valid - this is checkTx in cosmos SDK - we ignore it for this simulation for now.

        // We are free to vote !
        this.proposalsVoted.set(signal.level, signal);
        this.lastVoteTime = 0;
        this.lastVoteLevel = signal.level;

        // We can safely commit the level-2th block now
        if (signal.level - 2 >= 0) { // small initialization special case cause lazyness
            const commitBlock = this.proposalsVoted.get(signal.level - 2)?.data; // this is doing double-duty
            if (commitBlock) {
                this.committedChain.set(signal.level - 2, commitBlock as Block);
                console.info("Peer ", this.peer.name, "committed block at level", signal.level - 2, "with value", commitBlock.value);
            } else {
                console.error("Peer ", this.peer.name, "could not find block to commit at level", signal.level - 2);
            }
        }

        const vote = new VoteMessage(this.peer, signal);
        // V1: send directly to the target peer
        if (true) {
            const voteSignal = new Signal(this.peer, this.proposerSelectorLogic.getProposer(signal.level + 1), vote);
            this.peer.orchestrator.addSignal(voteSignal);
        }
    }

    vote(signal: VoteMessage) {
        console.debug(`${this.peer.name} received vote message`);

        if (this.byzantine)
            return;

        // We technically ought store all these, but I think we can mostly ignore that.
        if (!this.proposerSelectorLogic.isProposer(signal.propose.level + 1, this.peer))
            return;

        this.votesReceived.set(signal.propose.level, this.votesReceived.get(signal.propose.level) || new Set());
        this.votesReceived.get(signal.propose.level)!.add(signal.sender);

        const totalPeers = this.proposerSelectorLogic.getAllPeers(signal.propose.level).length;
        if (this.votesReceived.get(signal.propose.level)!.size >= Math.floor(2 * totalPeers / 3) + 1) {
            // We have a commit certificate !
            // Propose a new block - check that we're not re-proposing old blocks, but this is an optimisation only (I think).
            if (!this.hasProposedBlock.get(signal.propose.level + 1)) {
                const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
                this.proposeNewBlock(signal.propose.level + 1, randomLetter, signal.propose.data);
                this.hasProposedBlock.set(signal.propose.level + 1, true);
            }
        }
    }

    proposeNewBlock(level: number, value: string, cheat?: Data<any>) {
        let buildOnTopOf = this.proposalsVoted.get(level - 1)?.data;
        // So we might not actually have seen this proposition, despite having received enough votes for it.
        // In this case, we'd need to make sure we can build on top of it (e.g. having the hash or something).
        // In my simulation, I can cheat.
        if (!buildOnTopOf)
            buildOnTopOf = cheat;

        // Construct the new block
        const block = new Block(value, buildOnTopOf as Block);

        const message = new ProposeMessage(this.peer, block, level);
        if ((this.votesReceived.get(level - 1)?.size ?? 0) > (this.timeoutsReceived.get(level - 2)?.size ?? 0)) {
            console.info("Peer ", this.peer.name, "proposed level", level, "message with value", value)
            message.withCommit(new FakeCommitCertificate(level - 1, buildOnTopOf as Block, this.votesReceived.get(level - 1)!));
        } else {
            console.info("Peer ", this.peer.name, "proposed level", level, "message with value", value, "following a timeout")
            message.withCommit(new FakeCommitCertificate(level - 1, buildOnTopOf as Block, this.timeoutsReceived.get(level - 2)!));
        }

        // broadcast
        this.peer.knownPeers.forEach(p => {
            const signal = new Signal(this.peer, p, message);
            this.peer.orchestrator.addSignal(signal);
        });
    }

    onTimeout(signal: TimeoutMessage) {
        console.debug(`${this.peer.name} received timeout message`);

        this.timeoutsReceived.set(signal.level, this.timeoutsReceived.get(signal.level) || new Set());
        this.timeoutsReceived.get(signal.level)!.add(signal.sender);

        if (this.byzantine)
            return;

        if (this.lastVoteLevel - 1 > signal.level)
            return; // we've already voted at a higher level, so ignore this past timeout info.

        // We are receiving timeouts at signal.level, so the assumption is that the proposer for signal.level + 1 is byzantine.

        // If we have received f+1 timeouts, we know that we'll timeout - people won't equivocate on a timeout,
        // so we'll never have 2f+1 votes for a block at this level. Enter timeout right away.
        // (I believe the literature calls this a Bracha echo broadcast).
        // (this isn't a massive optimisation but it cuts down latency a bit)
        const totalPeersAtTimeoutLevel = this.proposerSelectorLogic.getAllPeers(signal.level + 1).length;
        if (this.lastVoteLevel < signal.level + 1 && this.timeoutsReceived.get(signal.level)!.size >= Math.floor(totalPeersAtTimeoutLevel / 3) + 1)
            this.lastVoteTime = 100; // implementation trick - we'll do it next time.

        // If we're the proposer for the level twice after the timeout, we can propose a new block.
        if (!this.proposerSelectorLogic.isProposer(signal.level + 2, this.peer))
            return;
        
        const totalPeers = this.proposerSelectorLogic.getAllPeers(signal.level + 2).length;
        if (this.timeoutsReceived.get(signal.level)!.size >= Math.floor(2 * totalPeers / 3) + 1) {
            // We have a timeout certificate !
            // Propose a new block
            if (!this.hasProposedBlock.get(signal.level + 2)) {
                // Craft a nil block at level + 1
                // Implementation note: If we don't actually know the hash of the block we'll 'break' the chain but I accept this for now.
                const nilBlock = new Block("", this.proposalsVoted.get(signal.level)?.data as Block || null);
                const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
                this.proposeNewBlock(signal.level + 2, randomLetter, nilBlock);
                this.hasProposedBlock.set(signal.level + 2, true);
            }
        }
    }
}