import { Peer } from "./peer";

export abstract class Message {
    type: string = "";
    sender: Peer;

    constructor(sender: Peer) {
        this.sender = sender;
    }

    isSame(other: Message): boolean {
        return this.type === other.type;
    }
}

export function makeMessage<M extends Message, T extends Partial<Omit<M, keyof Message>>>(
    c: new (sender: Peer) => M,
    sender: Peer,
    data: T
): M {
    const msg = new c(sender);
    Object.assign(msg, data);
    return msg as M;
}
