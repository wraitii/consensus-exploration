import { beforeAll, expect, test, spyOn, jest } from 'bun:test';

import { Peer } from './peer';
import { RoundRobinProposerSelectorLogic, kickoff, Orchestrator } from './world';

beforeAll(() => {
    spyOn(console, 'log').mockImplementation(jest.fn());
    spyOn(console, 'debug').mockImplementation(jest.fn());
});

test('fully honest scenario', () => {
    const orchestrator = new Orchestrator();

    const peers = []
    for (let i = 0; i < 4; i++) {
        peers.push(new Peer(i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach(peer => {
            peers.forEach(p => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    }

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach(peer => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    kickoff(proposerSelector);

    while (true) {
        peers.forEach(peer => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 200) {
            break;
        }
    }

    expect(peers.every(peer => peer.replica.committedChain.size > 10)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => { for (let i = peers[0].replica.committedChain.size; i > 0; i--) {
        if (peers.every(peer => peer.replica.committedChain.has(i))) {
            return i;
        }
    }})();
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map(peer => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every(block => block === blocks[0])).toBe(true);
});

test('Single Byzantine proposer', () => {
    const orchestrator = new Orchestrator();

    let peers = []
    for (let i = 0; i < 8; i++) {
        peers.push(new Peer(i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach(peer => {
            peers.forEach(p => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    }

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach(peer => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    peers[7].replica.byzantine = true;

    kickoff(proposerSelector);

    while (true) {
        peers.forEach(peer => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 300) {
            break;
        }
    }

    // Remove the byzantine peer from the list of peers
    peers = peers.slice(0, 7);

    expect(peers.every(peer => peer.replica.committedChain.size > 8)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => { for (let i = Array.from(peers[0].replica.committedChain.keys()).slice(-1)[0]; i > 0; i--) {
        if (peers.every(peer => peer.replica.committedChain.has(i))) {
            return i;
        }
    }})()!;
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map(peer => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every(block => block === blocks[0])).toBe(true);
});

test('Several Byzantine proposer in a row', () => {
    const orchestrator = new Orchestrator();

    let peers = []
    for (let i = 0; i < 8; i++) {
        peers.push(new Peer(i.toString(), orchestrator));
    }

    const fullyConnect = (peers: Peer[]) => {
        peers.forEach(peer => {
            peers.forEach(p => {
                if (peer !== p) {
                    peer.addPeer(p);
                }
            });
        });
    }

    fullyConnect(peers);

    const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

    peers.forEach(peer => {
        peer.replica.proposerSelectorLogic = proposerSelector;
    });

    peers[6].replica.byzantine = true;
    peers[7].replica.byzantine = true;

    kickoff(proposerSelector);

    while (true) {
        peers.forEach(peer => peer.replica.tick());
        orchestrator.tick();

        if (orchestrator.time > 500) {
            break;
        }
    }

    // Remove the byzantine peer from the list of peers
    peers = peers.slice(0, 6);

    console.log(Array.from(peers[0].replica.committedChain.entries()).map(x => `${x[0]}: ${x[1].value}`).join(', '));

    expect(peers.every(peer => peer.replica.committedChain.size > 5)).toBe(true);
    // Because not all nodes might have a record of all blocks, it's tricky to check it's the exact same chain.
    // Find the highest block present in all chains
    const highestBlock = (() => { for (let i = Array.from(peers[0].replica.committedChain.keys()).slice(-1)[0]; i > 0; i--) {
        if (peers.every(peer => peer.replica.committedChain.has(i))) {
            return i;
        }
    }})()!;
    expect(highestBlock).toBeGreaterThan(10);
    // Check that all peers have the same block at the highest level
    const blocks = peers.map(peer => peer.replica.committedChain.get(highestBlock));
    expect(blocks.every(block => block === blocks[0])).toBe(true);
});

