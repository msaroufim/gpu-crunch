# GPU Crunch

GPU Crunch is a browser prototype for a 52-card tableau game where rival GPU vendors race through the semiconductor supply chain, AI infrastructure buildouts, export controls, power constraints, talent raids, and market panic.

The long-term goal is a physical board game. This repo is a fast browser sandbox for testing the deck, pacing, and balance before printing anything.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

The prototype starts a default game immediately with you and two bots.

## Print Assets

Generate one poker-card-sized PNG for every deck card and event:

```bash
npm run print:cards
```

The script renders from the game metadata in `src/game.ts` and writes:

- `print-assets/cards/*.png`
- `print-assets/events/*.png`
- `print-assets/manifest.json`

Each PNG is `750x1050`, equivalent to a 2.5" x 3.5" card at 300 DPI.

## Core Idea

Players compete to build the strongest AI infrastructure tableau from a shared market of cards. Every card is intentionally powerful, but the market is public, so the interaction comes from timing, denial, and choosing which broken opportunity to take before someone else does.

## Components

- 52-card deck
- 12-card common market
- Event deck of brief market shocks
- Four resources: Money, Influence, Compute, Energy
- Vendor seats: green, red, and blue GPU vendors with different resource focuses
- Printed VP on cards

## Turn Structure

The game lasts 12 phases.

At the start of each phase:

- Phase 1 is the `Opening Draft` with no event shock.
- From phase 2 onward, reveal one event shock.
- Reset each player's temporary budget.
- Budget starts at 0, then adds income icons from visible tableau cards, modified by the event.
- Unspent resources from prior phases are gone.
- The Priority Card owner acts first, then the card becomes unclaimed.

Players start with no tableau and 0 resources. The first four market slots begin as `START` supply piles, so the first turns are about choosing a simple resource lane before branching into the normal market:

- `Broker Capacity`: Compute lane. Turns into cloud preorders, memory allocation, networking, and late Blackwell/cluster cards.
- `Acquire Lease`: Energy lane. Turns into interconnects, zoning deals, cooling, and giant datacenter campuses.
- `Stock Buyback`: Money lane. Turns into analyst hype, market pivots, panic buys, and IPO/war-chest plays.
- `Lobby`: Influence lane. Turns into export licenses, tariff routing, sovereign AI deals, and government superclusters.

The shop is capped at 12 cards: 4 starter supply piles plus 8 main shop cards. Each START pile has up to 4 copies, capped by current player count. Once a pile is exhausted, that slot becomes a normal shop slot. At the start of each phase, up to two empty main shop slots refill from the deck. Scout refreshes all non-starter shop slots from the deck and can claim Priority.

Events are separate from the 52-card deck. For now the prototype uses 12 short event cards and deals an 11-phase crisis queue after the opening draft by reshuffling that small event set as needed. Current examples include `H20 Suitcase Diplomat`, `Tariff Armageddon Spreadsheet`, `ASML Password Is litho123`, `CoWoS Bouncer Checks The List`, and `Triton Intern Deletes Matmul`.

Some dramatic events lock an entire card suit for one phase, such as `Foundry Lockdown` or `Compiler Zero-Day`.
Events can change costs, block suits, or reduce budgets, but they do not create starting resources. Resource access comes from built cards.

On your turn, choose one:

- Build one card from the common market.
- Scout: spend your action to refresh all main market slots from the deck. If the Priority Card is unclaimed this phase, take it.

Scout only when you hate every build or need Priority. You do not also build a card after scouting.

Most builds end your turn for the phase.

If no one owns the Priority Card, the next phase starts by normal seat rotation.

When a card is built:

- Pay its visible cost.
- Add it to your tableau.
- Resolve its immediate effect.
- Leave that market slot empty.
- At the start of the next phase, up to two empty main shop slots refill.

After every player has acted, the next phase begins.

## Scoring

At game end, score printed VP on built cards.

Resources do not score. Leftover resources are discarded every phase.

Cards with 3+ VP are point cards:

- They do not produce income.
- Printed VP above 3 adds extra cost to the resources already shown in that card's cost.

Printed resource bonuses on cards below 3 VP count as income icons. They refresh every phase and do not accumulate.

`START` cards are free supply piles with up to 4 copies each. Each player can build each START card once. When a pile is exhausted, that slot becomes a normal market slot.

## Broken Mechanics

Every card belongs to one of a few clear effect families:

- Priority: local buff that gives you the Priority Card if it is unclaimed. Its owner acts first next phase.
- Shock: global debuff manipulation that replaces the next event with that card's forced event.

There is no stealing or deleting built cards. Interaction comes from racing the public market, taking Priority, and forcing event windows.
Mid and late Priority cards pay extra cost in the resources already printed on the card because acting first can create back-to-back tempo.

## Card Roles

Cards show a lightweight role tag to make the deck easier to scan:

- Setup: build income for later turns.
- Timing: win the market or event window.
- Finisher: expensive points that close the game.

## Common Combos

- Scout -> Priority: be the first player to skip a weak market, refresh the main shop, and act first when the next phase opens.
- Priority -> Market Snipe: take initiative before a visible late card or key resource card gets contested.
- Shock -> Bad Window: replace the next visible crisis with a card-specific crisis so everyone can see the bad window coming.
- Income -> Finisher: build reusable income early so expensive VP cards become reachable later.

## Current Card Themes

The deck includes cards like:

- Acquire vLLM Team
- Ship the Model
- Vaguepost
- Reverse-Engineered Lithography Rig
- Export License Counsel
- China War Games Around Taiwan
- Grace CPU Bundle
- CUDA Lock-in
- ASML/toolchain style bottlenecks
- Energy, zoning, tariff, and gray-market workarounds

## Balance Tools

The repo includes simulator scripts for fast balancing:

```bash
npm run playtest -- 7
npm run playtest -- batch 1000
npm run playtest -- duel 50
npm run playtest -- cards 1000
npm run playtest -- mirror 500
npm run playtest -- options 500
```

Useful modes:

- `batch`: broad 3-player strategy comparison.
- `duel`: 2-player strategy tournament.
- `cards`: ranks cards by winner picks and win rate when built.
- `mirror`: Apex AI vs Apex AI for best-card analysis under strong play.
- `options`: measures how often players have 0, 1, 2+, or 3+ legal market choices by phase and strategy.

The strongest simulator agent is `apex`, a rollout-based AI that tests legal market builds by simulating the rest of the game and choosing the best final score margin.

## Development

```bash
npm run lint
npm run build
npm run playtest -- duel 50
```

## Deployment

The production server serves the built client and Socket.IO game server from one Node process.

Build command:

```bash
npm ci && npm run build
```

Start command:

```bash
npm start
```

Set `PORT` if required by the host.
