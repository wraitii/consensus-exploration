import { ProposerSelectorLogic, DummyProposerSelectorLogic, Signal } from "./world";

import { Message, makeMessage } from "./messages";

import { Data, Block } from "./data";
import { FakeCommitCertificate } from "./commitCertif";
import type { Peer } from "./peer";

interface IsSame {
    isSame(other: any): boolean;
}

export class PrepareMessage extends Message {
    type = "prepare";
    data!: Data<any>;
    level!: number;
    qc!: QuorumCertificate<VoteConfirmMessage> | QuorumCertificate<TimeoutMessage>;
    isSame(other: PrepareMessage) {
        return this.data.isSame(other.data) && this.level === other.level;
    }
}

class VotePrepareMessage extends Message {
    type = "voteprepare";
    msg!: PrepareMessage;
    isSame(other: VotePrepareMessage) {
        return this.msg.isSame(other.msg);
    }
}

export class ConfirmMessage extends Message {
    type = "confirm";
    prepare!: PrepareMessage;
    qc!: QuorumCertificate<VotePrepareMessage>;
}

export class VoteConfirmMessage extends Message {
    type = "voteconfirm";
    msg!: ConfirmMessage;
    isSame(other: VoteConfirmMessage) {
        return this.msg.prepare.isSame(other.msg.prepare);
    }
}

class CommitMessage extends Message {
    type = "commit";
    level!: number;
    qc!: QuorumCertificate<VoteConfirmMessage>;
}

class TimeoutMessage extends Message {
    type = "timeout";
    level!: number;
    qc!: QuorumCertificate<VotePrepareMessage>;
    isSame(other: TimeoutMessage) {
        return this.level === other.level;
    }
}

/**
 * A Quorum certificate is, in principle, a bunch of signatures from other peers over a message
 * used to prove that a certain number of peers have agreed on a certain message.
 * This could be a BLS signature or some kind of ZK argument, or just a list of signatures.
 * I entirely ignore this implementation detail for now.
 */
export class QuorumCertificate<T extends IsSame> {
    signatures: Set<Peer> = new Set(); // This is a stand-in for signatures because I'm lazy.
    signedMessage: T;

    constructor(signedMessage: T, signatures: Set<Peer>) {
        this.signedMessage = signedMessage;
        this.signatures = signatures;
    }

    checkCertificate(totalPeers: number) {
        return this.signatures.size > Math.floor((2 * totalPeers) / 3);
    }

    checkMessageMatches(message: T) {
        return this.signedMessage.isSame(message);
    }
}

export class MotorwayBftReplica {
    peer: Peer;
    proposerSelectorLogic: ProposerSelectorLogic;

    byzantine = false;

    // Configurability
    timeoutDelay = 100; // number of 'ticks' to wait to enter timeout.
    broadcastTimeout = true; // whether to broadcast timeout messages or just send them to the expected next leader.
    confirmToNextLeader = "false";

    // Actually part of the BFT logic below
    lastVoteTime = 0; // timeout timer

    proposalsVoted = new Map<number, PrepareMessage>();
    proposalsLocked = new Map<number, ConfirmMessage>();
    // We can reuse the same structure because the leader cannot receive a confirm message before its propose message (or it's necessarily invalid by essence).
    votesReceived = new Set<Peer>();
    timeoutsReceived = new Map<number, Set<Peer>>();

    // To help with the above, keep track of where we are in block proposition.
    hasProposedBlock = "waiting" as "prepare" | "waiting";

    // The committed chain - this can actually have holes, conceptually, for blocks we haven't seen but we know must be there.
    committedChain = new Map<number, Block>(); // level -> block

    constructor(peer: Peer) {
        this.peer = peer;
        this.proposerSelectorLogic = new DummyProposerSelectorLogic();
    }

    getCurrentLevel() {
        // Our level is the highest level we've voted on.
        return Math.max(...Array.from(this.proposalsVoted.keys()));
    }

    tick() {
        if (this.byzantine) return;

        this.lastVoteTime++;
        // If the time since our last vote has gotten too high, we can assume
        // that the next leader proposer is byzantine.
        // This is a "timeout".
        // The procedure is to broadcast a message to all saying we're timing out, as a view synchronization mechanism.
        // This does encur o(n^2) messages, and I'm not sure it's actually better in some bandwidth limited cases - need investigation.
        if (this.lastVoteTime >= this.timeoutDelay) {
            const message = makeMessage(TimeoutMessage, this.peer, { level: this.getCurrentLevel() + 1 });
            if (this.broadcastTimeout)
                this.peer.knownPeers.forEach((p) => {
                    const signal = new Signal(this.peer, p, message);
                    this.peer.orchestrator.addSignal(signal);
                });
            else
                this.peer.orchestrator.addSignal(
                    new Signal(this.peer, this.proposerSelectorLogic.getProposer(this.getCurrentLevel() + 2), message)
                );
            // There is no way we can timeout "honestly" after GST - before GST could happen.
            // Ergo by construction we can afford to never reneg on a timeout.
            // A timeout is essentially voting "nil" for the current proposal, and moving to the next.
            // Now here, conceptually, we'd like all nodes to synchronize on the "timeout time" to restart the timer.
            // But I do feel, deep in my heart, that we can ignore this with large timeouts.
            this.lastVoteTime = 0;
            this.proposalsVoted.set(this.getCurrentLevel() + 1, null);
        }
    }

    processSignal(signal: Signal) {
        if (this.byzantine) return;
        try {
            if (signal.message instanceof PrepareMessage) {
                this.propose(signal.message);
            } else if (signal.message instanceof VotePrepareMessage) {
                this.onVotePropose(signal.message);
            } else if (signal.message instanceof VoteConfirmMessage) {
                this.onVoteConfirm(signal.message);
            } else if (signal.message instanceof ConfirmMessage) {
                this.confirm(signal.message);
            } else if (signal.message instanceof CommitMessage) {
                this.onCommit(signal.message);
            } else if (signal.message instanceof TimeoutMessage) {
                this.onTimeout(signal.message);
            }
        } catch (e: any) {
            console.error("Error processing signal", e);
        }
    }

    propose(signal: PrepareMessage) {
        console.log(`${this.peer.name} received propose message at level ${signal.level ?? "unknown"}`);

        // If I'm already at a higher level, ignore
        if (this.getCurrentLevel() >= signal.level) {
            // Show an error message - this is fine but can be informative for testing.
            console.error(`Peer ${this.peer.name} already voted at a higher level ${this.getCurrentLevel()}`);
            return;
        }

        // TODO: I believe if we receive a proposal much higher than what we last voted on,
        // then we can safely assume we were byzantine, and just catch up ?

        // Safety checks
        if (!signal.qc) throw new Error("No QC"); // TODO: handle genesis block?

        // validity - sender is the leader at this height
        if (signal.sender != this.proposerSelectorLogic.getProposer(signal.level)) throw new Error("Invalid proposer");

        // CC validity - Certificate is valid (enough signatures)
        if (!signal.qc.checkCertificate(this.proposerSelectorLogic.getAllPeers(signal.level).length)) {
            throw new Error(`Invalid commit certificate at level ${signal.level}`);
        }

        // CC validity
        if (signal.qc.signedMessage instanceof VoteConfirmMessage) {
            const level = signal.qc.signedMessage.msg.prepare.level;
            if (level != signal.level - 1) throw new Error("Invalid commit certificate level");
            const data = signal.qc.signedMessage.msg.prepare.data;

            if (!this.proposalsLocked.has(level)) {
                // TODO: this mega_needs to be async, but whatever
                for (const peer of this.peer.knownPeers) {
                    if (peer === this.peer) continue;
                    if (peer.replica.proposalsLocked.has(level)) {
                        this.proposalsLocked.set(level, peer.replica.proposalsLocked.get(level)!);
                        console.error("Cheated and got Confirm/commit data for level ", level, " from peer ", peer.name);
                        break;
                    }
                }
            }
            if (!data.isSame(this.proposalsLocked.get(level)!.prepare.data)) throw new Error("Invalid commit certificate data");
        } else {
            // This is a timeout certificate - we'll commit null blocks for any level up to the parent of this new block
            const level = signal.qc.signedMessage.level;
            if (level != signal.level - 1) throw new Error("Invalid timeout certificate level");
            // Proble: we might stil lbe missing some valid commits from earlier so... Do nothing?
        }

        // Validity: this is actually built on top of the correct chain ?
        // Validity - this proposal advances all line tips according to hesterogeneity.
        // Validity - we have the data or a PoA for the data.
        // I'm assuming here that the PoA itself is checked for validity.

        // We are free to vote !
        this.proposalsVoted.set(signal.level, signal);
        // Reset timeout timer
        this.lastVoteTime = 0;

        // A "prepare" message for level L means that level L-1 can be committed.
        if (!this.committedChain.has(signal.level - 1) && signal.level >= 1) this.commitBlock(signal.level - 1);

        const vote = makeMessage(VotePrepareMessage, this.peer, { msg: signal });
        // V1: send directly to the target peer
        if (true) {
            const voteSignal = new Signal(this.peer, this.proposerSelectorLogic.getProposer(signal.level), vote);
            this.peer.orchestrator.addSignal(voteSignal);
        }
    }

    onVotePropose(signal: VotePrepareMessage) {
        console.log(`${this.peer.name} received vote on propose message`);

        if (this.hasProposedBlock !== "prepare") return; // we're not in the prepare phase, so ignore this vote.
        if (!this.proposerSelectorLogic.isProposer(signal.msg.level, this.peer)) return;
        // TODO: check that this is a vote for our actual proposal

        this.votesReceived.add(signal.sender);

        const totalPeers = this.proposerSelectorLogic.getAllPeers(signal.msg.level).length;
        if (this.votesReceived.size >= Math.floor((2 * totalPeers) / 3) + 1) {
            // We have a quorum certificate ! Switch to confirm and broadcast.
            this.hasProposedBlock = "waiting"; // switch back as failsafe
            console.log(`${this.peer.name} has a prepare quorum certificate for level ${signal.msg.level}`);
            // Broadcast the confirm message
            const confirm = makeMessage(ConfirmMessage, this.peer, { prepare: signal.msg });
            confirm.qc = new QuorumCertificate<VotePrepareMessage>(signal, new Set(this.votesReceived));
            this.confirm(confirm);
            this.peer.knownPeers.forEach((p) => {
                if (p === this.peer) return;
                const signal = new Signal(this.peer, p, confirm);
                this.peer.orchestrator.addSignal(signal);
            });
            this.votesReceived.clear();
        }
    }

    confirm(signal: ConfirmMessage) {
        console.log(`${this.peer.name} received confirm message for level ${signal.prepare.level}`);

        // Safety checks
        if (!signal.qc) throw new Error("No CC"); // TODO: handle genesis block?

        // validity - sender is the leader at this height
        if (signal.sender != this.proposerSelectorLogic.getProposer(signal.prepare.level))
            throw new Error("Invalid leader for confirm message");

        // Quorum certificate validity - Actually on the right level
        if (!this.proposalsVoted.has(signal.prepare.level)!) {
            // We haven't received the prepare message for this...
            console.error(`${this.peer.name} Received confirm message for unknown prepare message, hacking`);
            // Hack: process.
            this.propose(signal.prepare);
        }
        if (!signal.prepare.isSame(this.proposalsVoted.get(signal.prepare.level)!))
            throw new Error("Invalid confirm - does not match prepare");

        // CC validity - Certificate is valid (enough signatures)
        if (!signal.qc.checkCertificate(this.proposerSelectorLogic.getAllPeers(signal.prepare.level).length)) {
            throw new Error(`Invalid quorum certificate at level ${signal.prepare.level}`);
        }

        this.proposalsLocked.set(signal.prepare.level, signal);

        const vote = makeMessage(VoteConfirmMessage, this.peer, { msg: signal });
        if (this.confirmToNextLeader === "false") {
            const voteSignal = new Signal(this.peer, this.proposerSelectorLogic.getProposer(signal.prepare.level), vote);
            this.peer.orchestrator.addSignal(voteSignal);
        } else if (this.confirmToNextLeader === "true") {
            const voteSignal = new Signal(this.peer, this.proposerSelectorLogic.getProposer(signal.prepare.level + 1), vote);
            this.peer.orchestrator.addSignal(voteSignal);
        }
    }

    onVoteConfirm(signal: VoteConfirmMessage) {
        console.log(`${this.peer.name} received vote on confirm message`);

        if (this.hasProposedBlock !== "waiting") return; // late messages as we've already switched

        const level = signal.msg.prepare.level;
        const totalPeers = this.proposerSelectorLogic.getAllPeers(level).length;
        if (this.proposerSelectorLogic.isProposer(level, this.peer)) {
            // Generic special case - if we receive confirm vote for our block, try and assemble a commit certificate.
            // Once done, send a commit message.
            this.votesReceived.add(signal.sender);
            if (this.votesReceived.size >= Math.floor((2 * totalPeers) / 3) + 1) {
                console.log(`${this.peer.name} has a commit quorum certificate for level ${level}`);

                const qc = new QuorumCertificate<VoteConfirmMessage>(signal, this.votesReceived);
                const message = makeMessage(CommitMessage, this.peer, { level, qc });
                this.onCommit(message);
                this.peer.knownPeers.forEach((p) => {
                    if (p === this.peer) return;
                    const signal = new Signal(this.peer, p, message);
                    this.peer.orchestrator.addSignal(signal);
                });
            }
            return;
        }

        if (!this.proposerSelectorLogic.isProposer(level + 1, this.peer)) return; // we send confirms to the next leader
        // TODO: check that this is a vote for our actual proposal

        this.votesReceived.add(signal.sender);

        if (this.votesReceived.size >= Math.floor((2 * totalPeers) / 3) + 1) {
            // We have a commit certificate ! Send a new prepare
            this.hasProposedBlock = "prepare";
            const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            const qc = new QuorumCertificate<VoteConfirmMessage>(signal, this.votesReceived);
            this.proposeNewBlock(level + 1, qc, randomLetter);
            this.votesReceived.clear();
        }
    }

    onCommit(signal: CommitMessage) {
        console.log(`${this.peer.name} received commit message for level ${signal.level}`);

        // Safety checks
        if (!signal.qc) throw new Error("No QC"); // TODO: handle genesis block?

        // validity - sender is the leader at this height
        if (signal.sender != this.proposerSelectorLogic.getProposer(signal.level)) throw new Error("Invalid proposer");

        // QC validity
        if (!this.proposalsLocked.has(signal.level)) {
            // We haven't locked on this, process confirm
            console.error(`${this.peer.name} Received commit message for unknown confirm message, hacking`);
            this.confirm(signal.qc.signedMessage.msg);
        }
        if (!signal.qc.signedMessage.msg.prepare.isSame(this.proposalsVoted.get(signal.level)!))
            throw new Error("Invalid commit - does not match prepare");

        // CC validity - Certificate is valid (enough signatures)
        if (!signal.qc.checkCertificate(this.proposerSelectorLogic.getAllPeers(signal.level).length))
            throw new Error(`Invalid commit certificate at level ${signal.level}`);

        if (this.committedChain.has(signal.level)) {
            // If this isn't the same block, there is a rogue leader
            if (!signal.qc.signedMessage.msg.prepare.data.isSame(this.committedChain.get(signal.level))) {
                console.error("Rogue leader at level", signal.level);
            }
            return;
        } else {
            this.commitBlock(signal.level);
        }

        // If we are the block proposer for the next level, we can propose a new block.
        if (this.proposerSelectorLogic.isProposer(signal.level + 1, this.peer) && this.hasProposedBlock === "waiting") {
            // Reuse the commit certificate
            this.hasProposedBlock = "prepare";
            const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            this.proposeNewBlock(signal.level + 1, signal.qc, randomLetter);
            this.votesReceived.clear();
        }
    }

    commitBlock(level: number) {
        // small initialization special case cause lazyness
        const commitBlock = this.proposalsVoted.get(level);
        if (commitBlock) {
            this.committedChain.set(level, commitBlock.data as Block);
            console.info("Peer ", this.peer.name, "committed block at level", level, "with value", commitBlock.data.value);
        } else if (commitBlock === null) {
            this.committedChain.set(level, null);
            console.info("Peer ", this.peer.name, "committed null block at level", level);
        } else {
            console.warn("Peer ", this.peer.name, "could not find block to commit at level", level);
            // This is actually not a safety issue, but lazy implementation - conceptually, we can commit the block hash
            // without knowing the full block - we know that this is the block that'll be committed, maybe we just missed voting on it or something.
        }
    }

    proposeNewBlock(level: number, qc: QuorumCertificate<VoteConfirmMessage> | QuorumCertificate<TimeoutMessage>, value: string) {
        let buildOnTopOf = this.proposalsVoted.get(level - 1)?.data;
        for (let i = level - 2; i >= 0; i--) {
            if (buildOnTopOf) break;
            buildOnTopOf = this.proposalsVoted.get(i)?.data;
        }
        if (!buildOnTopOf) {
            console.error("No block to build on top of");
            return;
        }

        // Construct the new block
        const block = new Block(value, buildOnTopOf as Block);

        console.log(`${this.peer.name} proposing new block at level ${level} with value ${value}`);

        const message = makeMessage(PrepareMessage, this.peer, { data: block, level, qc });
        // Handle locally and broadcast
        this.propose(message);
        this.peer.knownPeers.forEach((p) => {
            if (p === this.peer) return;
            const signal = new Signal(this.peer, p, message);
            this.peer.orchestrator.addSignal(signal);
        });
    }

    onTimeout(signal: TimeoutMessage) {
        console.log(`${this.peer.name} received timeout message for level ${signal.level}`);

        if (this.getCurrentLevel() > signal.level) return; // we've already voted at a higher level, so ignore this past timeout info.

        this.timeoutsReceived.set(signal.level, this.timeoutsReceived.get(signal.level) || new Set());
        this.timeoutsReceived.get(signal.level)!.add(signal.sender);

        // If we have received f+1 timeouts, we know that we'll timeout - people won't equivocate on a timeout,
        // so we'll never have 2f+1 votes for a block at this level. Enter timeout right away.
        // (I believe the literature calls this a Bracha echo broadcast).
        // (this isn't a massive optimisation but I believe it cuts down latency a bit)
        /*const totalPeersAtTimeoutLevel = this.proposerSelectorLogic.getAllPeers(signal.level).length;
        if (this.timeoutsReceived.get(signal.level)!.size >= Math.floor(totalPeersAtTimeoutLevel / 3) + 1) {
            TODO
        }*/

        // If we're the proposer for the level after the timeout, we might be able to propose a new block.
        if (!this.proposerSelectorLogic.isProposer(signal.level + 1, this.peer)) return;

        const totalPeers = this.proposerSelectorLogic.getAllPeers(signal.level).length;
        if (this.timeoutsReceived.get(signal.level)!.size >= Math.floor((2 * totalPeers) / 3) + 1) {
            // Make sure that we ourselves 'timeout' here
            this.proposalsVoted.set(signal.level, null);
            this.proposalsLocked.delete(signal.level);

            // We have a timeout certificate !
            // Propose a new block
            if (this.hasProposedBlock === "waiting") {
                this.hasProposedBlock = "prepare";
                const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
                const qc = new QuorumCertificate<TimeoutMessage>(signal, this.timeoutsReceived.get(signal.level)!);
                this.proposeNewBlock(signal.level + 1, qc, randomLetter);
            }
        }
    }
}
