import { Peer } from './src/peer';
import { RoundRobinProposerSelectorLogic, kickoff, orchestrator } from './src/world';

const peers = []
for (let i = 0; i < 40; i++) {
    peers.push(new Peer(i.toString()));
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

peers[3].replica.bizantineOnPurpose = true;
peers[14].replica.bizantineOnPurpose = true;
peers[15].replica.bizantineOnPurpose = true;
peers[16].replica.bizantineOnPurpose = true;

const proposerSelector = new RoundRobinProposerSelectorLogic(peers);

peers.forEach(peer => {
    peer.replica.setTotalPeers(peers.length);
    peer.replica.proposerSelectorLogic = proposerSelector;
});

kickoff(proposerSelector);

// Output data as CSV
const output = ["Time,Level,Peers,Byzantine,Signals"];

for (let i = 0; i < 3000; i++) {
    console.log("Iter", i, "----------------------");
    peers.forEach(peer => peer.replica.tick());
    orchestrator.tick();

    output.push(`${orchestrator.time},${peers.reduce((acc, peer) => Math.max(acc, peer.replica.level), 0)},${peers.length},${peers.filter(x => x.replica.bizantineOnPurpose).length},${orchestrator.liveSignalsStats.get(orchestrator.time)}`);
}

// save to file with timestamp
import { writeFileSync } from 'fs';
writeFileSync(`output-${new Date().getTime()}.csv`, output.join("\n"));

// Print the chain from a random non-bizantine peer
const nonBizantinePeer = peers.find(x => !x.replica.bizantineOnPurpose)!.replica;
for (let i = 0; i < nonBizantinePeer.level; i++) {
    console.log(i, nonBizantinePeer.knownState.get(i)?.value, nonBizantinePeer.knownState.get(i)?.digest);
}
