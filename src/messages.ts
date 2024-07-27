import { Peer } from "./peer";
import { Data } from "./data";
import type { CommitCertificate } from "./commitCertif";

export abstract class Message {
    type: string = "";
    sender: Peer;

    constructor(sender: Peer) {
        this.sender = sender;
    }
}

export class ProposeMessage extends Message {
    type = "propose";
    data: Data<any>;
    level: number;

    commitCertificate: CommitCertificate | null = null;

    constructor(sender: Peer, data: Data<any>, level: number) {
        super(sender);
        this.data = data;
        this.level = level;
    }

    withCommit(certificate: CommitCertificate) {
        this.commitCertificate = certificate;
        return this;
    }
}

export class VoteMessage extends Message {
    type = "vote";
    propose: ProposeMessage;
    
    constructor(sender: Peer, propose: ProposeMessage) {
        super(sender);
        this.propose = propose;
    }
}


export class TimeoutMessage extends Message {
    type = "timeout";
    level: number;
    cc: CommitCertificate;
    
    constructor(sender: Peer, level: number, cc: CommitCertificate) {
        super(sender);
        this.level = level;
        this.cc = cc;
    }
}