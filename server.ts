import express from 'express'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import {
  CARDS,
  EVENTS,
  MARKET_SIZE,
  RESOURCES,
  OPENING_MARKET_CARD_IDS,
  type Card,
  type EventCard,
  type Resource,
  type ResourceMap,
  type TrackMap,
  continuesAfterBuild,
  emptyTracks,
  effectiveCost,
  productiveIncome,
  shockEventForCard,
} from './src/game.js'

type Player = {
  id: string
  name: string
  isBot?: boolean
  focus?: Resource[]
  resources: ResourceMap
  tracks: TrackMap
  tableau: string[]
  passed: boolean
  initiative: boolean
  actionsThisPhase: number
  actionsTaken: number
  cardsBuilt: number
  score: number
}

type Game = {
  id: string
  status: 'lobby' | 'playing' | 'finished'
  round: number
  maxRounds: number
  activePlayer: number
  deck: string[]
  market: string[]
  discard: string[]
  eventDeck: string[]
  event: string | null
  priorityPlayerId: string | null
  log: string[]
}

type Room = {
  id: string
  hostId: string
  players: Player[]
  game: Game
}

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*' },
})

const rooms = new Map<string, Room>()
const cardsById = new Map(CARDS.map((card) => [card.id, card]))
const eventsById = new Map(EVENTS.map((event) => [event.id, event]))
const DEFAULT_ROOM_ID = 'POC'
let gameSequence = 0

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))
app.get('/healthz', (_req, res) => res.json({ ok: true }))
app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')))

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)]
  return rooms.has(code) ? roomCode() : code
}

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function weightedDeck() {
  const early = shuffle(CARDS.filter((card) => card.era === 'early').map((card) => card.id))
  const mid = shuffle(CARDS.filter((card) => card.era === 'mid').map((card) => card.id))
  const late = shuffle(CARDS.filter((card) => card.era === 'late').map((card) => card.id))
  const deck: string[] = []

  while (early.length || mid.length || late.length) {
    deck.push(...early.splice(0, 4))
    deck.push(...mid.splice(0, 2))
    deck.push(...late.splice(0, 1))
  }

  return deck
}

function startingResources(): ResourceMap {
  return { money: 0, influence: 0, compute: 0, energy: 0 }
}

function freshPlayer(id: string, name: string, isBot = false, focus?: Resource[]): Player {
  return {
    id,
    name: name.trim().slice(0, 18) || (isBot ? 'Bot' : 'Player'),
    isBot,
    focus,
    resources: startingResources(),
    tracks: emptyTracks(),
    tableau: [],
    passed: false,
    initiative: false,
    actionsThisPhase: 0,
    actionsTaken: 0,
    cardsBuilt: 0,
    score: 0,
  }
}

function newGame(): Game {
  return {
    id: `lobby-${Date.now()}-${gameSequence}`,
    status: 'lobby',
    round: 0,
    maxRounds: 8,
    activePlayer: 0,
    deck: [],
    market: [],
    discard: [],
    eventDeck: [],
    event: null,
    priorityPlayerId: null,
    log: ['Room created. Add players, then start the first supply phase.'],
  }
}

function view(room: Room) {
  return {
    ...room,
    cards: CARDS,
    events: EVENTS,
  }
}

function broadcast(room: Room) {
  io.to(room.id).emit('room', view(room))
}

function log(room: Room, line: string) {
  room.game.log = [line, ...room.game.log].slice(0, 18)
}

function currentEvent(room: Room): EventCard | undefined {
  return room.game.event ? eventsById.get(room.game.event) : undefined
}

function claimPriority(room: Room, player: Player) {
  if (room.game.priorityPlayerId) return false
  room.players.forEach((candidate) => {
    candidate.initiative = false
  })
  player.initiative = true
  room.game.priorityPlayerId = player.id
  return true
}

function cardCost(room: Room, card: Card): ResourceMap {
  return effectiveCost(card, currentEvent(room))
}

function replaceNextEvent(room: Room, forcedEventId: string) {
  if (room.game.eventDeck.length === 0) return false
  room.game.eventDeck[0] = forcedEventId
  return true
}

function canPay(player: Player, cost: ResourceMap) {
  return RESOURCES.every((resource) => player.resources[resource] >= cost[resource])
}

function sumMap(values?: Partial<ResourceMap>) {
  return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0)
}

function botFocusValue(player: Player, card: Card) {
  if (!player.focus?.length) return 0

  const focus = new Set(player.focus)
  const income = productiveIncome(card)
  let value = 0
  for (const resource of RESOURCES) {
    const focused = focus.has(resource)
    const cardIncome = income?.[resource] ?? 0
    const cardCost = card.cost[resource] ?? 0

    if (focused) {
      value += cardIncome * 9
      value += cardCost * 0.7
    } else {
      value -= cardCost * 2
      value -= cardIncome
    }
  }

  return value
}

function botCardValue(room: Room, player: Player, card: Card) {
  const incomeValue = sumMap(productiveIncome(card))
  const effectValue = card.effect
    ? ({ priority: 7, shock: 9 } as Record<string, number>)[card.effect]
    : 0
  const lateVpValue = room.game.round >= 7 ? card.vp * 8 : card.vp * 4

  return lateVpValue + incomeValue * 4 + effectValue + botFocusValue(player, card)
}

function fillMarket(room: Room) {
  while (room.game.market.length < MARKET_SIZE) {
    const cardId = room.game.deck.shift()
    if (!cardId) break
    room.game.market.push(cardId)
  }
}

function seedOpeningMarket(room: Room) {
  for (const cardId of OPENING_MARKET_CARD_IDS) {
    const index = room.game.deck.indexOf(cardId)
    if (index >= 0) room.game.deck.splice(index, 1)
  }
  room.game.market.push(...OPENING_MARKET_CARD_IDS)
  fillMarket(room)
}

function cycleMarketCards(room: Room, cardIds: string[]) {
  const removed: string[] = []
  for (const cardId of cardIds) {
    const index = room.game.market.indexOf(cardId)
    if (index < 0) continue
    const [removedId] = room.game.market.splice(index, 1)
    removed.push(removedId)
  }
  room.game.discard.push(...removed)
  fillMarket(room)
  return removed
}

function phaseBudget(player: Player, event?: EventCard): ResourceMap {
  const budget = startingResources()
  for (const cardId of player.tableau) {
    const card = cardsById.get(cardId)
    if (!card) continue
    const income = productiveIncome(card)
    if (!income) continue
    for (const resource of RESOURCES) budget[resource] += income[resource] ?? 0
  }
  if (event?.incomeMod) {
    for (const resource of RESOURCES) budget[resource] = Math.max(0, budget[resource] + (event.incomeMod[resource] ?? 0))
  }
  return budget
}

function startRound(room: Room) {
  const game = room.game
  game.round += 1
  game.event = game.eventDeck.shift() ?? shuffle(EVENTS.map((event) => event.id))[0]
  const event = currentEvent(room)
  room.players.forEach((player) => {
    player.passed = false
    player.actionsThisPhase = 0
    player.resources = phaseBudget(player, event)
  })
  const initiativeIndex = room.game.priorityPlayerId
    ? room.players.findIndex((player) => player.id === room.game.priorityPlayerId)
    : -1
  game.activePlayer = initiativeIndex >= 0 ? initiativeIndex : (game.round - 1) % room.players.length
  room.players.forEach((player) => {
    player.initiative = false
  })
  game.priorityPlayerId = null
  log(room, `Phase ${game.round}: ${event?.name ?? 'Open Market'} is active.`)
}

function startGame(room: Room) {
  room.players.forEach((player) => {
    player.resources = startingResources()
    player.tracks = emptyTracks()
    player.tableau = []
    player.passed = false
    player.initiative = false
    player.actionsThisPhase = 0
    player.actionsTaken = 0
    player.cardsBuilt = 0
    player.score = 0
  })
  room.game = {
    id: `${room.id}-${Date.now()}-${gameSequence += 1}`,
    status: 'playing',
    round: 0,
    maxRounds: 8,
    activePlayer: 0,
    deck: weightedDeck(),
    market: [],
    discard: [],
    eventDeck: shuffle(EVENTS.map((event) => event.id)).slice(0, 8),
    event: null,
    priorityPlayerId: null,
    log: [],
  }
  seedOpeningMarket(room)
  startRound(room)
}

function nextActive(room: Room) {
  const game = room.game
  if (room.players.every((player) => player.passed)) {
    finishRound(room)
    return
  }

  for (let step = 1; step <= room.players.length; step += 1) {
    const index = (game.activePlayer + step) % room.players.length
    if (!room.players[index].passed) {
      game.activePlayer = index
      return
    }
  }
}

function applyEffect(room: Room, player: Player, card: Card) {
  switch (card.effect) {
    case 'priority':
      if (claimPriority(room, player)) {
        log(room, `${player.name} took next-phase initiative with ${card.name}.`)
      } else {
        log(room, `${player.name} built ${card.name}, but Priority Card was already claimed.`)
      }
      break
    case 'shock': {
      const forcedEventId = shockEventForCard(card)
      const event = eventsById.get(forcedEventId)
      if (replaceNextEvent(room, forcedEventId)) {
        log(room, `${player.name} queued ${event?.name ?? 'a forced event'} as the next crisis.`)
      } else {
        log(room, `${player.name} built ${card.name}, but there is no future crisis to replace.`)
      }
      break
    }
  }
}

function buildCard(room: Room, player: Player, cardId: string) {
  const card = cardsById.get(cardId)
  if (!card) return 'Unknown card.'
  if (room.game.market.includes(cardId) === false) return 'That card is not in the market.'

  const cost = cardCost(room, card)
  if (!canPay(player, cost)) return 'Not enough resources.'

  for (const resource of RESOURCES) player.resources[resource] -= cost[resource]

  player.actionsThisPhase += 1
  player.actionsTaken += 1
  player.cardsBuilt += 1
  player.tableau.push(cardId)
  room.game.market = room.game.market.filter((id) => id !== cardId)
  fillMarket(room)
  applyEffect(room, player, card)
  player.passed = !continuesAfterBuild(card)
  log(room, `${player.name} built ${card.name}.`)
  if (continuesAfterBuild(card)) return
  nextActive(room)
}

function startScout(room: Room, player: Player) {
  const removed = cycleMarketCards(room, room.game.market.slice(0, 2))
  const claimedPriority = claimPriority(room, player)
  player.actionsThisPhase += 1
  player.actionsTaken += 1
  player.passed = true
  log(
    room,
    claimedPriority
      ? `${player.name} scouted the market, cycled ${removed.length} cards, and took next-phase initiative.`
      : `${player.name} scouted the market and cycled ${removed.length} cards. Priority Card was already claimed.`,
  )
  nextActive(room)
}

function finishRound(room: Room) {
  if (room.game.round >= room.game.maxRounds) {
    finishGame(room)
  } else {
    startRound(room)
  }
}

function finishGame(room: Room) {
  room.game.status = 'finished'
  room.players.forEach((player) => {
    const cardVp = player.tableau.reduce((sum, cardId) => sum + (cardsById.get(cardId)?.vp ?? 0), 0)
    player.score = cardVp
  })
  log(room, 'Game finished. Printed VP on built cards has been scored.')
}

function botAct(room: Room) {
  const player = room.players[room.game.activePlayer]
  if (!player?.isBot || room.game.status !== 'playing') return

  const affordable = room.game.market
    .map((id) => cardsById.get(id)!)
    .filter((card) => canPay(player, cardCost(room, card)))
    .sort((a, b) => botCardValue(room, player, b) - botCardValue(room, player, a))

  if (affordable[0] && (room.game.round > 3 || affordable.length > 2 || botFocusValue(player, affordable[0]) >= 2)) {
    buildCard(room, player, affordable[0].id)
  } else {
    startScout(room, player)
  }

  setTimeout(() => {
    if (room.game.status === 'playing' && room.players[room.game.activePlayer]?.isBot) botAct(room)
    broadcast(room)
  }, 450)
}

io.on('connection', (socket) => {
  socket.on('joinDefault', ({ name }: { name: string }, ack) => {
    const existingRoom = rooms.get(DEFAULT_ROOM_ID)
    if (existingRoom) {
      const human = existingRoom.players.find((player) => !player.isBot)
      if (human) {
        const previousId = human.id
        human.id = socket.id
        human.name = name?.trim().slice(0, 18) || human.name
        if (existingRoom.game.priorityPlayerId === previousId) existingRoom.game.priorityPlayerId = socket.id
      }
      existingRoom.hostId = socket.id
      socket.join(DEFAULT_ROOM_ID)
      ack?.(view(existingRoom))
      broadcast(existingRoom)
      return
    }

    const room: Room = {
      id: DEFAULT_ROOM_ID,
      hostId: socket.id,
      players: [
        freshPlayer(socket.id, name || 'Green GPU Co.'),
        freshPlayer('bot-red-accelerators', 'Red Accelerators', true, ['money', 'compute']),
        freshPlayer('bot-blue-silicon', 'Blue Silicon', true, ['influence', 'energy']),
      ],
      game: newGame(),
    }
    rooms.set(DEFAULT_ROOM_ID, room)
    socket.join(DEFAULT_ROOM_ID)
    startGame(room)
    ack?.(view(room))
    broadcast(room)
    if (room.players[room.game.activePlayer]?.isBot) botAct(room)
  })

  socket.on('createRoom', ({ name }: { name: string }, ack) => {
    const id = roomCode()
    const room: Room = {
      id,
      hostId: socket.id,
      players: [freshPlayer(socket.id, name)],
      game: newGame(),
    }
    rooms.set(id, room)
    socket.join(id)
    ack?.(view(room))
    broadcast(room)
  })

  socket.on('joinRoom', ({ roomId, name }: { roomId: string; name: string }, ack) => {
    const room = rooms.get(roomId.toUpperCase())
    if (!room) return ack?.({ error: 'Room not found.' })
    if (room.game.status !== 'lobby') return ack?.({ error: 'That game has already started.' })
    if (room.players.length >= 4) return ack?.({ error: 'Room is full.' })
    room.players.push(freshPlayer(socket.id, name))
    socket.join(room.id)
    ack?.(view(room))
    broadcast(room)
  })

  socket.on('addBot', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId)
    if (!room || room.hostId !== socket.id || room.game.status !== 'lobby' || room.players.length >= 4) return
    room.players.push(freshPlayer(`bot-${Date.now()}`, `Bot ${room.players.length}`, true))
    broadcast(room)
  })

  socket.on('startGame', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId)
    if (!room || room.hostId !== socket.id || room.players.length < 2) return
    startGame(room)
    broadcast(room)
    if (room.players[room.game.activePlayer]?.isBot) botAct(room)
  })

  socket.on('build', ({ roomId, cardId }: { roomId: string; cardId: string }) => {
    const room = rooms.get(roomId)
    if (!room || room.game.status !== 'playing') return
    const player = room.players[room.game.activePlayer]
    if (!player || player.id !== socket.id) return
    const error = buildCard(room, player, cardId)
    if (error) socket.emit('notice', error)
    broadcast(room)
    if (room.players[room.game.activePlayer]?.isBot) botAct(room)
  })

  socket.on('pass', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId)
    if (!room || room.game.status !== 'playing') return
    const player = room.players[room.game.activePlayer]
    if (!player || player.id !== socket.id) return
    const error = startScout(room, player)
    if (error) socket.emit('notice', error)
    broadcast(room)
    if (room.players[room.game.activePlayer]?.isBot) botAct(room)
  })

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.id === socket.id)
      if (!player || room.game.status !== 'lobby') continue
      room.players = room.players.filter((p) => p.id !== socket.id)
      if (room.players.length === 0) rooms.delete(room.id)
      else {
        room.hostId = room.players[0].id
        broadcast(room)
      }
    }
  })
})

const port = Number(process.env.PORT ?? 3001)
httpServer.listen(port, () => {
  console.log(`GPU supply chain game server listening on ${port}`)
})
