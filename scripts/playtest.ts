import {
  CARDS,
  EVENTS,
  ALL_CARDS,
  RESOURCES,
  STARTER_CARD_IDS,
  continuesAfterBuild,
  effectRules,
  effectiveCost,
  productiveIncome,
  shockEventForCard,
  type Card,
  type EventCard,
  type Resource,
  type ResourceMap,
} from '../src/game.ts'

type Strategy =
  | 'balanced'
  | 'engine'
  | 'vp'
  | 'effects'
  | 'scout'
  | 'moneyCompute'
  | 'influenceEnergy'
  | 'computeEnergy'
  | 'moneyInfluence'
  | 'shark'
  | 'apex'

type Player = {
  name: string
  strategy: Strategy
  budget: ResourceMap
  tableau: string[]
  passed: boolean
  initiative: boolean
  score: number
  scouts: number
  effectBuilds: number
  buildsByEra: Record<Card['era'], number>
  incomeBuilt: ResourceMap
}

type Game = {
  deck: string[]
  market: string[]
  discard: string[]
  events: string[]
  event?: EventCard
  active: number
  round: number
  log: string[]
  priorityPlayer?: string
  playableCounts: number[]
  effectBuilds: number
  scouts: number
  chains: number
}

const cards = new Map(ALL_CARDS.map((card) => [card.id, card]))
const events = new Map(EVENTS.map((event) => [event.id, event]))

function claimPriority(game: Game, players: Player[], player: Player) {
  players.forEach((candidate) => {
    candidate.initiative = false
  })
  player.initiative = true
  game.priorityPlayer = player.name
}
const learnedPower: Partial<Record<string, number>> = {
  'grace-cpu-bundle': 30,
  'inference-optimization': 28,
  'sanctions-shock': 27,
  'model-training-deadline': 24,
  'antitrust-hearing': 23,
  'open-source-compiler': 23,
  'boardroom-pivot': 18,
  'euv-queue': 18,
  'cuda-lock-in': 17,
  'networking-fabric': 13,
  'infiniband-switch': 12,
  'hbm-allocation': 12,
  'firmware-miracle': 11,
  'jensen-soju-toast': 10,
  'earthquake-insurance': 9,
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function shuffle<T>(items: T[], random: () => number) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function weightedDeck(random: () => number) {
  const early = shuffle(CARDS.filter((card) => card.era === 'early').map((card) => card.id), random)
  const mid = shuffle(CARDS.filter((card) => card.era === 'mid').map((card) => card.id), random)
  const late = shuffle(CARDS.filter((card) => card.era === 'late').map((card) => card.id), random)
  const deck: string[] = []
  while (early.length || mid.length || late.length) {
    deck.push(...early.splice(0, 4))
    deck.push(...mid.splice(0, 2))
    deck.push(...late.splice(0, 1))
  }
  return deck
}

function baseBudget(): ResourceMap {
  return { money: 0, influence: 0, compute: 0, energy: 0 }
}

function emptyIncome(): ResourceMap {
  return { money: 0, influence: 0, compute: 0, energy: 0 }
}

function addBudget(budget: ResourceMap, gain?: Partial<ResourceMap>) {
  if (!gain) return
  for (const resource of RESOURCES) budget[resource] = Math.max(0, budget[resource] + (gain[resource] ?? 0))
}

function cost(card: Card, event?: EventCard): ResourceMap {
  return effectiveCost(card, event)
}

function canPay(player: Player, card: Card, event?: EventCard) {
  const cardCost = cost(card, event)
  return RESOURCES.every((resource) => player.budget[resource] >= cardCost[resource])
}

function resetBudget(game: Game, player: Player) {
  player.budget = baseBudget()
  for (const cardId of player.tableau) addBudget(player.budget, productiveIncome(cards.get(cardId)!))
  addBudget(player.budget, game.event?.incomeMod)
}

function fillMarket(game: Game) {
  while (game.market.length < 5) {
    const card = game.deck.shift()
    if (!card) break
    game.market.push(card)
  }
}

function canAffordBase(card: Card) {
  const budget = baseBudget()
  for (const cardId of STARTER_CARD_IDS) addBudget(budget, productiveIncome(cards.get(cardId)!))
  const cardCost = effectiveCost(card)
  return RESOURCES.every((resource) => budget[resource] >= cardCost[resource])
}

function seedOpeningMarket(game: Game) {
  const opening: string[] = []
  for (let index = 0; index < game.deck.length && opening.length < 5; ) {
    const cardId = game.deck[index]
    const card = cards.get(cardId)!
    if (card.era === 'early' && canAffordBase(card)) {
      opening.push(cardId)
      game.deck.splice(index, 1)
    } else {
      index += 1
    }
  }
  game.market.push(...opening)
  fillMarket(game)
}

function cycleMarketCards(game: Game, cardIds: string[]) {
  const removed: string[] = []
  for (const cardId of cardIds) {
    const index = game.market.indexOf(cardId)
    if (index < 0) continue
    const [removedId] = game.market.splice(index, 1)
    removed.push(removedId)
  }
  game.discard.push(...removed)
  fillMarket(game)
  return removed
}

function sumMap(values?: Partial<ResourceMap>) {
  return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0)
}

function focusWeights(strategy: Strategy): Partial<Record<Resource, number>> {
  switch (strategy) {
    case 'moneyCompute':
      return { money: 2, compute: 2 }
    case 'influenceEnergy':
      return { influence: 2, energy: 2 }
    case 'computeEnergy':
      return { compute: 2, energy: 2 }
    case 'moneyInfluence':
      return { money: 2, influence: 2 }
    default:
      return {}
  }
}

function focusValue(card: Card, strategy: Strategy, round: number) {
  const weights = focusWeights(strategy)
  const focused = Object.keys(weights).length > 0
  if (!focused) return 0

  const income = productiveIncome(card)
  let value = 0
  for (const resource of RESOURCES) {
    const weight = weights[resource] ?? 0
    const cardIncome = income?.[resource] ?? 0
    const cardCost = card.cost[resource] ?? 0

    if (weight > 0) {
      value += cardIncome * weight * (round <= 6 ? 5 : 2)
      value += cardCost * 0.6
    } else {
      value -= cardCost * 1.8
      value -= cardIncome * 0.5
    }
  }

  return value
}

function cardValue(card: Card, strategy: Strategy, round: number) {
  const incomeValue = sumMap(productiveIncome(card))
  const effectValue = card.effect
    ? ({ priority: 7, shock: 9 } as Record<string, number>)[card.effect]
    : 0
  const earlyIncome = round <= 4 ? incomeValue * 5 : incomeValue * 2
  const lateVp = round >= 7 ? card.vp * 7 : card.vp * 4
  const base = lateVp + earlyIncome + effectValue

  switch (strategy) {
    case 'engine':
      return card.vp * 2 + incomeValue * (round <= 6 ? 8 : 2) + effectValue
    case 'vp':
      return card.vp * (round <= 5 ? 6 : 9) + incomeValue + effectValue * 0.5
    case 'effects':
      return base + effectValue * 2
    case 'scout':
      return base + (card.effect === 'shock' ? 8 : 0) + incomeValue
    case 'moneyCompute':
    case 'influenceEnergy':
    case 'computeEnergy':
    case 'moneyInfluence':
      return base + focusValue(card, strategy, round) + (round >= 7 ? card.vp * 2 : 0)
    case 'shark':
      return base + card.vp * 2 + effectValue + incomeValue * Math.max(0, 8 - round)
    case 'apex':
      return base + card.vp * 3 + effectValue + incomeValue * Math.max(0, 8 - round)
    case 'balanced':
      return base
  }
}

function sharkCardValue(game: Game, players: Player[], player: Player, card: Card) {
  const remaining = Math.max(1, 9 - game.round)
  const income = productiveIncome(card)
  const cardCost = cost(card, game.event)
  const costPressure = RESOURCES.reduce((sum, resource) => sum + cardCost[resource] * (resource === 'compute' ? 1.3 : 1), 0)
  const incomeValue =
    game.round <= 4
      ? (income?.money ?? 0) * remaining * 2.2 +
        (income?.compute ?? 0) * remaining * 2.6 +
        (income?.influence ?? 0) * remaining * 1.3 +
        (income?.energy ?? 0) * remaining * 1.2
      : sumMap(income) * 0.8
  const vpValue = card.vp * (game.round >= 5 ? 18 : 10) + card.vp * card.vp * 2 + (card.vp >= 3 ? 8 : 0)
  const nextOpponent = players[(players.indexOf(player) + 1) % players.length]
  const denial = nextOpponent && canPay(nextOpponent, card, game.event) ? card.vp * 6 + sumMap(productiveIncome(card)) * Math.min(remaining, 3) : 0
  const forcedEvent = card.effect === 'shock' ? events.get(shockEventForCard(card)) : undefined
  const effectValue =
    card.effect === 'priority' ? 6 + (game.round <= 5 ? 3 : 0) :
    card.effect === 'shock' ? 8 + sumMap(forcedEvent?.costMod) + sumMap(forcedEvent?.incomeMod) :
    0

  return (learnedPower[card.id] ?? 0) + vpValue + incomeValue + effectValue + denial - costPressure * 0.45
}

function chooseBuild(game: Game, players: Player[], player: Player, playable: Card[]) {
  if (player.strategy === 'apex') {
    return playable.sort((a, b) => apexCardValue(game, players, player, b) - apexCardValue(game, players, player, a))[0]
  }
  if (player.strategy === 'shark') {
    return playable.sort((a, b) => sharkCardValue(game, players, player, b) - sharkCardValue(game, players, player, a))[0]
  }
  return playable.sort((a, b) => cardValue(b, player.strategy, game.round) - cardValue(a, player.strategy, game.round))[0]
}

function applyEffect(game: Game, players: Player[], player: Player, card: Card) {
  if (!card.effect) return
  game.effectBuilds += 1
  player.effectBuilds += 1
  switch (card.effect) {
    case 'priority':
      claimPriority(game, players, player)
      break
    case 'shock': {
      game.event = events.get(shockEventForCard(card))
      break
    }
  }
}

function build(game: Game, players: Player[], player: Player, cardId: string, writeLog = true) {
  const card = cards.get(cardId)!
  const cardCost = cost(card, game.event)
  for (const resource of RESOURCES) player.budget[resource] -= cardCost[resource]
  addBudget(player.incomeBuilt, productiveIncome(card))
  game.market = game.market.filter((id) => id !== cardId)
  fillMarket(game)
  player.tableau.push(cardId)
  player.buildsByEra[card.era] += 1
  player.passed = !continuesAfterBuild(card)
  applyEffect(game, players, player, card)
  if (writeLog) {
    game.log.push(
      `${player.name} (${player.strategy}) builds ${card.name}${card.effect ? ` [${effectRules[card.effect].name}]` : ''}.`,
    )
  }
  return card
}

function scout(game: Game, players: Player[], player: Player) {
  cycleMarketCards(game, game.market.slice(0, 2))
  player.passed = true
  claimPriority(game, players, player)
  player.scouts += 1
  game.scouts += 1
  game.log.push(`${player.name} (${player.strategy}) scouts and cycles the market.`)
}

function shouldScout(player: Player, playable: Card[], round: number) {
  if (playable.length === 0) return true
  if (player.strategy === 'shark' || player.strategy === 'apex') return false
  const best = playable.sort((a, b) => cardValue(b, player.strategy, round) - cardValue(a, player.strategy, round))[0]
  if (player.strategy === 'scout') return round <= 4 && playable.length <= 2 && cardValue(best, player.strategy, round) < 18
  if (Object.keys(focusWeights(player.strategy)).length === 0) return false
  return round <= 3 && playable.length <= 2 && focusValue(best, player.strategy, round) < 2
}

function cloneGame(game: Game): Game {
  return {
    deck: [...game.deck],
    market: [...game.market],
    discard: [...game.discard],
    events: [...game.events],
    event: game.event,
    active: game.active,
    round: game.round,
    log: [],
    priorityPlayer: game.priorityPlayer,
    playableCounts: [],
    effectBuilds: game.effectBuilds,
    scouts: game.scouts,
    chains: game.chains,
  }
}

function clonePlayers(players: Player[]): Player[] {
  return players.map((player) => ({
    ...player,
    budget: { ...player.budget },
    tableau: [...player.tableau],
    buildsByEra: { ...player.buildsByEra },
    incomeBuilt: { ...player.incomeBuilt },
  }))
}

function scorePlayers(players: Player[]) {
  for (const player of players) {
    player.score = player.tableau.reduce((sum, id) => sum + cards.get(id)!.vp, 0)
  }
}

function startNextRound(game: Game, players: Player[]) {
  game.round += 1
  game.event = events.get(game.events.shift()!)
  players.forEach((player) => {
    player.passed = false
    resetBudget(game, player)
  })
  const initiative = game.priorityPlayer
    ? players.findIndex((player) => player.name === game.priorityPlayer)
    : -1
  game.active = initiative >= 0 ? initiative : (game.round - 1) % players.length
  players.forEach((player) => {
    player.initiative = false
  })
  game.priorityPlayer = undefined
}

function rolloutBuild(game: Game, players: Player[], player: Player, playable: Card[]) {
  const best = playable.sort((a, b) => sharkCardValue(game, players, player, b) - sharkCardValue(game, players, player, a))[0]
  const built = build(game, players, player, best.id, false)
  if (!continuesAfterBuild(built)) nextActive(game, players)
}

function simulateToEnd(game: Game, players: Player[]) {
  let guard = 0
  while (guard < 500) {
    guard += 1
    if (players.every((player) => player.passed)) {
      if (game.round >= 8) break
      startNextRound(game, players)
      continue
    }
    const player = players[game.active]
    const playable = game.market.map((id) => cards.get(id)!).filter((card) => canPay(player, card, game.event))
    if (playable.length === 0) {
      scout(game, players, player)
      nextActive(game, players)
    } else {
      rolloutBuild(game, players, player, playable)
    }
  }
  scorePlayers(players)
}

function apexCardValue(game: Game, players: Player[], player: Player, card: Card) {
  const gameClone = cloneGame(game)
  const playerIndex = players.indexOf(player)
  const playerClones = clonePlayers(players)
  const activeClone = playerClones[playerIndex]
  const built = build(gameClone, playerClones, activeClone, card.id, false)
  if (!continuesAfterBuild(built)) nextActive(gameClone, playerClones)
  simulateToEnd(gameClone, playerClones)
  const selfScore = playerClones[playerIndex].score
  const rivalScore = Math.max(...playerClones.filter((_, index) => index !== playerIndex).map((rival) => rival.score))
  return selfScore - rivalScore + sharkCardValue(game, players, player, card) * 0.02
}

function nextActive(game: Game, players: Player[]) {
  if (players.every((player) => player.passed)) return
  for (let step = 1; step <= players.length; step += 1) {
    const index = (game.active + step) % players.length
    if (!players[index].passed) {
      game.active = index
      return
    }
  }
}

function makePlayer(name: string, strategy: Strategy): Player {
  return {
    name,
    strategy,
    budget: baseBudget(),
    tableau: [...STARTER_CARD_IDS],
    passed: false,
    initiative: false,
    score: 0,
    scouts: 0,
    effectBuilds: 0,
    buildsByEra: { early: 0, mid: 0, late: 0 },
    incomeBuilt: emptyIncome(),
  }
}

export function play(seed = 7, strategies: Strategy[] = ['balanced', 'engine', 'effects']) {
  const random = rng(seed)
  const players = strategies.map((strategy, index) => makePlayer(['You', 'Supply Desk', 'Policy Shop'][index], strategy))
  const game: Game = {
    deck: weightedDeck(random),
    market: [],
    discard: [],
    events: shuffle(EVENTS.map((event) => event.id), random).slice(0, 8),
    active: 0,
    round: 0,
    log: [],
    playableCounts: [],
    effectBuilds: 0,
    scouts: 0,
    chains: 0,
  }
  seedOpeningMarket(game)

  while (game.round < 8) {
    startNextRound(game, players)
    game.log.push(`\nRound ${game.round}: ${game.event?.name} -- ${game.event?.rule}`)

    let guard = 0
    while (!players.every((player) => player.passed) && guard < 20) {
      guard += 1
      const player = players[game.active]
      const playable = game.market.map((id) => cards.get(id)!).filter((card) => canPay(player, card, game.event))
      game.playableCounts.push(playable.length)
      if (shouldScout(player, playable, game.round)) {
        scout(game, players, player)
      } else {
        const best = chooseBuild(game, players, player, playable)
        const built = build(game, players, player, best.id)
        if (continuesAfterBuild(built)) continue
      }
      nextActive(game, players)
    }
  }

  scorePlayers(players)

  return { game, players }
}

function summarizeSingle(seed: number) {
  const { game, players } = play(seed)
  console.log(game.log.join('\n'))
  console.log('\nFinal')
  for (const player of [...players].sort((a, b) => b.score - a.score)) {
    console.log(
      `${player.name} (${player.strategy}): ${player.score} VP, ${player.tableau.length - STARTER_CARD_IDS.length} builds, ${player.effectBuilds} effects, ${player.scouts} scouts, income ${JSON.stringify(player.incomeBuilt)}`,
    )
  }
  const avgPlayable = game.playableCounts.reduce((sum, count) => sum + count, 0) / game.playableCounts.length
  console.log(
    `\nSignals: ${game.scouts} scouts, ${game.effectBuilds} effect builds, ${game.chains} chains, ${avgPlayable.toFixed(
      2,
    )} playable cards per decision.`,
  )
}

function summarizeBatch(games: number) {
  const strategies: Strategy[] = [
    'balanced',
    'engine',
    'vp',
    'effects',
    'scout',
    'moneyCompute',
    'influenceEnergy',
    'computeEnergy',
    'moneyInfluence',
    'shark',
    'apex',
  ]
  const totals = Object.fromEntries(
    strategies.map((strategy) => [
      strategy,
      {
        games: 0,
        wins: 0,
        score: 0,
        builds: 0,
        effects: 0,
        scouts: 0,
        income: emptyIncome(),
        early: 0,
        mid: 0,
        late: 0,
      },
    ]),
  ) as Record<Strategy, {
    games: number
    wins: number
    score: number
    builds: number
    effects: number
    scouts: number
    income: ResourceMap
    early: number
    mid: number
    late: number
  }>

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = [strategies[(seed - 1) % strategies.length], strategies[seed % strategies.length], strategies[(seed + 1) % strategies.length]]
    const { players } = play(seed, lineup)
    const winner = [...players].sort((a, b) => b.score - a.score)[0]
    for (const player of players) {
      const bucket = totals[player.strategy]
      bucket.games += 1
      bucket.wins += player === winner ? 1 : 0
      bucket.score += player.score
      bucket.builds += player.tableau.length - STARTER_CARD_IDS.length
      bucket.effects += player.effectBuilds
      bucket.scouts += player.scouts
      bucket.early += player.buildsByEra.early
      bucket.mid += player.buildsByEra.mid
      bucket.late += player.buildsByEra.late
      for (const resource of RESOURCES) bucket.income[resource] += player.incomeBuilt[resource]
    }
  }

  console.log(`Simulated ${games} games.`)
  for (const strategy of strategies) {
    const bucket = totals[strategy]
    const n = bucket.games || 1
    console.log(
      `${strategy}: win ${(100 * bucket.wins / n).toFixed(1)}%, avg score ${(bucket.score / n).toFixed(1)}, builds ${(bucket.builds / n).toFixed(1)}, effects ${(bucket.effects / n).toFixed(1)}, scouts ${(bucket.scouts / n).toFixed(1)}, eras E/M/L ${(bucket.early / n).toFixed(1)}/${(bucket.mid / n).toFixed(1)}/${(bucket.late / n).toFixed(1)}, income ${JSON.stringify(Object.fromEntries(RESOURCES.map((r) => [r, +(bucket.income[r] / n).toFixed(1)])))}`,
    )
  }
}

function summarizeDuelBatch(gamesPerPair: number) {
  const strategies: Strategy[] = [
    'balanced',
    'engine',
    'vp',
    'effects',
    'scout',
    'moneyCompute',
    'influenceEnergy',
    'computeEnergy',
    'moneyInfluence',
    'shark',
    'apex',
  ]
  const totals = Object.fromEntries(
    strategies.map((strategy) => [
      strategy,
      {
        games: 0,
        wins: 0,
        score: 0,
        builds: 0,
        effects: 0,
        scouts: 0,
        chains: 0,
      },
    ]),
  ) as Record<Strategy, {
    games: number
    wins: number
    score: number
    builds: number
    effects: number
    scouts: number
    chains: number
  }>

  let seed = 1
  for (let left = 0; left < strategies.length; left += 1) {
    for (let right = left + 1; right < strategies.length; right += 1) {
      for (let gameIndex = 0; gameIndex < gamesPerPair; gameIndex += 1) {
        const lineup = gameIndex % 2 === 0 ? [strategies[left], strategies[right]] : [strategies[right], strategies[left]]
        const { game, players } = play(seed, lineup)
        seed += 1
        const winner = [...players].sort((a, b) => b.score - a.score)[0]
        for (const player of players) {
          const bucket = totals[player.strategy]
          bucket.games += 1
          bucket.wins += player === winner ? 1 : 0
          bucket.score += player.score
          bucket.builds += player.tableau.length - STARTER_CARD_IDS.length
          bucket.effects += player.effectBuilds
          bucket.scouts += player.scouts
          bucket.chains += game.chains / players.length
        }
      }
    }
  }

  console.log(`Simulated ${gamesPerPair} games per duel pairing (${seed - 1} total games).`)
  for (const strategy of strategies) {
    const bucket = totals[strategy]
    const n = bucket.games || 1
    console.log(
      `${strategy}: win ${(100 * bucket.wins / n).toFixed(1)}%, avg score ${(bucket.score / n).toFixed(1)}, builds ${(bucket.builds / n).toFixed(1)}, effects ${(bucket.effects / n).toFixed(1)}, scouts ${(bucket.scouts / n).toFixed(1)}, chains ${(bucket.chains / n).toFixed(1)}`,
    )
  }
}

function summarizeCardStats(games: number) {
  const strategies: Strategy[] = ['apex', 'shark', 'vp', 'balanced', 'effects', 'computeEnergy', 'engine']
  const stats = Object.fromEntries(
    CARDS.map((card) => [
      card.id,
      {
        totalBuilds: 0,
        winnerBuilds: 0,
        playerWins: 0,
        playerBuilds: 0,
      },
    ]),
  ) as Record<string, { totalBuilds: number; winnerBuilds: number; playerWins: number; playerBuilds: number }>

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = [
      strategies[(seed - 1) % strategies.length],
      strategies[seed % strategies.length],
      strategies[(seed + 1) % strategies.length],
    ]
    const { players } = play(seed, lineup)
    const winner = [...players].sort((a, b) => b.score - a.score)[0]
    for (const player of players) {
      for (const cardId of player.tableau) {
        const bucket = stats[cardId]
        if (!bucket) continue
        bucket.totalBuilds += 1
        bucket.playerBuilds += 1
        if (player === winner) {
          bucket.winnerBuilds += 1
          bucket.playerWins += 1
        }
      }
    }
  }

  const row = (cardId: string) => {
    const card = cards.get(cardId)!
    const bucket = stats[cardId]
    const winRate = bucket.playerBuilds ? 100 * bucket.playerWins / bucket.playerBuilds : 0
    const baseCost = effectiveCost(card)
    const costText = RESOURCES.filter((resource) => baseCost[resource] > 0)
      .map((resource) => `${resource}:${baseCost[resource]}`)
      .join('/')
    const effectName = card.effect ? effectRules[card.effect].name : 'No effect'
    return `${card.name} (${card.vp} VP, ${effectName}, ${costText || 'free'}): winner builds ${bucket.winnerBuilds}, total builds ${bucket.totalBuilds}, win when built ${winRate.toFixed(1)}%`
  }

  console.log(`Simulated ${games} games for card stats.`)
  console.log('\nMost points / finishers:')
  for (const card of [...CARDS].sort((a, b) => b.vp - a.vp || sumMap(effectiveCost(b)) - sumMap(effectiveCost(a))).slice(0, 12)) {
    console.log(row(card.id))
  }

  console.log('\nMost picked by winners:')
  for (const [cardId] of Object.entries(stats).sort(([, a], [, b]) => b.winnerBuilds - a.winnerBuilds).slice(0, 15)) {
    console.log(row(cardId))
  }

  console.log('\nHighest win rate when built (min 40 builds):')
  for (const [cardId] of Object.entries(stats)
    .filter(([, bucket]) => bucket.playerBuilds >= 40)
    .sort(([, a], [, b]) => b.playerWins / b.playerBuilds - a.playerWins / a.playerBuilds)
    .slice(0, 15)) {
    console.log(row(cardId))
  }
}

function summarizeApexMirror(games: number) {
  const stats = Object.fromEntries(
    CARDS.map((card) => [
      card.id,
      {
        totalBuilds: 0,
        winnerBuilds: 0,
        playerWins: 0,
        playerBuilds: 0,
      },
    ]),
  ) as Record<string, { totalBuilds: number; winnerBuilds: number; playerWins: number; playerBuilds: number }>

  let totalScore = 0
  let totalBuilds = 0
  let totalChains = 0
  let firstSeatWins = 0
  for (let seed = 1; seed <= games; seed += 1) {
    const { game, players } = play(seed, ['apex', 'apex'])
    const winner = [...players].sort((a, b) => b.score - a.score)[0]
    if (winner === players[0]) firstSeatWins += 1
    for (const player of players) {
      totalScore += player.score
      totalBuilds += player.tableau.length - STARTER_CARD_IDS.length
      totalChains += game.chains / players.length
      for (const cardId of player.tableau) {
        const bucket = stats[cardId]
        if (!bucket) continue
        bucket.totalBuilds += 1
        bucket.playerBuilds += 1
        if (player === winner) {
          bucket.winnerBuilds += 1
          bucket.playerWins += 1
        }
      }
    }
  }

  const row = (cardId: string) => {
    const card = cards.get(cardId)!
    const bucket = stats[cardId]
    const winRate = bucket.playerBuilds ? 100 * bucket.playerWins / bucket.playerBuilds : 0
    const pickRate = 100 * bucket.playerBuilds / (games * 2)
    const baseCost = effectiveCost(card)
    const costText = RESOURCES.filter((resource) => baseCost[resource] > 0)
      .map((resource) => `${resource}:${baseCost[resource]}`)
      .join('/')
    const effectName = card.effect ? effectRules[card.effect].name : 'No effect'
    return `${card.name} (${card.vp} VP, ${effectName}, ${costText || 'free'}): picked ${(pickRate).toFixed(1)}%, winner builds ${bucket.winnerBuilds}, total builds ${bucket.totalBuilds}, win when built ${winRate.toFixed(1)}%`
  }

  console.log(`Simulated ${games} Apex mirror games.`)
  console.log(`First seat wins ${(100 * firstSeatWins / games).toFixed(1)}%, avg score ${(totalScore / (games * 2)).toFixed(1)}, avg builds ${(totalBuilds / (games * 2)).toFixed(1)}, avg chains ${(totalChains / (games * 2)).toFixed(1)}.`)

  console.log('\nApex mirror most contested:')
  for (const [cardId] of Object.entries(stats).sort(([, a], [, b]) => b.totalBuilds - a.totalBuilds).slice(0, 15)) {
    console.log(row(cardId))
  }

  console.log('\nApex mirror most common winner cards:')
  for (const [cardId] of Object.entries(stats).sort(([, a], [, b]) => b.winnerBuilds - a.winnerBuilds).slice(0, 15)) {
    console.log(row(cardId))
  }

  console.log('\nApex mirror highest win rate when built (min 25 builds):')
  for (const [cardId] of Object.entries(stats)
    .filter(([, bucket]) => bucket.playerBuilds >= 25)
    .sort(([, a], [, b]) => b.playerWins / b.playerBuilds - a.playerWins / a.playerBuilds)
    .slice(0, 15)) {
    console.log(row(cardId))
  }
}

const mode = process.argv[2] ?? 'single'
if (mode === 'batch') summarizeBatch(Number(process.argv[3] ?? 100))
else if (mode === 'duel') summarizeDuelBatch(Number(process.argv[3] ?? 50))
else if (mode === 'cards') summarizeCardStats(Number(process.argv[3] ?? 1000))
else if (mode === 'mirror') summarizeApexMirror(Number(process.argv[3] ?? 500))
else summarizeSingle(Number(mode))
