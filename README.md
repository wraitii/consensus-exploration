# consensus-exploration

The purpose of this repository is to explore BFT algorithms, specifically HotStuff.

There is a global network simulation, moving "packets" (signals) between nodes. Different topologies could be tested, but I've only done "fully-connected" for now.
The simulation has some simple parameters, such as the average time a message takes to arrive, and a pseudo bandwidth parameter.

Nodes will follow regular Hotstuff consensus, implemented in a straightforward way - the goal isn't to optimise the algorithm at the node level but at the bandwidth level.

Some things you can see if you run the perf tests:
- For a given bandwidth, there is an optimal timeout setting. Too fast, and you'll timeout too often, and timeouts are quadratic, so this slows down the chain. Too slow, and you'll wait unnecessarily long to recover from a byzantine leader.
- adding nodes is bad for performance.

The main problem with the current implementation is that you get timeout cascades - the quadratic complexity overloads the network, which leads to more timeouts, which leads to more messages, and so on.
A very clever message relay system could potentially drop timeout messages if they saw more recent ones, thus freeing some of the bandwidth. This would be an interesting, very low level optimisation.

Things I'm curious about:
- Why can't we target the timeout messages? We kinda assume we know the `n` next leaders regardless. This would fix the quadratic problem and actually be insanely efficient.

Implementation notes:
- I'm not sure it's correct to reset the timeout timer on voting & on timeout - I think a proper implementation would do it slightly differently, but I'm not sure this is actually a safety problem, maybe just inefficient?
- there's no leader logic really, it's round robin
- I don't implement consensus changes, which is a big part of the logic.

### Install & run

To install dependencies:

```bash
bun install
```

To run:

```bash
bun test
```
