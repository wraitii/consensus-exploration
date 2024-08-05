import { beforeAll, expect, test, spyOn, jest } from "bun:test";

import { Peer } from "./peer";
import { ProposerSelectorLogic, RoundRobinProposerSelectorLogic, Orchestrator, Signal } from "./world";

import { Block } from "./data";

import { ConfirmMessage, MotorwayBftReplica, PrepareMessage, QuorumCertificate, VoteConfirmMessage } from "./MotorwayBftReplica";
import { makeMessage } from "./messages";

beforeAll(() => {
    // spyOn(console, "log").mockImplementation(jest.fn());
    spyOn(console, "debug").mockImplementation(jest.fn());
});

function kickoff(proposerSelector: ProposerSelectorLogic) {
    // This exists to avoid having to special-case the genesis block in the implementation for simplicity.
    const genesisProposer = proposerSelector.getProposer(0);
    const genesisBlock = new Block("A", null);
    genesisBlock.digest = "A";

    const prepareMessage = makeMessage(PrepareMessage, genesisProposer, { level: 0, data: genesisBlock });
    const confirmMessage = makeMessage(ConfirmMessage, proposerSelector.getProposer(0), { prepare: prepareMessage });
    const fakeConfirmVote = makeMessage(VoteConfirmMessage, proposerSelector.getProposer(0), { msg: confirmMessage });
    proposerSelector.getAllPeers(0).forEach((peer) => {
        peer.replica.proposalsVoted.set(0, prepareMessage);
        peer.replica.proposalsLocked.set(0, confirmMessage);
        peer.replica.committedChain.set(0, genesisBlock);
    });

    const replica = proposerSelector.getProposer(1).replica as MotorwayBftReplica;
    replica.votesReceived = new Set(proposerSelector.getAllPeers(0));
    replica.hasProposedBlock = "prepare";
    const qc = new QuorumCertificate<VoteConfirmMessage>(fakeConfirmVote, new Set(proposerSelector.getAllPeers(0)));
    replica.proposeNewBlock(1, qc, "B");
    replica.votesReceived.clear();
}

test("fully honest scenario", () => {
    const orchestrator = new Orchestrator();

    const peers = [];
    for (let i = 0; i < 4; i++) {
        peers.push(new Peer(MotorwayBftReplica, i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach((peer) => {
            peers.forEach((p) => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    };

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    kickoff(proposerSelector);

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 400) {
            break;
        }
    }

    expect(peers.every((peer) => peer.replica.committedChain.size > 10)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = peers[0].replica.committedChain.size; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })();
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);
});

test("Single Byzantine proposer", () => {
    const orchestrator = new Orchestrator(2); // Make sure messages arrive in a timely manner

    let peers = [];
    for (let i = 0; i < 4; i++) {
        peers.push(new Peer(MotorwayBftReplica, i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach((peer) => {
            peers.forEach((p) => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    };

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    peers[3].replica.byzantine = true;

    kickoff(proposerSelector);

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 300) {
            break;
        }
    }

    // Remove the byzantine peer from the list of peers
    peers = peers.slice(0, 3);

    expect(peers.every((peer) => peer.replica.committedChain.size > 8)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = Array.from(peers[0].replica.committedChain.keys()).slice(-1)[0]; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })()!;
    expect(highestBlock).toBeGreaterThan(8);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);
});

test("Several Byzantine proposer in a row", () => {
    const orchestrator = new Orchestrator();

    let peers = [];
    for (let i = 0; i < 8; i++) {
        peers.push(new Peer(MotorwayBftReplica, i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach((peer) => {
            peers.forEach((p) => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    };

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    peers[6].replica.byzantine = true;
    peers[7].replica.byzantine = true;

    kickoff(proposerSelector);

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 500) {
            break;
        }
    }

    // Remove the byzantine peer from the list of peers
    peers = peers.slice(0, 6);

    console.log(
        Array.from(peers[0].replica.committedChain.entries())
            .map((x) => `${x[0]}: ${x[1]?.value} (${x[1]?.digest})`)
            .join(", ")
    );

    expect(peers.every((peer) => peer.replica.committedChain.size > 5)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = Array.from(peers[0].replica.committedChain.keys()).slice(-1)[0]; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })()!;
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);
});

test("fully honest scenario with one delayed node", () => {
    const orchestrator = new Orchestrator();

    orchestrator.addSignal = (signal: Signal) => {
        if (signal.to.name === "3" || signal.from.name === "3") {
            signal.setArrivalTime(orchestrator.DELTA * 5);
        } else {
            signal.setArrivalTime(orchestrator.DELTA);
        }
        orchestrator.signals.push(signal);
    };

    const peers = [];
    for (let i = 0; i < 4; i++) {
        peers.push(new Peer(MotorwayBftReplica, i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach((peer) => {
            peers.forEach((p) => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    };

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    kickoff(proposerSelector);

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 400) {
            break;
        }
    }

    expect(peers.every((peer) => peer.replica.committedChain.size > 10)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = peers[0].replica.committedChain.size; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })();
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);
});

test("fully honest scenario with one temporarily disconnected node", () => {
    const orchestrator = new Orchestrator(2);

    const peers = [];
    for (let i = 0; i < 4; i++) {
        peers.push(new Peer(MotorwayBftReplica, i.toString(), orchestrator));
        peers[i].replica.timeoutDelay = 40;
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach((peer) => {
            peers.forEach((p) => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    };

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    kickoff(proposerSelector);

    peers[3].replica.byzantine = true;

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time == 100) {
            peers[3].replica.byzantine = false;
            console.warn("Reconnecting node 3");
        }

        if (orchestrator.time > 300) {
            break;
        }
    }

    console.log(
        Array.from(peers[0].replica.committedChain.entries())
            .map((x) => `${x[0]}: ${x[1]?.value} (${x[1]?.digest})`)
            .join(", ")
    );

    console.log(
        Array.from(peers[3].replica.committedChain.entries())
            .map((x) => `${x[0]}: ${x[1]?.value} (${x[1]?.digest})`)
            .join(", ")
    );

    expect(peers.every((peer) => peer.replica.committedChain.size > 10)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = peers[0].replica.committedChain.size; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })();
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);
});
