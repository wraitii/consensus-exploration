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

    timeToArrival: number;

    constructor(from: Peer, to: Peer, message: Message) {
        this.from = from;
        this.to = to;
        this.message = message;
        this.timeToArrival = Math.min(orchestrator.DELTA * 10, Math.max(1, samplePoisson(orchestrator.DELTA)));
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


export const orchestrator = new class Orchestrator {
    signals: Signal[] = [];

    // Expected time for a signal to communicate
    DELTA = 5;
    DROP_RATE = 0.1;

    time = 0;

    liveSignalsStats: Map<number, number> = new Map();

    addSignal(signal: Signal) {
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
        console.log("Processing", processSignals.length, "in-flight signals")
        processSignals.forEach(signal => {
            // Occasionally drop signals
            // Actually not if I'm simulating TCP and the random length is simulating retries.
            //if (Math.random() < this.DROP_RATE) {
            //    return;
            //}
            signal.timeToArrival -= 1;
            if (signal.timeToArrival > 0) {
                this.signals.push(signal);
                return;
            }
            signal.to.processSignal(signal);
        });
    }
}

export function kickoff(proposerSelector: ProposerSelectorLogic) {
    const genesisProposer = proposerSelector.getProposer(0);
    const genesisBlock = new Block("A", null);
    genesisBlock.digest = "A";

    proposerSelector.getAllPeers(0).forEach(peer => {
        peer.replica.level = 0;
        peer.replica.knownState.set(0, genesisBlock);
    });
    
    const starter = proposerSelector.getProposer(1);

    const cc = new FakeCommitCertificate(0, genesisBlock, new Set(proposerSelector.getAllPeers(0)));
    starter.replica.updateHighestCCProposal(cc);
    starter.replica.level = 1;
    starter.replica.propose("B");
}
