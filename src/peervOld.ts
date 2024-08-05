import {
    ProposerSelectorLogic,
    DummyProposerSelectorLogic,
    orchestrator,
    Signal
} from "./world"

import {
    ProposeMessage,
    VoteMessage,
    EnterMessage,
} from "./messages";

import { Data, Block } from "./data";
import { checkCCMatches, FakeCommitCertificate } from "./commitCertif";
import type { CommitCertificate } from "./commitCertif";

export class Peer {
    name: string;
    knownPeers: Peer[];

    replica = new Replica(this);

    constructor(name: string) {
        this.name = name;
        this.knownPeers = [this];
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

    // This is the view we're in. View "level - 1" is committed.
    level = 0;
    knownState = new Map<number, Block>();
    highestRoundVoted: number | null = null;
    highestSeenCC: CommitCertificate | null = null;

    // used by the leader to try and create a CC
    ccAggregator = new Set<Peer>();


    proposerSelectorLogic: ProposerSelectorLogic = new DummyProposerSelectorLogic();
    
    totalPeers = 0;
    bizantineOnPurpose = false;


    preEnterVotesPerLevel = new Map<number, { highestCC: CommitCertificate, signatures: Set<Peer> }>();
    ENTER_VOTE_EVERY = 100;
    timeSinceLastRotation = 0;

    // Technically these are all local, even if they're the same, but we don't care about that.
    time = 0;

    constructor(peer: Peer) {
        this.peer = peer;
    }

    tick() {
        this.time++;
        this.timeSinceLastRotation++;
        
        if (this.timeSinceLastRotation > orchestrator.DELTA * 6) {
            // Timeout - Enter the next level, and signal others for sync.
            this.timeSinceLastRotation = 0;
            this.enterLevel(this.level + 1, true);
            this.signalEnterLevel();
            this.enterLevel(this.level - 1, true);
            console.log("Peer ", this.peer.name, "timed out, expects level", this.level + 1)
        }
    }

    setTotalPeers(totalPeers: number) {
        this.totalPeers = totalPeers;
    }

    // Protocol core

    updateHighestCCProposal(cc: CommitCertificate) {
        if (this.highestSeenCC === null || cc.getLevel() > this.highestSeenCC.getLevel()) {
            this.highestSeenCC = cc;
        }
    }

    enterLevel(level: number, valueOnly = false) {
        const oldLevel = this.level;
        this.level = level;
        if (valueOnly)
            return;
        this.ccAggregator = new Set();
        this.timeSinceLastRotation = 0;
        if (this.level % this.ENTER_VOTE_EVERY === 0) {
            this.signalEnterLevel();
        }
    }

    signalEnterLevel() {
        // Technically I guess we could send this to the next proposer maybe ?
        const message = new EnterMessage(this.peer, this.level, this.highestSeenCC!); // TODO: assume not null by construction?
        this.peer.knownPeers.forEach(p => {
            const signal = new Signal(this.peer, p, message);
            orchestrator.addSignal(signal);
        });
    }

    handleProposeMessage(signal: Signal, mess: ProposeMessage) {
        
        // If the message doesn't have a CC, we don't care about it
        if (mess.commitCertificate === null) {
            return;
        }
        
        console.log(`Peer ${this.peer.name} (${this.level}) received propose message from ${mess.sender.name} at level ${mess.level} with value ${(mess.data as Block).value}`)

        // Check the message is from the leader we expect
        // NB: there's a decent chance that this is weird for the far past even for valid blocks?
        if (!this.proposerSelectorLogic.isProposer(mess.level, mess.sender)) {
            console.log("Not the proposer");
            return;
        }

        if (mess.level !== mess.commitCertificate.getLevel() + 1) {
            console.log("Level mismatch");
            return;
        }
        // TODO: I'm pretty sure we need to check that the block is actually a child of a block we know?

        // Check that the CC is well formed.
        mess.commitCertificate.checkCertificate(this.totalPeers);
        
        // At this point this is necessarily part of the valid branch by construction.
        // Save the block
        this.knownState.set(mess.level, mess.data as Block);

        this.updateHighestCCProposal(mess.commitCertificate);

        // Reset timer and advance maybe?
        if (mess.commitCertificate.getLevel() >= this.level) {
            this.enterLevel(mess.commitCertificate.getLevel() + 1);

            // We can commit the former block.
            // Two cases: either 2f+1 honest nodes will also receive this message, and this gets committed correctly
            // or not, and then we'll enter timeout.
            // Worst case, we are the only ones receiving it, we'll have a higher CC than everyone else, and send that to the leader during the timeout recovery phase.
            // NB: commit actually does nothing here so we do nothing.
            console.log("Peer ", this.peer.name, "committed level", this.level - 1, "message with value", this.knownState.get(this.level - 1)?.value);
        }

        // Then check if we should vote for this proposal.

        // Checks:
        // - message is for the expected level (we might be on the wrong level but that's kronk for you)
        // NB: we've done that check above.

        // - We've already checked that the CC was correct.

        // - this proposal is not in conflict with the last proposal we voted for
        // (either a higher level proposition, or the same exact thing)
        if ((this.highestRoundVoted || 0) >= mess.level) {
            // Check that this isn't the proposition we voted for
            if (!this.knownState.get(mess.level)?.isSame(mess.data as Block))
            {
                console.log("Already voted for a higher level");
                return;
            }
        }

        this.highestRoundVoted = mess.level;

        const vote = new VoteMessage(this.peer, mess);
        // V1: send directly to the target peer
        if (true) {
            const signal = new Signal(this.peer, this.proposerSelectorLogic.getProposer(this.level + 1), vote);
            orchestrator.addSignal(signal);
        } else {
            // vGossip: send to all known peers and hope it'll land on the proposer
            console.log("Peer ", this.peer.name, "voted for level", mess.level, "message with value", (mess.data as Block).value)
            this.peer.knownPeers.forEach(p => {
                const signal = new Signal(this.peer, p, vote);
                orchestrator.addSignal(signal);
            });
        }
    }

    handleVoteMessage(signal: Signal, mess: VoteMessage) {
        // Check what level this vote is for
        const voteLevel = mess.propose.level;
        if (voteLevel !== this.level) {
            return;
        }

        // Only if we are proposer of the next round (aka committer of the current round) do we act
        if (!this.proposerSelectorLogic.isProposer(voteLevel + 1, this.peer)) {
            return;
        }
        
        this.ccAggregator.add(signal.from);
        this.ccAggregator.add(this.peer); // always add ourselves as a simple optimisation

        console.log(`Peer ${this.peer.name} (${this.level}) received vote message from ${mess.sender.name} at level ${mess.propose.level} with value ${mess.propose.data.value}`)
        console.log("Peer ", this.peer.name, ", at level", this.level, "has", this.ccAggregator.size, "votes")

        // If we don't know the block, we haven't received it yet - QUERY IT
        // (for the purposes here, we assume we'll eventually get it)
        if (this.knownState.get(voteLevel) === undefined) {
            console.log(`Peer ${this.peer.name} (${this.level}) doesn't know the block for level ${voteLevel}, querying`)
            return;
        }
        // If we have a BFT majority, propose the next value
        if (this.ccAggregator.size >= Math.floor(2 * this.totalPeers / 3) + 1) {
            try {
            const lastData = this.knownState.get(this.level)!;
            this.enterLevel(this.level + 1);
            // Propose the next letter
            this.propose(String.fromCharCode(lastData.value.charCodeAt(0) + 1));
            } catch (e) {
                console.log("Error", e);
                console.log("State", this.knownState);
                throw e;
            }
        }
    }

    propose(value: string) {
        // logical assert for my simulation
        if (!this.proposerSelectorLogic.isProposer(this.level, this.peer)) {
            throw new Error("Not the proposer");
        }

        // Construct the block
        const block = new Block(value, this.knownState.get(this.level - 1)!);

        const message = new ProposeMessage(this.peer, block, this.level);
        message.withCommit(new FakeCommitCertificate(this.level - 1, this.knownState.get(this.level - 1)!, this.ccAggregator));

        console.log("Peer ", this.peer.name, "proposed level", this.level, "message with value", value)

        // broadcast
        this.peer.knownPeers.forEach(p => {
            const signal = new Signal(this.peer, p, message);
            orchestrator.addSignal(signal);
        });
    }

    handleEnterMessage(signal: Signal, mess: EnterMessage) {
        // TODO: check message validity
        //console.log(`Peer ${this.peer.name} (${this.level}) received enter message from ${mess.sender.name} at level ${mess.level}`)

        // Presume malformed, ignore
        if (mess.cc === null) {
            return;
        }

        let votes = this.preEnterVotesPerLevel.get(mess.level);
        if (!votes) {
            votes = { highestCC: mess.cc, signatures: new Set() };
            this.preEnterVotesPerLevel.set(mess.level, votes);
        }
        votes!.signatures.add(signal.from);
        
        if (mess.cc !== votes!.highestCC) {
            // So in this case actually, we'd need to know if this is a CC for a higher level than what we received
            // (e.g. maybe the proposer of the level did send the message, but only some other node received it)
            // If that's the case, we would need to ensure that we get the data for the commit, and we can actually build of that.
            // This is presumably possible, but maybe the node actually disappeared since then, and then what do we do?
            // We would have to build from another commit certificate as that one is now invalid.
            // Tricky.
        }
        /*
        if (mess.level < this.level) {
            // We are more advanced than the timed-out node, send them a message with our latest CC.

            const message = new ProposeMessage(this.proposerSelectorLogic.getProposer(this.level - 2), this.committedState.get(this.level - 2)!, this.level - 2);
            // We might actually not have data if we were out of date at some point.
            if (message.data) {
                console.log(`Peer ${this.peer.name} (${this.level}) re-broadcasting proposer message for level ${this.level - 2} with value ${message.data?.value}`)
                message.withCommit(this.highestSeenCC);
                this.peer.knownPeers.forEach(p => {
                    const signal = new Signal(this.peer, p, message);
                    orchestrator.addSignal(signal);
                });
            }
            return;
        }*/

        // We have received enough votes to enter the level.
        // We can commit "nil" blocks, and then create a new commit on top of that with a valid CC.
        // Anyone receiving it will know that this is the valid chain.
        if (this.preEnterVotesPerLevel.get(mess.level)!.signatures.size == Math.floor(2 * this.totalPeers / 3) + 1) {
            if (this.level < mess.level) {
                this.commitNil(mess.level);
                console.log("Peer", this.peer.name, "entered level", this.level, "proposer is ", this.proposerSelectorLogic.getProposer(this.level).name)
                // If we are the proposer, propose the next value
                if (this.proposerSelectorLogic.isProposer(this.level, this.peer)) {
                    this.propose("A");
                }
            }
        } else if (this.preEnterVotesPerLevel.get(mess.level)!.signatures.size == Math.floor(this.totalPeers / 3) + 1) {
            // Bracha echo
            const oldLevel = this.level;
            this.enterLevel(mess.level, true);
            this.signalEnterLevel();
            this.enterLevel(oldLevel, true);
            console.log("Peer ", this.peer.name, "re-echoed level", mess.level)
        }
    }

    commitNil(level: number) {
        for (let i = this.level; i < level; i++) {
            this.knownState.set(i, new Block("", this.knownState.get(i - 1)!));
        }
        this.enterLevel(level);
    }

    processSignal(signal: Signal) {
        if (this.bizantineOnPurpose) {
            return;
        }

        if (signal.message.type === "enter") {
            const mess = signal.message as EnterMessage;
            this.handleEnterMessage(signal, mess);
        } else if (signal.message.type === "propose") {
            const mess = signal.message as ProposeMessage;
            this.handleProposeMessage(signal, mess);
        } else if (signal.message.type === "vote") {
            const mess = signal.message as VoteMessage;
            this.handleVoteMessage(signal, mess);
        }
    }
}
