import {
  CARDS,
  EVENTS,
  GAME_PHASES,
  MARKET_SIZE,
  RESOURCES,
  SCOUT_REFILL_SIZE,
  STARTER_MARKET_SIZE,
  STARTER_SUPPLY_COUNT,
  OPENING_MARKET_CARD_IDS,
  OPENING_MAIN_CARD_IDS,
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
  | 'moneyOnly'
  | 'influenceOnly'
  | 'computeOnly'
  | 'energyOnly'
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
  buildHistory: Array<{ round: number; cardId: string }>
  passed: boolean
  initiative: boolean
  score: number
  scouts: number
  effectBuilds: number
  buildsByEra: Record<Card['era'], number>
  incomeBuilt: ResourceMap
}

type PlayableSample = {
  round: number
  strategy: Strategy
  count: number
  nonStarterCount: number
}

type PhaseSample = {
  round: number
  scores: number[]
  leaders: number[]
  spread: number
}

type Game = {
  deck: string[]
  market: (string | null)[]
  discard: string[]
  events: string[]
  event?: EventCard
  active: number
  round: number
  log: string[]
  priorityPlayer?: string
  playableCounts: number[]
  playableSamples: PlayableSample[]
  phaseSamples: PhaseSample[]
  effectBuilds: number
  scouts: number
  chains: number
}

const cards = new Map(CARDS.map((card) => [card.id, card]))
const events = new Map(EVENTS.map((event) => [event.id, event]))
const starterCardIds = new Set(OPENING_MARKET_CARD_IDS)

function claimPriority(game: Game, players: Player[], player: Player) {
  if (game.priorityPlayer) return false
  players.forEach((candidate) => {
    candidate.initiative = false
  })
  player.initiative = true
  game.priorityPlayer = player.name
  return true
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

function makeEventDeck(random: () => number, count: number) {
  const eventIds = EVENTS.map((event) => event.id)
  const deck: string[] = []
  while (deck.length < count) deck.push(...shuffle(eventIds, random))
  return deck.slice(0, count)
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
  if (player.tableau.includes(card.id)) return false
  const cardCost = cost(card, event)
  return RESOURCES.every((resource) => player.budget[resource] >= cardCost[resource])
}

function canPayWithBudget(budget: ResourceMap, card: Card, event?: EventCard) {
  const cardCost = cost(card, event)
  return RESOURCES.every((resource) => budget[resource] >= cardCost[resource])
}

function starterBuildCount(players: Player[], cardId: string) {
  return players.filter((player) => player.tableau.includes(cardId)).length
}

function starterSupplyLimit(players: Player[]) {
  return Math.min(STARTER_SUPPLY_COUNT, players.length)
}

function isStarterPileAvailable(players: Player[], cardId: string) {
  return starterCardIds.has(cardId) && starterBuildCount(players, cardId) < starterSupplyLimit(players)
}

function isProtectedStarterSlot(game: Game, players: Player[], index: number) {
  const cardId = OPENING_MARKET_CARD_IDS[index]
  if (index >= STARTER_MARKET_SIZE || !cardId || !isStarterPileAvailable(players, cardId)) return false
  game.market[index] = cardId
  return true
}

function replaceNextEvent(game: Game, forcedEventId: string) {
  if (game.events.length === 0) return false
  game.events[0] = forcedEventId
  return true
}

function resetBudget(game: Game, player: Player) {
  player.budget = baseBudget()
  for (const cardId of player.tableau) addBudget(player.budget, productiveIncome(cards.get(cardId)!))
  addBudget(player.budget, game.event?.incomeMod)
}

function tableauBudget(player: Player) {
  const budget = baseBudget()
  for (const cardId of player.tableau) addBudget(budget, productiveIncome(cards.get(cardId)!))
  return budget
}

function seedOpeningMarket(game: Game) {
  for (const cardId of OPENING_MARKET_CARD_IDS) {
    const index = game.deck.indexOf(cardId)
    if (index >= 0) game.deck.splice(index, 1)
  }
  for (const cardId of OPENING_MAIN_CARD_IDS) {
    const index = game.deck.indexOf(cardId)
    if (index >= 0) game.deck.splice(index, 1)
  }
  game.market = Array.from({ length: MARKET_SIZE }, (_, index) => {
    if (index < STARTER_MARKET_SIZE) return OPENING_MARKET_CARD_IDS[index] ?? null
    const openingMainCard = OPENING_MAIN_CARD_IDS[index - STARTER_MARKET_SIZE]
    if (openingMainCard) return openingMainCard
    return game.deck.shift() ?? null
  })
}

function drawMarketCard(game: Game) {
  if (game.deck.length === 0 && game.discard.length > 0) {
    game.deck = [...game.discard]
    game.discard = []
  }
  return game.deck.shift() ?? null
}

function refreshMainMarket(game: Game, players: Player[]) {
  let refreshed = 0
  for (let index = 0; index < game.market.length && refreshed < SCOUT_REFILL_SIZE; index += 1) {
    if (isProtectedStarterSlot(game, players, index)) continue
    const existing = game.market[index]
    if (existing) game.discard.push(existing)
    const nextCard = drawMarketCard(game)
    game.market[index] = nextCard
    if (nextCard) refreshed += 1
  }
  return refreshed
}

function fillEmptyMainMarket(game: Game, players: Player[]) {
  let filled = 0
  const refillLimit = Math.max(1, players.length)
  for (let index = 0; index < game.market.length && filled < refillLimit; index += 1) {
    if (isProtectedStarterSlot(game, players, index)) continue
    if (game.market[index]) continue
    const nextCard = drawMarketCard(game)
    game.market[index] = nextCard
    if (nextCard) filled += 1
  }
  return filled
}

function sumMap(values?: Partial<ResourceMap>) {
  return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0)
}

function focusWeights(strategy: Strategy): Partial<Record<Resource, number>> {
  switch (strategy) {
    case 'moneyOnly':
      return { money: 3 }
    case 'influenceOnly':
      return { influence: 3 }
    case 'computeOnly':
      return { compute: 3 }
    case 'energyOnly':
      return { energy: 3 }
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
    case 'moneyOnly':
    case 'influenceOnly':
    case 'computeOnly':
    case 'energyOnly':
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
      replaceNextEvent(game, shockEventForCard(card))
      break
    }
  }
}

function build(game: Game, players: Player[], player: Player, cardId: string, writeLog = true) {
  const card = cards.get(cardId)!
  if (player.tableau.includes(cardId)) return
  if (card.starter && !isStarterPileAvailable(players, cardId)) return
  const cardCost = cost(card, game.event)
  const marketIndex = game.market.indexOf(cardId)
  const wasProtectedStarterSlot = marketIndex >= 0 && isProtectedStarterSlot(game, players, marketIndex)
  for (const resource of RESOURCES) player.budget[resource] -= cardCost[resource]
  addBudget(player.incomeBuilt, productiveIncome(card))
  player.tableau.push(cardId)
  player.buildHistory.push({ round: game.round, cardId })
  if (marketIndex >= 0) {
    if (wasProtectedStarterSlot) {
      if (!isProtectedStarterSlot(game, players, marketIndex)) game.market[marketIndex] = drawMarketCard(game)
    } else {
      game.market[marketIndex] = null
    }
  }
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
  const refreshedSlots = refreshMainMarket(game, players)
  player.passed = true
  const claimedPriority = claimPriority(game, players, player)
  player.scouts += 1
  game.scouts += 1
  game.log.push(
    refreshedSlots > 0
      ? claimedPriority
        ? `${player.name} (${player.strategy}) scouts, refreshes ${refreshedSlots} shop slots, and takes Priority.`
        : `${player.name} (${player.strategy}) scouts and refreshes ${refreshedSlots} shop slots.`
      : claimedPriority
        ? `${player.name} (${player.strategy}) scouts, finds no new shop cards, and takes Priority.`
        : `${player.name} (${player.strategy}) scouts and finds no new shop cards.`,
  )
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
    playableSamples: [],
    phaseSamples: [],
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
    buildHistory: player.buildHistory.map((build) => ({ ...build })),
    buildsByEra: { ...player.buildsByEra },
    incomeBuilt: { ...player.incomeBuilt },
  }))
}

function scorePlayers(players: Player[]) {
  for (const player of players) {
    player.score = player.tableau.reduce((sum, id) => sum + cards.get(id)!.vp, 0)
  }
}

function scoreValue(player: Player) {
  return player.tableau.reduce((sum, id) => sum + cards.get(id)!.vp, 0)
}

function phaseSample(round: number, players: Player[]): PhaseSample {
  const scores = players.map(scoreValue)
  const topScore = Math.max(...scores)
  const lowScore = Math.min(...scores)
  return {
    round,
    scores,
    leaders: scores.map((score, index) => score === topScore ? index : -1).filter((index) => index >= 0),
    spread: topScore - lowScore,
  }
}

function startNextRound(game: Game, players: Player[]) {
  game.round += 1
  game.event = game.round === 1 ? undefined : events.get(game.events.shift()!)
  players.forEach((player) => {
    player.passed = false
    resetBudget(game, player)
  })
  fillEmptyMainMarket(game, players)
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
      if (game.round >= GAME_PHASES) break
      startNextRound(game, players)
      continue
    }
    const player = players[game.active]
    const playable = game.market
      .map((id) => id ? cards.get(id) : undefined)
      .filter((card): card is Card => Boolean(card))
      .filter((card) => canPay(player, card, game.event))
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
    tableau: [],
    passed: false,
    initiative: false,
    score: 0,
    scouts: 0,
    effectBuilds: 0,
    buildsByEra: { early: 0, mid: 0, late: 0 },
    incomeBuilt: emptyIncome(),
    buildHistory: [],
  }
}

export function play(seed = 7, strategies: Strategy[] = ['balanced', 'engine', 'effects']) {
  const random = rng(seed)
  const players = strategies.map((strategy, index) => makePlayer(['You', 'Supply Desk', 'Policy Shop'][index], strategy))
  const game: Game = {
    deck: weightedDeck(random),
    market: [],
    discard: [],
    events: makeEventDeck(random, GAME_PHASES - 1),
    active: 0,
    round: 0,
    log: [],
    playableCounts: [],
    playableSamples: [],
    phaseSamples: [],
    effectBuilds: 0,
    scouts: 0,
    chains: 0,
  }
  seedOpeningMarket(game)

  while (game.round < GAME_PHASES) {
    startNextRound(game, players)
    game.log.push(`\nRound ${game.round}: ${game.event?.name ?? 'Opening Draft'} -- ${game.event?.rule ?? 'No crisis this phase.'}`)

    let guard = 0
    while (!players.every((player) => player.passed) && guard < 20) {
      guard += 1
      const player = players[game.active]
      const playable = game.market
        .map((id) => id ? cards.get(id) : undefined)
        .filter((card): card is Card => Boolean(card))
        .filter((card) => canPay(player, card, game.event))
      const nonStarterPlayable = playable.filter((card) => !card.starter).length
      game.playableCounts.push(playable.length)
      game.playableSamples.push({ round: game.round, strategy: player.strategy, count: playable.length, nonStarterCount: nonStarterPlayable })
      if (shouldScout(player, playable, game.round)) {
        scout(game, players, player)
      } else {
        const best = chooseBuild(game, players, player, playable)
        const built = build(game, players, player, best.id)
        if (continuesAfterBuild(built)) continue
      }
      nextActive(game, players)
    }
    game.phaseSamples.push(phaseSample(game.round, players))
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
      `${player.name} (${player.strategy}): ${player.score} VP, ${player.tableau.length} builds, ${player.effectBuilds} effects, ${player.scouts} scouts, income ${JSON.stringify(player.incomeBuilt)}`,
    )
  }
  const avgPlayable = game.playableCounts.reduce((sum, count) => sum + count, 0) / game.playableCounts.length
  const zeroChoice = game.playableCounts.filter((count) => count === 0).length
  const oneOrLess = game.playableCounts.filter((count) => count <= 1).length
  console.log(
    `\nSignals: ${game.scouts} scouts, ${game.effectBuilds} effect builds, ${game.chains} chains, ${avgPlayable.toFixed(
      2,
    )} playable cards per decision, ${(100 * oneOrLess / game.playableCounts.length).toFixed(1)}% decisions at 0-1 options, ${(100 * zeroChoice / game.playableCounts.length).toFixed(1)}% at 0 options.`,
  )
}

function emptyOptionBucket() {
  return {
    decisions: 0,
    optionSum: 0,
    zero: 0,
    one: 0,
    twoPlus: 0,
    threePlus: 0,
  }
}

type OptionBucket = ReturnType<typeof emptyOptionBucket>

function addOptionSample(bucket: OptionBucket, count: number) {
  bucket.decisions += 1
  bucket.optionSum += count
  if (count === 0) bucket.zero += 1
  if (count === 1) bucket.one += 1
  if (count >= 2) bucket.twoPlus += 1
  if (count >= 3) bucket.threePlus += 1
}

function optionLine(label: string, bucket: OptionBucket) {
  const n = bucket.decisions || 1
  return `${label}: avg ${(bucket.optionSum / n).toFixed(2)}, 0 ${(100 * bucket.zero / n).toFixed(1)}%, 1 ${(100 * bucket.one / n).toFixed(1)}%, 0-1 ${(100 * (bucket.zero + bucket.one) / n).toFixed(1)}%, 2+ ${(100 * bucket.twoPlus / n).toFixed(1)}%, 3+ ${(100 * bucket.threePlus / n).toFixed(1)}% (${bucket.decisions} decisions)`
}

function summarizeOptions(games: number, scope: 'all' | 'nonstarter' = 'all') {
  const strategies: Strategy[] = [
    'balanced',
    'engine',
    'vp',
    'effects',
    'scout',
    'moneyOnly',
    'influenceOnly',
    'computeOnly',
    'energyOnly',
    'moneyCompute',
    'influenceEnergy',
    'computeEnergy',
    'moneyInfluence',
    'shark',
    'apex',
  ]
  const overall = emptyOptionBucket()
  const byRound = Object.fromEntries(Array.from({ length: GAME_PHASES }, (_, index) => [index + 1, emptyOptionBucket()])) as Record<number, OptionBucket>
  const byStrategy = Object.fromEntries(strategies.map((strategy) => [strategy, emptyOptionBucket()])) as Record<Strategy, OptionBucket>

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = [strategies[(seed - 1) % strategies.length], strategies[seed % strategies.length], strategies[(seed + 1) % strategies.length]]
    const { game } = play(seed, lineup)
    for (const sample of game.playableSamples) {
      const count = scope === 'nonstarter' ? sample.nonStarterCount : sample.count
      addOptionSample(overall, count)
      addOptionSample(byRound[sample.round], count)
      addOptionSample(byStrategy[sample.strategy], count)
    }
  }

  console.log(`Simulated ${games} games for ${scope === 'nonstarter' ? 'non-starter ' : ''}playable-option pressure.`)
  console.log(optionLine('overall', overall))

  console.log('\nBy phase:')
  for (const round of Object.keys(byRound).map(Number).sort((a, b) => a - b)) {
    console.log(optionLine(`phase ${round}`, byRound[round]))
  }

  console.log('\nBy strategy:')
  for (const strategy of strategies) {
    console.log(optionLine(strategy, byStrategy[strategy]))
  }
}

function emptyImpactBucket() {
  return {
    decisions: 0,
    baseOptions: 0,
    eventOptions: 0,
    denied: 0,
    allowed: 0,
    unchanged: 0,
    zeroImpact: 0,
    hardDenied: 0,
    actionChanged: 0,
    buildChanged: 0,
    scoutChanged: 0,
  }
}

type ImpactBucket = ReturnType<typeof emptyImpactBucket>

function addImpactSample(
  bucket: ImpactBucket,
  base: Set<string>,
  event: Set<string>,
  marketCards: Card[],
  eventCard: EventCard | undefined,
  baseAction: string,
  eventAction: string,
) {
  let denied = 0
  let allowed = 0
  for (const cardId of base) {
    if (!event.has(cardId)) denied += 1
  }
  for (const cardId of event) {
    if (!base.has(cardId)) allowed += 1
  }
  bucket.decisions += 1
  bucket.baseOptions += base.size
  bucket.eventOptions += event.size
  bucket.denied += denied
  bucket.allowed += allowed
  bucket.unchanged += marketCards.length - denied - allowed
  if (denied === 0 && allowed === 0) bucket.zeroImpact += 1
  if (eventCard?.blockedSuits) {
    bucket.hardDenied += marketCards.filter((card) => base.has(card.id) && eventCard.blockedSuits?.includes(card.suit)).length
  }
  if (baseAction !== eventAction) {
    bucket.actionChanged += 1
    if (baseAction === 'scout' || eventAction === 'scout') bucket.scoutChanged += 1
    else bucket.buildChanged += 1
  }
}

function impactLine(label: string, bucket: ImpactBucket) {
  const n = bucket.decisions || 1
  const base = bucket.baseOptions / n
  const event = bucket.eventOptions / n
  const denied = bucket.denied / n
  const allowed = bucket.allowed / n
  return `${label}: base ${base.toFixed(2)} -> event ${event.toFixed(2)} playable, denied ${denied.toFixed(2)}, newly allowed ${allowed.toFixed(2)}, net ${(event - base).toFixed(2)}, action changed ${(100 * bucket.actionChanged / n).toFixed(1)}%, build swapped ${(100 * bucket.buildChanged / n).toFixed(1)}%, scout toggled ${(100 * bucket.scoutChanged / n).toFixed(1)}%, no option impact ${(100 * bucket.zeroImpact / n).toFixed(1)}%, hard-denied ${(bucket.hardDenied / n).toFixed(2)} (${bucket.decisions} decisions)`
}

function intendedAction(game: Game, players: Player[], player: Player, playable: Card[]) {
  if (shouldScout(player, [...playable], game.round)) return 'scout'
  return chooseBuild(game, players, player, [...playable]).id
}

function summarizeEventImpact(games: number) {
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
  const overall = emptyImpactBucket()
  const byEvent = Object.fromEntries(EVENTS.map((event) => [event.id, emptyImpactBucket()])) as Record<string, ImpactBucket>
  const byRound = Object.fromEntries(Array.from({ length: GAME_PHASES }, (_, index) => [index + 1, emptyImpactBucket()])) as Record<number, ImpactBucket>

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = [strategies[(seed - 1) % strategies.length], strategies[seed % strategies.length], strategies[(seed + 1) % strategies.length]]
    const random = rng(seed)
    const replayGame: Game = {
      deck: weightedDeck(random),
      market: [],
      discard: [],
      events: makeEventDeck(random, GAME_PHASES - 1),
      active: 0,
      round: 0,
      log: [],
      playableCounts: [],
      playableSamples: [],
      effectBuilds: 0,
      scouts: 0,
      chains: 0,
    }
    const replayPlayers = lineup.map((strategy, index) => makePlayer(['You', 'Supply Desk', 'Policy Shop'][index], strategy))
    seedOpeningMarket(replayGame)

    while (replayGame.round < GAME_PHASES) {
      startNextRound(replayGame, replayPlayers)

      let guard = 0
      while (!replayPlayers.every((player) => player.passed) && guard < 20) {
        guard += 1
        const player = replayPlayers[replayGame.active]
        const eventCard = replayGame.event
        const baseBudget = tableauBudget(player)
        const marketCards = replayGame.market
          .map((id) => id ? cards.get(id) : undefined)
          .filter((card): card is Card => Boolean(card))
        const basePlayable = new Set(marketCards.filter((card) => canPayWithBudget(baseBudget, card)).map((card) => card.id))
        const eventPlayable = new Set(marketCards.filter((card) => canPay(player, card, eventCard)).map((card) => card.id))
        const basePlayers = clonePlayers(replayPlayers)
        basePlayers.forEach((basePlayer) => {
          basePlayer.budget = tableauBudget(basePlayer)
        })
        const basePlayer = basePlayers[replayGame.active]
        const baseGame = { ...cloneGame(replayGame), event: undefined }
        const basePlayableCards = marketCards.filter((card) => basePlayable.has(card.id))
        const eventPlayableCards = marketCards.filter((card) => eventPlayable.has(card.id))
        const baseAction = intendedAction(baseGame, basePlayers, basePlayer, basePlayableCards)
        const eventAction = intendedAction(replayGame, replayPlayers, player, eventPlayableCards)

        addImpactSample(overall, basePlayable, eventPlayable, marketCards, eventCard, baseAction, eventAction)
        addImpactSample(byRound[replayGame.round], basePlayable, eventPlayable, marketCards, eventCard, baseAction, eventAction)
        if (eventCard) addImpactSample(byEvent[eventCard.id], basePlayable, eventPlayable, marketCards, eventCard, baseAction, eventAction)

        const playable = eventPlayableCards
        if (shouldScout(player, playable, replayGame.round)) {
          scout(replayGame, replayPlayers, player)
        } else {
          const best = chooseBuild(replayGame, replayPlayers, player, playable)
          const built = build(replayGame, replayPlayers, player, best.id)
          if (continuesAfterBuild(built)) continue
        }
        nextActive(replayGame, replayPlayers)
      }
    }
  }

  console.log(`Simulated ${games} games for event choice impact.`)
  console.log(impactLine('overall', overall))

  console.log('\nBy event:')
  for (const event of EVENTS) {
    console.log(impactLine(event.name, byEvent[event.id]))
  }

  console.log('\nBy phase:')
  for (const round of Object.keys(byRound).map(Number).sort((a, b) => a - b)) {
    console.log(impactLine(`phase ${round}`, byRound[round]))
  }
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
      bucket.builds += player.tableau.length
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

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function pearson(xValues: number[], yValues: number[]) {
  if (xValues.length !== yValues.length || xValues.length < 2) return 0
  const xAvg = average(xValues)
  const yAvg = average(yValues)
  let numerator = 0
  let xDenominator = 0
  let yDenominator = 0
  for (let index = 0; index < xValues.length; index += 1) {
    const xDelta = xValues[index] - xAvg
    const yDelta = yValues[index] - yAvg
    numerator += xDelta * yDelta
    xDenominator += xDelta * xDelta
    yDenominator += yDelta * yDelta
  }
  const denominator = Math.sqrt(xDenominator * yDenominator)
  return denominator === 0 ? 0 : numerator / denominator
}

function uniqueLeader(sample: PhaseSample | undefined) {
  return sample && sample.leaders.length === 1 ? sample.leaders[0] : undefined
}

function finalLeaders(players: Player[]) {
  const scores = players.map(scoreValue)
  const topScore = Math.max(...scores)
  return scores.map((score, index) => score === topScore ? index : -1).filter((index) => index >= 0)
}

function finalMargin(players: Player[]) {
  const scores = players.map(scoreValue).sort((a, b) => b - a)
  return scores[0] - (scores[1] ?? 0)
}

function buildIncomeValue(build: { cardId: string }) {
  return sumMap(productiveIncome(cards.get(build.cardId)!))
}

function buildVpValue(build: { cardId: string }) {
  return cards.get(build.cardId)!.vp
}

function summarizeFun(games: number) {
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
  let totalLeadChanges = 0
  let gamesWithLeadChange = 0
  let phase4LeaderSamples = 0
  let phase4LeaderOverturned = 0
  let phase8LeaderSamples = 0
  let phase8LeaderOverturned = 0
  let closeFinishes = 0
  let blowouts = 0
  const margins: number[] = []
  const playerRecords: Array<{
    earlyEngine: number
    earlyVp: number
    finalScore: number
    lateVp: number
    totalVp: number
    setupBuilds: number
    finisherBuilds: number
  }> = []

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = [strategies[(seed - 1) % strategies.length], strategies[seed % strategies.length], strategies[(seed + 1) % strategies.length]]
    const { game, players } = play(seed, lineup)
    const leaders = finalLeaders(players)
    const margin = finalMargin(players)
    margins.push(margin)
    if (margin <= 2) closeFinishes += 1
    if (margin >= 8) blowouts += 1

    let previousLeader: number | undefined
    let leadChanges = 0
    for (const sample of game.phaseSamples) {
      const leader = uniqueLeader(sample)
      if (leader === undefined) continue
      if (previousLeader !== undefined && leader !== previousLeader) leadChanges += 1
      previousLeader = leader
    }
    totalLeadChanges += leadChanges
    if (leadChanges > 0) gamesWithLeadChange += 1

    const phase4Leader = uniqueLeader(game.phaseSamples.find((sample) => sample.round === 4))
    if (phase4Leader !== undefined) {
      phase4LeaderSamples += 1
      if (!leaders.includes(phase4Leader)) phase4LeaderOverturned += 1
    }

    const phase8Leader = uniqueLeader(game.phaseSamples.find((sample) => sample.round === 8))
    if (phase8Leader !== undefined) {
      phase8LeaderSamples += 1
      if (!leaders.includes(phase8Leader)) phase8LeaderOverturned += 1
    }

    for (const player of players) {
      const earlyBuilds = player.buildHistory.filter((build) => build.round <= 4)
      const lateBuilds = player.buildHistory.filter((build) => build.round >= 8)
      const setupBuilds = earlyBuilds.filter((build) => {
        const card = cards.get(build.cardId)!
        return card.vp === 0 && buildIncomeValue(build) > 0
      }).length
      const finisherBuilds = player.buildHistory.filter((build) => {
        const card = cards.get(build.cardId)!
        return build.round >= 8 && (card.tier === 3 || card.vp >= 4)
      }).length
      playerRecords.push({
        earlyEngine: earlyBuilds.reduce((sum, build) => sum + buildIncomeValue(build), 0),
        earlyVp: earlyBuilds.reduce((sum, build) => sum + buildVpValue(build), 0),
        finalScore: scoreValue(player),
        lateVp: lateBuilds.reduce((sum, build) => sum + buildVpValue(build), 0),
        totalVp: scoreValue(player),
        setupBuilds,
        finisherBuilds,
      })
    }
  }

  const denominator = games || 1
  const sortedByEngine = [...playerRecords].sort((a, b) => a.earlyEngine - b.earlyEngine)
  const quartileSize = Math.max(1, Math.floor(sortedByEngine.length * 0.25))
  const bottomEngine = sortedByEngine.slice(0, quartileSize)
  const topEngine = sortedByEngine.slice(-quartileSize)
  const setupThenFinish = playerRecords.filter((record) => record.setupBuilds >= 2 && record.finisherBuilds >= 1)
  const others = playerRecords.filter((record) => !(record.setupBuilds >= 2 && record.finisherBuilds >= 1))
  const lateVpShares = playerRecords
    .filter((record) => record.totalVp > 0)
    .map((record) => record.lateVp / record.totalVp)

  console.log(`Simulated ${games} games for fun proxies.`)
  console.log(
    `Swing: avg lead changes ${(
      totalLeadChanges / denominator
    ).toFixed(2)}, games with lead change ${(100 * gamesWithLeadChange / denominator).toFixed(1)}%, phase-4 leader overturned ${(100 * phase4LeaderOverturned / (phase4LeaderSamples || 1)).toFixed(1)}% (${phase4LeaderSamples} clear leads), phase-8 leader overturned ${(100 * phase8LeaderOverturned / (phase8LeaderSamples || 1)).toFixed(1)}% (${phase8LeaderSamples} clear leads), close finishes <=2 VP ${(100 * closeFinishes / denominator).toFixed(1)}%, blowouts >=8 VP ${(100 * blowouts / denominator).toFixed(1)}%, avg final margin ${average(margins).toFixed(2)} VP.`,
  )
  console.log(
    `Planning: early engine-income correlation with final score ${pearson(
      playerRecords.map((record) => record.earlyEngine),
      playerRecords.map((record) => record.finalScore),
    ).toFixed(2)}, early VP correlation ${pearson(
      playerRecords.map((record) => record.earlyVp),
      playerRecords.map((record) => record.finalScore),
    ).toFixed(2)}, top-quartile early engine avg score ${average(topEngine.map((record) => record.finalScore)).toFixed(1)} vs bottom-quartile ${average(bottomEngine.map((record) => record.finalScore)).toFixed(1)}, setup-then-finisher avg score ${average(setupThenFinish.map((record) => record.finalScore)).toFixed(1)} (${setupThenFinish.length} players) vs others ${average(others.map((record) => record.finalScore)).toFixed(1)}, avg final VP built in phases 8-12 ${(100 * average(lateVpShares)).toFixed(1)}%.`,
  )
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
          bucket.builds += player.tableau.length
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
      totalBuilds += player.tableau.length
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

function summarizeWinnerTableaus(games: number) {
  const lineups: Strategy[][] = [
    ['moneyOnly', 'computeOnly', 'energyOnly'],
    ['moneyOnly', 'influenceOnly', 'computeOnly'],
    ['influenceOnly', 'energyOnly', 'computeOnly'],
    ['moneyOnly', 'influenceOnly', 'energyOnly'],
  ]
  const samples: Array<{ seed: number; strategy: Strategy; score: number; income: ResourceMap; cards: string[] }> = []
  const wins = new Map<Strategy, number>()

  for (let seed = 1; seed <= games; seed += 1) {
    const lineup = lineups[(seed - 1) % lineups.length]
    const { players } = play(seed, lineup)
    const winner = [...players].sort((a, b) => b.score - a.score)[0]
    wins.set(winner.strategy, (wins.get(winner.strategy) ?? 0) + 1)
    if (samples.length < 16 || winner.score >= samples[samples.length - 1].score) {
      samples.push({
        seed,
        strategy: winner.strategy,
        score: winner.score,
        income: winner.incomeBuilt,
        cards: winner.tableau.map((id) => cards.get(id)?.name ?? id),
      })
      samples.sort((a, b) => b.score - a.score)
      samples.splice(16)
    }
  }

  console.log(`Simulated ${games} archetype games.`)
  console.log('Wins by focus:')
  for (const [strategy, count] of [...wins.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${strategy}: ${count}`)
  }

  console.log('\nHigh-scoring winner tableaus:')
  for (const sample of samples.slice(0, 8)) {
    console.log(`seed ${sample.seed}, ${sample.strategy}, ${sample.score} VP, income ${JSON.stringify(sample.income)}`)
    console.log(`  ${sample.cards.join(' -> ')}`)
  }
}

const mode = process.argv[2] ?? 'single'
if (mode === 'batch') summarizeBatch(Number(process.argv[3] ?? 100))
else if (mode === 'duel') summarizeDuelBatch(Number(process.argv[3] ?? 50))
else if (mode === 'cards') summarizeCardStats(Number(process.argv[3] ?? 1000))
else if (mode === 'mirror') summarizeApexMirror(Number(process.argv[3] ?? 500))
else if (mode === 'options') summarizeOptions(Number(process.argv[3] ?? 500), process.argv[4] === 'nonstarter' ? 'nonstarter' : 'all')
else if (mode === 'events') summarizeEventImpact(Number(process.argv[3] ?? 500))
else if (mode === 'fun') summarizeFun(Number(process.argv[3] ?? 500))
else if (mode === 'tableaus') summarizeWinnerTableaus(Number(process.argv[3] ?? 100))
else summarizeSingle(Number(mode))
