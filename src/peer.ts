import { Signal } from "./world";
import type { Orchestrator } from "./world";

export class Peer {
    name: string;
    knownPeers: Peer[];
    orchestrator: Orchestrator;

    replica: any;

    constructor(replicaType: new (peer: Peer) => any, name: string, orchestrator: Orchestrator) {
        this.replica = new replicaType(this);
        this.name = name;
        this.knownPeers = [this];
        this.orchestrator = orchestrator;
    }

    addPeer(peer: Peer) {
        this.knownPeers.push(peer);
    }

    removePeer(peer: Peer) {
        this.knownPeers = this.knownPeers.filter((p) => p !== peer);
    }

    processSignal(signal: Signal) {
        this.replica.processSignal(signal);
    }
}
