import type { ProposeMessage } from "./messages";
import type { Peer } from "./peer";
import type { Data } from "./data";

// With this fake stuff we can't recover the digest so we need to know what was signed.
export class FakeCommitCertificate {
    peers: Set<Peer> = new Set();
    data: Data<any>;
    level: number;
    
    constructor(level:number, data: Data<any>, peers: Set<Peer>) {
        this.level = level;
        this.data = data;
        this.peers = peers;
    }

    getLevel() {
        return this.level;
    }

    checkCertificate(totalPeers: number) {
        return this.peers.size > Math.floor(2 * totalPeers / 3);
    }

    isCertificateOf(data: Data<any>) {
        return this.data.isSame(data);
    }
}

export abstract class CommitCertificate {
    abstract getLevel(): number;
    abstract checkCertificate(totalPeers: number): boolean;
    abstract isCertificateOf(data: Data<any>): boolean;
}
