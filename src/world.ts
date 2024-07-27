import { FakeCommitCertificate } from "./commitCertif";
import { Block } from "./data";
import { ProposeMessage } from "./messages";
import { Peer } from "./peer";
import type { Message } from "./messages";

function samplePoisson(meanDuration: number): number {
    const lambda = 1 / meanDuration;
    return -Math.log(1 - Math.random()) / lambda;
}

export class Signal {
    from: Peer;
    to: Peer;
    message: Message;

    timeToArrival!: number;

    constructor(from: Peer, to: Peer, message: Message) {
        this.from = from;
        this.to = to;
        this.message = message;
    }
    
    setArrivalTime(meanDuration: number) {
        // Max * 20 is effectively a timeout
        this.timeToArrival = Math.min(meanDuration * 20, Math.max(1, samplePoisson(meanDuration)));
    }
}

export abstract class ProposerSelectorLogic {
    abstract isProposer(level: number, peer: Peer): boolean;

    abstract getProposer(level: number): Peer;

    abstract getAllPeers(level: number): Peer[];
}

export class DummyProposerSelectorLogic extends ProposerSelectorLogic {
    isProposer(level: number, peer: Peer) {
        return false;
    }

    getProposer(level: number) {
        return new Peer("dummy");
    }

    getAllPeers(level: number) {
        return [new Peer("dummy")];
    }
}

export class RoundRobinProposerSelectorLogic extends ProposerSelectorLogic {
    allPeers = [] as Peer[];

    constructor(allPeers: Peer[]) {
        super();
        this.allPeers = allPeers;
    }

    isProposer(level: number, peer: Peer) {
        return this.allPeers[level % this.allPeers.length] === peer;
    }

    getProposer(level: number) {
        return this.allPeers[level % this.allPeers.length];
    }

    getAllPeers(level: number) {
        return this.allPeers;
    }
}


export class Orchestrator {
    signals: Signal[] = [];

    // Expected time for a signal to communicate
    DELTA: number;
    DROP_RATE: number;
    // Maximum number of signal that can make progress on a given tick
    MAX_BANDWIDTH: number;

    time = 0;

    liveSignalsStats: Map<number, number> = new Map();

    constructor(delta = 5, maxBandwidth = 20, dropRate = 0.1) {
        this.DELTA = delta;
        this.MAX_BANDWIDTH = maxBandwidth;
        this.DROP_RATE = dropRate;
    }

    addSignal(signal: Signal) {
        signal.setArrivalTime(this.DELTA);
        this.signals.push(signal);
    }

    tick() {
        this.time++;
        this.liveSignalsStats.set(this.time, this.signals.length);
        this.processSignals();
    }

    processSignals() {
        const processSignals = this.signals;
        this.signals = [];
        console.debug("Processing", processSignals.length, "in-flight signals")
        if (this.signals.length > this.MAX_BANDWIDTH) {
            // randomize the order of processing
            processSignals.sort(() => Math.random() - 0.5);
        }
        processSignals.forEach((signal, i, _) => {
            // Occasionally drop signals
            // Actually not if I'm simulating TCP and the random length is simulating retries.
            //if (Math.random() < this.DROP_RATE) {
            //    return;
            //}
            if (i > this.MAX_BANDWIDTH) {
                this.signals.push(signal);
                return;
            }
            signal.timeToArrival -= 1;
            if (signal.timeToArrival > 0) {
                this.signals.push(signal);
                return;
            }
            signal.to.processSignal(signal);
        });
    }
}

export const orchestrator = new Orchestrator();

export function kickoff(proposerSelector: ProposerSelectorLogic) {
    // This exists to avoid having to special-case the genesis block in the implementation for simplicity.
    const genesisProposer = proposerSelector.getProposer(0);
    const genesisBlock = new Block("A", null);
    genesisBlock.digest = "A";

    proposerSelector.getAllPeers(0).forEach(peer => {
        peer.replica.proposalsVoted.set(0, new ProposeMessage(genesisProposer, genesisBlock, 0));
    });
    
    const starter = proposerSelector.getProposer(1);
    starter.replica.votesReceived.set(0, new Set(proposerSelector.getAllPeers(0)));

    starter.replica.proposeNewBlock(1, "B");
}
