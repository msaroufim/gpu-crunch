import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  Banknote,
  BookOpen,
  Cpu,
  Factory,
  Handshake,
  Hourglass,
  Search,
  SkipForward,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
import {
  CARDS,
  EVENTS,
  RESOURCES,
  cardRole,
  effectRules,
  effectiveCost,
  productiveIncome,
  resourceLabels,
  roleHelp,
  shockEventForCard,
  type Card,
  type EventCard,
  type Resource,
  type ResourceMap,
  type TrackMap,
} from './game'
import './App.css'

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
  market: (string | null)[]
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
  cards: Card[]
  events: EventCard[]
}

type VictoryRecord = {
  wins: number
  bestScore: number
  games: number
}

type VictoryRecords = Record<string, VictoryRecord>

const socketUrl =
  import.meta.env.VITE_SOCKET_URL ??
  (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : window.location.origin)

const resourceIcons: Record<Resource, typeof Banknote> = {
  money: Banknote,
  influence: Handshake,
  compute: Cpu,
  energy: Zap,
}

const victoryRecordKey = 'gpu-crunch-victory-records'
const recordedGamesKey = 'gpu-crunch-recorded-games'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function useVictoryRecords(room: Room) {
  const [records, setRecords] = useState<VictoryRecords>(() => readJson<VictoryRecords>(victoryRecordKey, {}))

  useEffect(() => {
    if (room.game.status !== 'finished') return

    const recorded = readJson<string[]>(recordedGamesKey, [])
    if (recorded.includes(room.game.id)) return

    const bestScore = Math.max(...room.players.map((player) => player.score))
    const winners = new Set(room.players.filter((player) => player.score === bestScore).map((player) => player.name))
    const next = { ...records }

    for (const player of room.players) {
      const current = next[player.name] ?? { wins: 0, bestScore: 0, games: 0 }
      next[player.name] = {
        wins: current.wins + (winners.has(player.name) ? 1 : 0),
        bestScore: Math.max(current.bestScore, player.score),
        games: current.games + 1,
      }
    }

    writeJson(victoryRecordKey, next)
    writeJson(recordedGamesKey, [...recorded, room.game.id].slice(-50))
    window.setTimeout(() => setRecords(next), 0)
  }, [records, room.game.id, room.game.status, room.players])

  return records
}

const artGlyphs: Record<Card['art'], string> = {
  fab: '晶',
  memory: 'HBM',
  package: '2.5D',
  power: 'MW',
  policy: '§',
  cloud: '☁',
  network: 'IB',
  software: '{}',
  market: '$',
  risk: '!',
  toast: '乾',
  cooling: '°C',
}

function useSocket() {
  const [socket] = useState<Socket>(() => io(socketUrl))

  useEffect(() => {
    return () => {
      socket.disconnect()
    }
  }, [socket])

  return socket
}

function focusText(player: Player) {
  return player.focus?.map((resource) => resourceLabels[resource]).join(' + ')
}

function actionStatus(player: Player, active?: boolean) {
  if (active) return 'Acting now'
  return player.actionsThisPhase > 0 ? 'Acted this phase' : 'Pending'
}

function adjustedCost(card: Card, event?: EventCard): ResourceMap {
  return effectiveCost(card, event)
}

function canBuild(player: Player | undefined, card: Card, event?: EventCard) {
  if (!player) return false
  const cost = adjustedCost(card, event)
  return RESOURCES.every((resource) => player.resources[resource] >= cost[resource])
}

function ResourcePip({ resource, value }: { resource: Resource; value: number }) {
  const Icon = resourceIcons[resource]
  return (
    <span className={`pip ${resource}`} title={resourceLabels[resource]}>
      <Icon size={14} />
      {value}
    </span>
  )
}

function ResourceCluster({
  values,
  event,
  kind,
}: {
  values?: Partial<ResourceMap>
  event?: EventCard
  kind: 'income' | 'cost'
}) {
  const normalized = RESOURCES.map((resource) => {
    const raw = values?.[resource] ?? 0
    const adjusted = kind === 'cost' ? Math.max(0, raw + (event?.costMod?.[resource] ?? 0)) : raw
    return [resource, adjusted] as const
  }).filter(([, value]) => value > 0)

  if (normalized.length === 0) return <span className="empty-cluster">0</span>

  return (
    <span className={`card-resource-cluster ${kind}`}>
      {normalized.map(([resource, value]) => {
        const Icon = resourceIcons[resource]
        return (
          <span key={resource} title={resourceLabels[resource]}>
            <Icon size={13} />
            {value}
          </span>
        )
      })}
    </span>
  )
}

function CardView({
  card,
  event,
  owner,
  compact = false,
  disabled = false,
  highlighted = false,
  requiresAffordable = true,
  actionLabel = 'Build',
  onBuild,
}: {
  card: Card
  event?: EventCard
  owner?: Player
  compact?: boolean
  disabled?: boolean
  highlighted?: boolean
  requiresAffordable?: boolean
  actionLabel?: string
  onBuild?: () => void
}) {
  const affordable = owner ? canBuild(owner, card, event) : true
  const effect = card.effect ? effectRules[card.effect] : undefined
  const forcedEvent = card.effect === 'shock'
    ? EVENTS.find((candidate) => candidate.id === shockEventForCard(card))
    : undefined
  const effectText = forcedEvent ? `${effect?.text} Next: ${forcedEvent.name}.` : effect?.text
  const displayCost = effectiveCost(card, event)
  const blockedByEvent = RESOURCES.some((resource) => displayCost[resource] >= 50)

  return (
    <article className={`game-card tier-${card.tier} ${card.starter ? 'starter-card' : ''} ${compact ? 'compact' : ''} ${highlighted ? 'market-choice' : ''} art-${card.art}`}>
      <div className="card-topline">
        <div className="card-corner">
          <small>Income</small>
          <ResourceCluster values={productiveIncome(card)} kind="income" />
        </div>
        <div className="card-corner right">
          <small>Cost</small>
          {card.starter && !blockedByEvent ? <span className="starter-cost">Free</span> : <ResourceCluster values={displayCost} kind="cost" />}
        </div>
      </div>
      <div className="card-art" aria-hidden="true">
        <span>{artGlyphs[card.art]}</span>
      </div>
      <div className="card-name-row">
        <span>{card.suit}</span>
        <strong>{card.vp} VP</strong>
      </div>
      <div className="card-tags">
        {card.starter && <div className="starter-chip" title="Free opening card">START</div>}
        <div className="role-chip" title={roleHelp[cardRole(card)]}>{cardRole(card)}</div>
      </div>
      <h3>{card.name}</h3>
      {!compact && <p>{card.flavor}</p>}
      {!compact && effect && (
        <div className="special-box">
          <span>Buff</span>
          <b>{effect.name}</b>
          <em>{effectText}</em>
        </div>
      )}
      {onBuild && (
        <button type="button" className="build-button" disabled={disabled || (requiresAffordable && !affordable)} onClick={onBuild}>
          <Factory size={15} />
          {actionLabel}
        </button>
      )}
    </article>
  )
}

function seatTone(index: number) {
  return ['seat-green', 'seat-red', 'seat-blue', 'seat-neutral'][index] ?? 'seat-neutral'
}

function PlayerPanel({
  player,
  active,
  you,
  seat,
  record,
}: {
  player: Player
  active: boolean
  you: boolean
  seat: string
  record?: VictoryRecord
}) {
  return (
    <section className={`player-panel ${seat} ${active ? 'active' : ''} ${you ? 'you' : ''}`}>
      <div className="player-heading">
        <strong>
          {player.name}
          {you ? ' you' : ''}
        </strong>
        {active && <Hourglass size={16} />}
      </div>
      <div className="turn-stats">
        <span>{actionStatus(player, active)}</span>
        <span>{player.actionsTaken} turns</span>
        <span>{record?.wins ?? 0} wins</span>
      </div>
      {player.initiative && <div className="priority-badge">Holds Priority Card</div>}
      {player.focus?.length ? <p className="focus-label">{focusText(player)}</p> : null}
      <div className="resource-grid">
        {RESOURCES.map((resource) => (
          <ResourcePip key={resource} resource={resource} value={player.resources[resource]} />
        ))}
      </div>
      <div className="tableau-strip">
        {player.tableau.slice(-5).map((cardId) => {
          const card = CARDS.find((candidate) => candidate.id === cardId)
          return card ? <span key={cardId}>{card.name}</span> : null
        })}
      </div>
    </section>
  )
}

function PriorityCard({ owner }: { owner?: Player }) {
  return (
    <section className={`priority-card ${owner ? 'claimed' : ''}`}>
      <div className="priority-card-top">
        <span>Turn Order</span>
        <Hourglass size={16} />
      </div>
      <h2>Priority Card</h2>
      <p>{owner ? `${owner.name} acts first next phase.` : 'Unclaimed. Next phase starts by seat rotation.'}</p>
    </section>
  )
}

function ShockQueue({ current, upcoming }: { current?: EventCard; upcoming: EventCard[] }) {
  return (
    <section className="shock-queue">
      <div className="shock-card current">
        <span>Now</span>
        <strong>{current?.name ?? 'Open Market'}</strong>
        <p>{current?.rule ?? 'No modifier this phase.'}</p>
      </div>
      {upcoming.map((event, index) => (
        <div className="shock-card" key={`${event.id}-${index}`}>
          <span>Next {index + 1}</span>
          <strong>{event.name}</strong>
          <p>{event.rule}</p>
        </div>
      ))}
    </section>
  )
}

function Scoreboard({ room, records }: { room: Room; records: VictoryRecords }) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score)

  return (
    <section className="scoreboard">
      <h2>Final Scores</h2>
      {sorted.map((player, index) => (
        <div className="score-line" key={player.id}>
          <span>
            {index === 0 && <Trophy size={16} />}
            {player.name}
          </span>
          <strong>{player.score} VP</strong>
          <small>{records[player.name]?.wins ?? 0} wins</small>
        </div>
      ))}
    </section>
  )
}

function VictoryScreen({
  room,
  records,
  onNewGame,
}: {
  room: Room
  records: VictoryRecords
  onNewGame: () => void
}) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score)
  const topScore = sorted[0]?.score ?? 0
  const winners = sorted.filter((player) => player.score === topScore)
  const headline = winners.length === 1 ? `${winners[0].name} wins` : `${winners.map((player) => player.name).join(' + ')} tie`

  return (
    <section className="victory-screen">
      <div className="victory-head">
        <span>Game complete</span>
        <h2>{headline}</h2>
        <p>Final score is printed VP on built cards.</p>
      </div>
      <div className="victory-table">
        {sorted.map((player, index) => {
          const record = records[player.name]
          return (
            <div className="victory-row" key={player.id}>
              <span>{index + 1}</span>
              <strong>{player.name}</strong>
              <b>{player.score} VP</b>
              <em>{record?.wins ?? 0} wins · best {record?.bestScore ?? player.score}</em>
            </div>
          )
        })}
      </div>
      <button type="button" onClick={onNewGame}>
        <Trophy size={16} />
        New Game
      </button>
    </section>
  )
}

function TableauZone({
  title,
  player,
  cards,
  event,
  isYou = false,
  seat,
}: {
  title: string
  player: Player
  cards: Map<string, Card>
  event?: EventCard
  isYou?: boolean
  seat: string
}) {
  return (
    <section className={`tableau-zone ${seat} ${isYou ? 'mine' : ''}`}>
      <div className="zone-title">
        <div>
          <span>{title}</span>
          <h2>{player.name}</h2>
          {player.focus?.length ? <p className="focus-label">{focusText(player)}</p> : null}
          <p className="turn-line">
            {player.actionsTaken} turns · {player.cardsBuilt} built
          </p>
        </div>
      </div>
      <div className="tableau-cards">
        {player.tableau.length === 0 && <p className="empty-zone">No tableau cards yet.</p>}
        {player.tableau.map((cardId) => {
          const card = cards.get(cardId)
          return card ? <CardView key={cardId} card={card} event={event} compact={!isYou} /> : null
        })}
      </div>
    </section>
  )
}

function MarketRow({
  market,
  cards,
  event,
  owner,
  disabled,
  onBuild,
}: {
  market: (string | null)[]
  cards: Map<string, Card>
  event?: EventCard
  owner?: Player
  disabled: boolean
  onBuild: (cardId: string) => void
}) {
  return (
    <section className="market-zone">
      <div className="section-heading">
        <div>
          <span>Common market</span>
          <h2>Available supply</h2>
        </div>
      </div>
      <div className="market-cards">
        {market.map((cardId, index) => {
          if (!cardId) {
            return (
              <div className="market-empty-slot" key={`empty-${index}`}>
                <span>Empty slot</span>
                <p>Scout fills one open supply slot.</p>
              </div>
            )
          }
          const card = cards.get(cardId)
          return card ? (
            <CardView
              key={`${cardId}-${index}`}
              card={card}
              event={event}
              owner={owner}
              disabled={disabled}
              actionLabel="Build"
              onBuild={() => onBuild(cardId)}
            />
          ) : null
        })}
      </div>
    </section>
  )
}

function BrokenMechanics() {
  const families = Object.values(effectRules)
  return (
    <section className="rules-box">
      <h2>Broken Mechanics</h2>
      <div className="mechanic-list">
        {families.map((effect) => (
          <p key={effect.name}>
            <strong>{effect.name}</strong>
            <span>{effect.text}</span>
          </p>
        ))}
      </div>
    </section>
  )
}

function ComboGuide() {
  const combos = [
    ['Scout -> Priority', 'Skip a weak market, fill one empty market slot, and act first when the next phase opens.'],
    ['Priority -> Market Snipe', 'Take initiative before a visible late card or key resource card gets contested.'],
    ['Shock -> Bad Window', 'Replace the next visible crisis so everyone can see the bad window coming.'],
    ['Income -> Finisher', 'Build reusable income early so expensive VP cards become reachable later.'],
  ]

  return (
    <section className="rules-box">
      <h2>Combos</h2>
      <div className="mechanic-list">
        {combos.map(([name, text]) => (
          <p key={name}>
            <strong>{name}</strong>
            <span>{text}</span>
          </p>
        ))}
      </div>
    </section>
  )
}

function Glossary({ cards, onClose }: { cards: Card[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const filtered = cards.filter((card) => {
    const haystack = `${card.name} ${card.suit} ${card.flavor} ${card.effect ?? ''}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Card glossary">
      <section className="glossary">
        <div className="glossary-header">
          <div>
            <span>52-card deck</span>
            <h2>Card Glossary</h2>
          </div>
          <button type="button" className="secondary icon-button" onClick={onClose} aria-label="Close glossary">
            <X size={18} />
          </button>
        </div>
        <label className="search-box" htmlFor="card-search">
          <Search size={16} />
          <input
            id="card-search"
            value={query}
            placeholder="Search card, suit, or buff"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="glossary-grid">
          {filtered.map((card) => (
            <CardView key={card.id} card={card} />
          ))}
        </div>
      </section>
    </div>
  )
}

function GameBoard({ socket, room }: { socket: Socket | null; room: Room }) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const records = useVictoryRecords(room)
  const cards = useMemo(() => new Map(room.cards.map((card) => [card.id, card])), [room.cards])
  const events = useMemo(() => new Map(room.events.map((event) => [event.id, event])), [room.events])
  const event = room.game.event ? events.get(room.game.event) : undefined
  const upcomingEvents = room.game.eventDeck.map((eventId) => events.get(eventId)).filter((candidate): candidate is EventCard => Boolean(candidate))
  const activePlayer = room.players[room.game.activePlayer]
  const priorityOwner = room.players.find((player) => player.id === room.game.priorityPlayerId)
  const you = room.players.find((player) => player.id === socket?.id)
  const opponents = room.players.filter((player) => player.id !== socket?.id)
  const yourTurn = Boolean(you && activePlayer?.id === you.id && room.game.status === 'playing')

  return (
    <main className="game-shell">
      <header className="game-header">
        <div>
          <h1>GPU Crunch</h1>
          <p>
            Default POC game · Phase {room.game.round}/{room.game.maxRounds} · Deck {room.game.deck.length}
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => setGlossaryOpen(true)}>
            <BookOpen size={16} />
            Glossary
          </button>
        </div>
      </header>

      <section className="event-band">
        <div>
          <span>Current shock</span>
          <h2>{event?.name ?? 'Open Market'}</h2>
        </div>
        <p>{event?.rule ?? 'No modifier this phase.'}</p>
      </section>

      <ShockQueue current={event} upcoming={upcomingEvents} />

      <div className="board-layout">
        <aside className="left-rail">
          <PriorityCard owner={priorityOwner} />
          {room.players.map((player, index) => (
            <PlayerPanel
              key={player.id}
              player={player}
              active={index === room.game.activePlayer && room.game.status === 'playing'}
              you={player.id === socket?.id}
              seat={seatTone(index)}
              record={records[player.name]}
            />
          ))}
          {room.game.status === 'finished' && <Scoreboard room={room} records={records} />}
        </aside>

        <section className="play-area">
          {room.game.status === 'finished' && (
            <VictoryScreen
              room={room}
              records={records}
              onNewGame={() => socket?.emit('startGame', { roomId: room.id })}
            />
          )}
          <MarketRow
            market={room.game.market ?? []}
            cards={cards}
            event={event}
            owner={you}
            disabled={!yourTurn}
            onBuild={(cardId) => socket?.emit('build', { roomId: room.id, cardId })}
          />

          <section className="opponent-zone">
            <div className="section-heading">
              <div>
                <span>Everyone else</span>
                <h2>{activePlayer?.id === socket?.id ? 'Your move' : `${activePlayer?.name ?? 'Player'} is deciding`}</h2>
              </div>
            </div>
            <div className="opponent-tableaus">
              {opponents.map((player) => (
                <TableauZone
                  key={player.id}
                  title="Opponent tableau"
                  player={player}
                  cards={cards}
                  event={event}
                  seat={seatTone(room.players.findIndex((candidate) => candidate.id === player.id))}
                />
              ))}
            </div>
          </section>

          {you && (
            <TableauZone
              title="My tableau"
              player={you}
              cards={cards}
              event={event}
              isYou
              seat={seatTone(room.players.findIndex((candidate) => candidate.id === you.id))}
            />
          )}

          <section className="action-dock">
            <div className="section-heading">
              <div>
                <span>Action</span>
                <h2>{yourTurn ? 'Build from the market or scout it' : 'Waiting for your next action'}</h2>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={!yourTurn}
                onClick={() => socket?.emit('pass', { roomId: room.id })}
              >
                <SkipForward size={16} />
                Scout
              </button>
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <section className="rules-box">
            <h2>Scoring</h2>
            <p>Income icons in a card's top-left are temporary budget each phase. Spend them or lose them.</p>
            <p>You start at 0 resources. START cards are free, but building one still uses your one action for the shock.</p>
            <p>Cards with 3+ VP are point cards: they do not produce income, and printed VP above 2 makes their printed cost harsher.</p>
            <p>You are rival GPU vendors racing through the same supply crunch. Seats are vendor-coded green, red, and blue.</p>
            <p>Each shock is one phase. Each player gets one action per shock: build one card or Scout.</p>
            <p>Scout skips your build and fills one empty market slot from the deck. The first Priority claim each phase acts first next phase.</p>
            <p>All builds come from the common market. No cards are hidden from the table.</p>
            <p>Final score is only printed VP on built cards. Unspent budget is discarded.</p>
          </section>
          <BrokenMechanics />
          <ComboGuide />
          <section className="rules-box">
            <h2>Log</h2>
            <ol className="log-list">
              {room.game.log.map((line, index) => (
                <li key={`${line}-${index}`}>{line}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      {glossaryOpen && <Glossary cards={room.cards} onClose={() => setGlossaryOpen(false)} />}
    </main>
  )
}

function App() {
  const socket = useSocket()
  const [room, setRoom] = useState<Room | null>(null)
  const [notice, setNotice] = useState('')
  const joinedSocketId = useRef<string | null>(null)

  useEffect(() => {
    if (!socket) return
    const onRoom = (next: Room) => setRoom(next)
    const onNotice = (message: string) => {
      setNotice(message)
      window.setTimeout(() => setNotice(''), 2400)
    }
    socket.on('room', onRoom)
    socket.on('notice', onNotice)
    return () => {
      socket.off('room', onRoom)
      socket.off('notice', onNotice)
    }
  }, [socket])

  useEffect(() => {
    if (!socket) return
    const join = () => {
      if (!socket.id || joinedSocketId.current === socket.id) return
      joinedSocketId.current = socket.id
      const name = localStorage.getItem('gpu-game-name') ?? 'Green GPU Co.'
      socket.emit('joinDefault', { name }, (reply: Room | { error: string }) => {
        if (!('error' in reply)) setRoom(reply)
      })
    }
    const resetJoin = () => {
      joinedSocketId.current = null
    }
    if (socket.connected) join()
    socket.on('connect', join)
    socket.on('disconnect', resetJoin)
    return () => {
      socket.off('connect', join)
      socket.off('disconnect', resetJoin)
    }
  }, [socket])

  return (
    <>
      {room?.game.status === 'playing' || room?.game.status === 'finished' ? (
        <GameBoard socket={socket} room={room} />
      ) : (
        <main className="loading-shell">
          <Cpu size={48} />
          <h1>GPU Crunch</h1>
          <p>Starting default POC game...</p>
        </main>
      )}
      {notice && <div className="toast">{notice}</div>}
    </>
  )
}

export default App
