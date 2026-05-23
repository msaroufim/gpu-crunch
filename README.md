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

## Core Idea

Players compete to build the strongest AI infrastructure tableau from a shared market of cards. Every card is intentionally powerful, but the market is public, so the interaction comes from timing, denial, and choosing which broken opportunity to take before someone else does.

## Components

- 52-card deck
- 5-card common market
- Event deck of brief market shocks
- Four resources: Money, Influence, Compute, Energy
- Vendor seats: green, red, and blue GPU vendors with different resource focuses
- Printed VP on cards

## Turn Structure

The game lasts 8 phases.

At the start of each phase:

- Reveal one event shock.
- Reset each player's temporary budget.
- Budget equals base resources plus income icons from built cards, modified by the event.
- Unspent resources from prior phases are gone.

Events are separate from the 52-card deck. For now the prototype uses 8 short event cards so players can shuffle one small event deck. Current examples include `China Sales Window`, `Tariff Whiplash`, `ASML Credential Leak`, `Foundry Lockdown`, and `Compiler Zero-Day`.

Some dramatic events lock an entire card suit for one phase, such as `Foundry Lockdown` or `Compiler Zero-Day`.

On your turn, choose one:

- Build one card from the common market.
- Scout: cycle the two leftmost market cards and take initiative next phase.

Most builds end your turn for the phase.

When a card is built:

- Pay its visible cost.
- Add it to your tableau.
- Resolve its immediate effect.
- Refill the market back to 5 cards.

After every player has acted, the next phase begins.

## Scoring

At game end, score printed VP on built cards.

Resources do not score. Leftover resources are discarded every phase.

Cards with 3+ VP are point cards:

- They do not produce income.
- Printed VP above 2 adds extra Money and Compute cost.

Printed resource bonuses on cards below 3 VP count as income icons. They refresh every phase and do not accumulate.

## Broken Mechanics

Every card belongs to one of a few clear effect families:

- Shield: local buff that protects that card from Seize and Destroy.
- Decoy: local buff that forces Seize and Destroy to hit that card before your other vulnerable cards.
- Priority: local buff that gives you initiative next phase.
- Shock: global debuff manipulation that pushes the table into the next event.
- Seize: take the highest-VP card from the current leader's tableau.
- Destroy: trash the highest-VP card from the current leader's tableau, or from the market if no leader has cards.

The design principle is that every card should feel unfair in a concrete way, while the public market gives opponents a chance to race, deny, or punish it.

## Card Roles

Cards show a lightweight role tag to make the deck easier to scan:

- Setup: build income for later turns.
- Protect: keep your real payoff alive.
- Timing: win the market or event window.
- Punish: attack an exposed leader.
- Finisher: expensive points that close the game.

## Common Combos

- Decoy -> Finisher: build a Decoy before a big VP card so Seize and Destroy hit the decoy first.
- Priority -> Market Snipe: take initiative before a visible late card or key resource card gets contested.
- Shock -> Bad Window: build first, then push the table into a worse event for everyone still waiting.
- Seize/Destroy -> Naked Leader: punish a player who built points without Shield or Decoy cover.

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
```

Useful modes:

- `batch`: broad 3-player strategy comparison.
- `duel`: 2-player strategy tournament.
- `cards`: ranks cards by winner picks and win rate when built.
- `mirror`: Apex AI vs Apex AI for best-card analysis under strong play.

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
