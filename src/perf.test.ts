import { beforeAll, expect, test, spyOn, jest } from "bun:test";

import { Peer } from "./peer";
import { RoundRobinProposerSelectorLogic, kickoff, Orchestrator } from "./world";

beforeAll(() => {
    spyOn(console, "log").mockImplementation(jest.fn());
    spyOn(console, "debug").mockImplementation(jest.fn());
});

const createPeers = (orchestrator: Orchestrator, n = 2) => {
    let peers = [];
    for (let i = 0; i < 4 * n; i++) {
        peers.push(new Peer(i.toString(), orchestrator));
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

    for (let i = 3 * n; i < 4 * n; i++) {
        peers[i].replica.byzantine = true;
    }

    return peers;
};

const run = (orchestrator: Orchestrator, peers: Peer[]) => {
    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach((peer) => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    kickoff(proposerSelector);

    while (true) {
        peers.forEach((peer) => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 5000) {
            break;
        }
    }

    // Remove the byzantine peer from the list of peers
    peers = peers.slice(0, (peers.length * 3) / 4);

    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => {
        for (let i = Array.from(peers[0].replica.committedChain.keys()).slice(-1)[0]; i > 0; i--) {
            if (peers.every((peer) => peer.replica.committedChain.has(i))) {
                return i;
            }
        }
    })()!;
    // Check that all peers have the same block at the highest level
    const blocks = peers.map((peer) => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every((block) => block === blocks[0])).toBe(true);

    // pick the first peer, compute non-nil blocks
    const nonNilBlocks = Array.from(peers[0].replica.committedChain.values()).filter((x) => x.value !== "").length;

    const averageSignals =
        Array.from(orchestrator.liveSignalsStats.values()).reduce((acc, x) => acc + x, 0) / orchestrator.liveSignalsStats.size;
    return { highestBlock, averageSignals, nonNilBlocks };
};

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator();

        runStats.push(run(orchestrator, createPeers(orchestrator)));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info("Throughput test with delta 5 - average blocks", runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length);
    console.info(
        "Throughput test with delta 5 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(7);

        runStats.push(run(orchestrator, createPeers(orchestrator)));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 7 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 7 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(2);

        runStats.push(run(orchestrator, createPeers(orchestrator)));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 2 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 2 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 40);
        const peers = createPeers(orchestrator);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 40 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 40 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 40 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 20);
        const peers = createPeers(orchestrator);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 10);
        const peers = createPeers(orchestrator);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 10 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 10 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 10 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 20);
        const peers = createPeers(orchestrator);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 20 bandwidth 20 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 20);
        const peers = createPeers(orchestrator);
        peers.map((peer) => (peer.replica.timeoutDelay = 50));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with delta 5 timeout 50 bandwidth 20 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 50 bandwidth 20 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with delta 5 timeout 50 bandwidth 20 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test nodes", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 50);
        const peers = createPeers(orchestrator, 1);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with 4 nodes delta 5 timeout 20 bandwidth 50 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with 4 nodes delta 5 timeout 20 bandwidth 50 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with 4 nodes delta 5 timeout 20 bandwidth 50 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test nodes", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 50);
        const peers = createPeers(orchestrator, 3);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with 3*4 nodes delta 5 timeout 20 bandwidth 50 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with 3*4 nodes delta 5 timeout 20 bandwidth 50 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with 3*4 nodes delta 5 timeout 20 bandwidth 50 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test nodes", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 50);
        const peers = createPeers(orchestrator, 5);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with 5*4 nodes delta 5 timeout 20 bandwidth 50 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with 5*4 nodes delta 5 timeout 20 bandwidth 50 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with 5*4 nodes delta 5 timeout 20 bandwidth 50 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test nodes", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 50);
        const peers = createPeers(orchestrator, 6);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with 6*4 nodes delta 5 timeout 20 bandwidth 50 - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with 6*4 nodes delta 5 timeout 20 bandwidth 50 - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with 6*4 nodes delta 5 timeout 20 bandwidth 50 - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Throughput test nodes", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    const runStats = [];
    for (let runI = 0; runI < 10; ++runI) {
        const orchestrator = new Orchestrator(5, 50);
        const peers = createPeers(orchestrator, 20);
        peers.map((peer) => (peer.replica.timeoutDelay = 20));
        peers.map((peer) => (peer.replica.broadcastTimeout = false));
        runStats.push(run(orchestrator, peers));
    }

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Throughput test with 20*4 nodes delta 5 timeout 20 bandwidth 50 with targeted timeout - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Throughput test with 20*4 nodes delta 5 timeout 20 bandwidth 50 with targeted timeout - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Throughput test with 20*4 nodes delta 5 timeout 20 bandwidth 50 with targeted timeout - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});

test("Consensus collapse test", () => {
    const m1 = spyOn(console, "error").mockImplementation(jest.fn());
    const m2 = spyOn(console, "info").mockImplementation(jest.fn());

    // In this test, we have few nodes, but they'll timeout pretty often, even if the bandwidth is high.
    // Because of this, the protocol "collapses" and utterlay fails to advance in most cases.
    const runStats = [];
    const orchestrator = new Orchestrator(5, 10000000);
    const peers = createPeers(orchestrator);
    peers.map((peer) => (peer.replica.timeoutDelay = 4));
    runStats.push(run(orchestrator, peers));

    m1.mockRestore();
    m2.mockRestore();

    console.info(
        "Consensus collapse test: delta 5, timeout 4, infinite bandwidth - average reached block",
        runStats.reduce((acc, x) => acc + x.highestBlock, 0) / runStats.length
    );
    console.info(
        "Consensus collapse test: delta 5, timeout 4, infinite bandwidth - average blocks",
        runStats.reduce((acc, x) => acc + x.nonNilBlocks, 0) / runStats.length
    );
    console.info(
        "Consensus collapse test: delta 5, timeout 4, infinite bandwidth - average signals",
        runStats.reduce((acc, x) => acc + x.averageSignals, 0) / runStats.length
    );
});
