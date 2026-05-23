export type Resource = 'money' | 'influence' | 'compute' | 'energy'
export type Track = 'capacity' | 'policy' | 'grid' | 'moat'
export type Era = 'early' | 'mid' | 'late'
export type CardRole = 'Setup' | 'Timing' | 'Finisher'

export type ResourceMap = Record<Resource, number>
export type TrackMap = Record<Track, number>

export type Card = {
  id: string
  name: string
  suit: string
  tier: 1 | 2 | 3
  era: Era
  flavor: string
  cost: Partial<ResourceMap>
  gain?: Partial<ResourceMap>
  income?: Partial<ResourceMap>
  tracks: Partial<TrackMap>
  vp: number
  effect?: EffectId
  art: ArtKey
  starter?: boolean
}

export type EffectId =
  | 'priority'
  | 'shock'

export type ArtKey =
  | 'fab'
  | 'memory'
  | 'package'
  | 'power'
  | 'policy'
  | 'cloud'
  | 'network'
  | 'software'
  | 'market'
  | 'risk'
  | 'toast'
  | 'cooling'

export type EventCard = {
  id: string
  name: string
  headline: string
  rule: string
  costMod?: Partial<ResourceMap>
  incomeMod?: Partial<ResourceMap>
  trackBonus?: Partial<TrackMap>
  blockedSuits?: string[]
}

export const RESOURCES: Resource[] = ['money', 'influence', 'compute', 'energy']
export const TRACKS: Track[] = ['capacity', 'policy', 'grid', 'moat']
export const MARKET_SIZE = 12

export const resourceLabels: Record<Resource, string> = {
  money: 'Money',
  influence: 'Influence',
  compute: 'Compute',
  energy: 'Energy',
}

export const trackLabels: Record<Track, string> = {
  capacity: 'Capacity',
  policy: 'Policy',
  grid: 'Grid',
  moat: 'Moat',
}

export const effectRules: Record<EffectId, { name: string; text: string; broken?: boolean }> = {
  priority: { name: 'Priority', text: 'Local buff: take initiative next phase if unclaimed.', broken: true },
  shock: { name: 'Shock', text: "Global debuff: replace the next event with this card's forced event.", broken: true },
}

export const cardRole = (card: Card): CardRole => {
  if (card.vp >= 4) return 'Finisher'
  if (card.effect === 'shock' || card.effect === 'priority') return 'Timing'
  return 'Setup'
}

export const roleHelp: Record<CardRole, string> = {
  Setup: 'Build income for later turns.',
  Timing: 'Win the market or event window.',
  Finisher: 'Expensive points that close the game.',
}

export const emptyResources = (): ResourceMap => ({
  money: 0,
  influence: 0,
  compute: 0,
  energy: 0,
})

export const emptyTracks = (): TrackMap => ({
  capacity: 0,
  policy: 0,
  grid: 0,
  moat: 0,
})

export const addMaps = <K extends string>(
  base: Record<K, number>,
  delta?: Partial<Record<K, number>>,
) => {
  const next = { ...base }
  if (!delta) return next
  for (const key of Object.keys(delta) as K[]) {
    next[key] = Math.max(0, (next[key] ?? 0) + (delta[key] ?? 0))
  }
  return next
}

export const productiveIncome = (card: Card): Partial<ResourceMap> | undefined =>
  card.vp >= 3 ? undefined : addMaps(addMaps(emptyResources(), card.income), card.gain)

export const continuesAfterBuild = () =>
  false

export const effectiveCost = (card: Card, event?: EventCard): ResourceMap => {
  const cost = emptyResources()
  if (event?.blockedSuits?.includes(card.suit)) {
    return { money: 99, influence: 99, compute: 99, energy: 99 }
  }
  if (card.starter) return cost
  const printedCostTotal = RESOURCES.reduce((sum, resource) => sum + (card.cost[resource] ?? 0), 0)
  const resourcePremium = (resource: Resource, premium: number) => {
    if (premium <= 0) return 0
    const printed = card.cost[resource] ?? 0
    if (printedCostTotal === 0) return resource === 'money' ? premium : 0
    if (printed === 0) return 0
    return Math.max(1, Math.floor((premium * printed) / printedCostTotal))
  }
  const vpPremium = card.vp >= 3 ? card.vp === 3 ? 2 : card.vp - 2 : 0
  const priorityPremium = card.effect === 'priority'
    ? card.tier === 1 ? 0 : card.tier === 2 ? 2 : 3
    : 0
  for (const resource of RESOURCES) {
    const eventMod = event?.costMod?.[resource] ?? 0
    const premium = resourcePremium(resource, vpPremium) + resourcePremium(resource, priorityPremium)
    cost[resource] = Math.max(0, (card.cost[resource] ?? 0) + eventMod + premium)
  }
  return cost
}

export const eraOrder: Era[] = ['early', 'mid', 'late']

const c = (
  id: string,
  name: string,
  suit: string,
  tier: 1 | 2 | 3,
  era: Era,
  flavor: string,
  cost: Partial<ResourceMap>,
  gain: Partial<ResourceMap> | undefined,
  income: Partial<ResourceMap> | undefined,
  tracks: Partial<TrackMap>,
  vp: number,
  art: ArtKey,
  effect?: EffectId,
  starter = false,
): Card => ({
  id,
  name,
  suit,
  tier,
  era,
  flavor,
  cost,
  gain,
  income,
  tracks,
  vp,
  art,
  effect,
  starter,
})

export const CARDS: Card[] = [
  c('taiwan-foundry-slot', 'Taiwan Foundry Slot', 'Fabrication', 1, 'early', 'A wafer start with everyone watching the calendar.', { money: 2, influence: 1 }, { compute: 1 }, { money: 1 }, { capacity: 2 }, 1, 'fab'),
  c('hbm-allocation', 'HBM Allocation', 'Memory', 1, 'early', 'The memory vendor finally returns your call.', { money: 2 }, { compute: 1 }, { compute: 1 }, { capacity: 1, moat: 1 }, 1, 'memory'),
  c('advanced-packaging', 'Advanced Packaging', 'Fabrication', 2, 'mid', 'Tiny bridges, huge bottlenecks.', { money: 3, compute: 1 }, { compute: 2 }, { compute: 1 }, { capacity: 3 }, 2, 'package'),
  c('euv-queue', 'Reverse-Engineered Lithography Rig', 'Fabrication', 2, 'mid', 'A clean-room project with suspiciously familiar tolerances.', { money: 3, influence: 1 }, undefined, { money: 1, compute: 1 }, { capacity: 2, policy: 1 }, 2, 'fab', 'shock'),
  c('cowos-expansion', 'CoWoS Expansion', 'Fabrication', 3, 'late', 'Capex turns into slots if you can wait long enough.', { money: 4, energy: 1 }, { compute: 3 }, { compute: 2 }, { capacity: 4, grid: 1 }, 4, 'package'),
  c('substrate-supplier', 'Substrate Supplier', 'Fabrication', 1, 'early', 'The unglamorous layer that saves the quarter.', {}, { money: 1, compute: 1 }, { money: 1 }, { capacity: 1 }, 1, 'package', undefined, true),
  c('driver-team', 'Driver Team', 'Software', 1, 'early', 'Half the performance came from a Friday night patch.', { compute: 1 }, { compute: 1 }, { compute: 1 }, { moat: 2 }, 1, 'software', 'priority'),
  c('cuda-lock-in', 'CUDA Lock-in', 'Software', 2, 'mid', 'Every migration plan starts with a sigh.', { money: 2, compute: 2 }, undefined, { money: 1 }, { moat: 4 }, 3, 'software', 'shock'),
  c('jensen-soju-toast', 'Jensen Soju Toast', 'Market', 1, 'early', 'A table toast turns into another DRAM shipment.', { influence: 2 }, { influence: 1, compute: 1 }, undefined, { policy: 1, moat: 1 }, 2, 'toast', 'shock'),
  c('sovereign-ai-mou', 'Sovereign AI MoU', 'Policy', 2, 'mid', 'A national plan, a ceremonial pen, and a purchase order.', { influence: 3, money: 1 }, { money: 2 }, { influence: 1 }, { policy: 3, capacity: 1 }, 3, 'policy', 'shock'),
  c('cloud-preorder', 'Cloud Preorder', 'Demand', 1, 'early', 'Capacity booked before the rack exists.', { money: 2, compute: 1 }, { money: 3 }, { money: 1 }, { moat: 1, capacity: 1 }, 1, 'cloud', 'priority'),
  c('hyperscaler-panic-buy', 'GPU FOMO Panic Buy', 'Demand', 2, 'mid', 'A benchmark leak makes every CFO approve emergency spend.', { money: 3 }, { money: 1, compute: 1 }, undefined, { moat: 2 }, 2, 'cloud', 'priority'),
  c('export-license-counsel', 'Export License Counsel', 'Policy', 1, 'early', 'A lawyer turns ambiguity into shipment velocity.', { money: 1, influence: 1 }, { influence: 1 }, { influence: 1 }, { policy: 2 }, 1, 'policy', 'shock'),
  c('data-center-rezoning', 'Election Year Zoning Deal', 'Energy', 2, 'mid', 'A governor needs jobs before November and the permits move overnight.', { money: 2, influence: 2 }, { energy: 2 }, undefined, { grid: 3, policy: 1 }, 2, 'power', 'shock'),
  c('utility-interconnect', 'Utility Interconnect', 'Energy', 1, 'early', 'The queue number matters more than the brochure.', { energy: 1 }, { energy: 1 }, { energy: 1 }, { grid: 2 }, 1, 'power'),
  c('nuclear-ppa', 'Nuclear PPA', 'Energy', 3, 'late', 'Baseload with lawyers attached.', { money: 3, influence: 2, energy: 1 }, { energy: 3 }, { energy: 2 }, { grid: 5, policy: 1 }, 5, 'power', 'shock'),
  c('liquid-cooling-retrofit', 'Liquid Cooling Retrofit', 'Energy', 2, 'mid', 'Your racks stop thermal throttling and start flexing.', { compute: 2, energy: 2 }, { compute: 1 }, { compute: 1 }, { grid: 2, capacity: 1 }, 2, 'cooling', 'priority'),
  c('blackwell-ramp', 'Blackwell Ramp Goes Vertical', 'Silicon', 3, 'late', 'The flagship finally ships and the whole roadmap gets pulled forward.', { money: 4, compute: 1, energy: 1 }, { compute: 4 }, { compute: 2 }, { capacity: 5, moat: 2 }, 6, 'fab', 'priority'),
  c('hopper-fire-sale', 'Hopper Fire Sale', 'Market', 1, 'early', 'Last generation still trains this generation.', {}, { compute: 2 }, { money: 1 }, { capacity: 1 }, 1, 'market', undefined, true),
  c('refurbished-mining-rigs', 'Gray-Market Mining Rigs', 'Market', 1, 'early', 'Hashrate becomes batch inference if you squint.', { compute: 1, energy: 1 }, { compute: 2 }, { compute: 1 }, { capacity: 1, grid: -1 }, 1, 'market', 'priority'),
  c('gray-market-broker', 'Dubai Gray-Market Broker', 'Market', 2, 'mid', 'It arrives with no warranty, three invoices, and perfect timing.', { money: 2, influence: 1 }, { compute: 2 }, undefined, { capacity: 1, policy: -1 }, 2, 'market', 'shock'),
  c('benchmark-leak', 'Vaguepost', 'Market', 1, 'early', 'One founder posts a GPU emoji and the market invents a roadmap.', { influence: 1 }, { money: 1 }, undefined, { moat: 2 }, 1, 'market', 'shock'),
  c('analyst-day', 'Analyst Day', 'Market', 1, 'early', 'Slides become financing.', { influence: 1 }, { money: 3 }, { money: 1 }, { moat: 1, policy: 1 }, 1, 'market', 'priority'),
  c('lobbyist-dinner', 'Anti-AI Protest Backlash', 'Policy', 2, 'mid', 'A protest blocks one site and quietly unlocks subsidies in another state.', { money: 2, influence: 1 }, { influence: 1 }, undefined, { policy: 3 }, 2, 'policy', 'shock'),
  c('customs-waiver', 'Customs Waiver', 'Policy', 1, 'early', 'A signature beats a warehouse full of boxes.', { influence: 1 }, { money: 1, compute: 1 }, { influence: 1 }, { policy: 2 }, 1, 'policy', 'shock'),
  c('tariff-arbitrage', 'Tariff Midnight Loophole', 'Policy', 2, 'mid', 'The route is longer, the invoice is cleaner, and rivals eat the delay.', { money: 2, influence: 2 }, { money: 2 }, undefined, { policy: 2, moat: 1 }, 2, 'policy', 'shock'),
  c('earthquake-insurance', 'Foundry Earthquake Insurance', 'Risk', 1, 'early', 'You cannot stop the quake, but you can buy resilience.', {}, { influence: 1 }, { money: 1 }, { policy: 1, capacity: 1 }, 1, 'risk', undefined, true),
  c('port-strike-buffer', 'Port Strike Buffer', 'Risk', 1, 'early', 'Inventory is inefficient until it saves you.', { money: 2 }, { compute: 1 }, undefined, { capacity: 1, moat: 1 }, 1, 'risk'),
  c('dram-price-spike', 'DRAM Price Spike', 'Memory', 2, 'mid', 'A bad quarter for buyers, a great quarter for you.', { money: 2, influence: 1 }, { money: 3 }, undefined, { moat: 2 }, 2, 'memory', 'shock'),
  c('networking-fabric', 'Networking Fabric', 'Cluster', 2, 'mid', 'The GPUs were never the whole cluster.', { compute: 2, energy: 1 }, { compute: 1 }, { compute: 1 }, { capacity: 2, moat: 1 }, 2, 'network', 'priority'),
  c('infiniband-switch', 'InfiniBand Switch', 'Cluster', 2, 'mid', 'Latency is a resource if you can monopolize it.', { compute: 1, energy: 2 }, undefined, { compute: 1 }, { capacity: 2, moat: 2 }, 3, 'network'),
  c('firmware-miracle', 'Firmware Miracle', 'Software', 1, 'early', 'The same silicon gets a better story.', {}, { compute: 1, energy: 1 }, undefined, { moat: 1 }, 1, 'software', undefined, true),
  c('chiplet-yield-fix', 'Chiplet Yield Fix', 'Silicon', 2, 'mid', 'A package-level fix turns scraps into margin.', { money: 3, compute: 1 }, { money: 1, compute: 1 }, { money: 1 }, { capacity: 2, moat: 1 }, 2, 'package'),
  c('silicon-photonics-bet', 'Secret Photonics Breakthrough', 'Cluster', 3, 'late', 'The lab demo works once and the board decides once is enough.', { money: 3, compute: 1, influence: 1 }, { compute: 3 }, { compute: 1 }, { capacity: 3, moat: 3 }, 5, 'network', 'shock'),
  c('government-supercluster', 'Election Supercluster Pledge', 'Policy', 3, 'late', 'A campaign promise turns into a national compute purchasing program.', { money: 3, influence: 3, energy: 1 }, { compute: 3 }, { influence: 1, compute: 1 }, { policy: 4, capacity: 2 }, 5, 'policy', 'shock'),
  c('university-lab-grant', 'University Lab Grant', 'Policy', 1, 'early', 'Cheap talent, expensive procurement.', { influence: 1 }, { compute: 1 }, { influence: 1 }, { policy: 1, moat: 1 }, 1, 'policy', 'priority'),
  c('startup-allocation-lottery', 'Startup Allocation Lottery', 'Demand', 1, 'early', 'You won four boards and a cloud credit coupon.', { influence: 1, money: 1 }, { compute: 2, money: 1 }, undefined, { moat: 1 }, 1, 'cloud', 'priority'),
  c('model-training-deadline', 'Ship the Model', 'Demand', 2, 'mid', 'The evals are weird, the launch date is real, and every cluster gets emptied.', { money: 2, compute: 2 }, { money: 2 }, undefined, { moat: 3 }, 2, 'cloud', 'priority'),
  c('inference-optimization', 'Acquire vLLM Team', 'Software', 2, 'mid', 'The fastest kernel is the one you bought before lunch.', { compute: 2, energy: 1 }, { energy: 2 }, { money: 1 }, { moat: 2, grid: 1 }, 2, 'software', 'priority'),
  c('scheduler-wizard', 'Scheduler Wizard', 'Software', 1, 'early', 'Utilization rises without buying another rack.', { compute: 1 }, { compute: 1 }, undefined, { capacity: 1, moat: 1 }, 1, 'software', 'priority'),
  c('power-cap-firmware', 'Power Cap Firmware', 'Energy', 1, 'early', 'Less clock, more cluster.', { compute: 1 }, { energy: 2 }, { energy: 1 }, { grid: 2 }, 1, 'power'),
  c('carbon-credit-swap', 'Carbon Credit Swap', 'Energy', 2, 'mid', 'A spreadsheet finds clean power in another county.', { money: 2, influence: 1 }, { energy: 1, influence: 1 }, undefined, { grid: 2, policy: 1 }, 2, 'power', 'shock'),
  c('water-permit', 'Water Permit', 'Energy', 1, 'early', 'Cooling begins at the county office.', {}, { energy: 1 }, { influence: 1 }, { grid: 1, policy: 1 }, 1, 'cooling', undefined, true),
  c('heat-reuse-district', 'Heat Reuse District', 'Energy', 2, 'mid', 'Waste heat becomes political capital.', { money: 2, energy: 1 }, { influence: 2 }, { influence: 1 }, { grid: 2, policy: 2 }, 3, 'cooling', 'shock'),
  c('open-source-compiler', 'Open Source Compiler', 'Software', 2, 'mid', 'The community finds performance you did not budget for.', { compute: 1, influence: 2 }, { compute: 1 }, { compute: 1 }, { moat: 2, policy: 1 }, 3, 'software', 'shock'),
  c('vendor-lock-review', 'Vendor Lock Review', 'Policy', 2, 'mid', 'A procurement memo slows the leader down.', { influence: 2, compute: 1 }, { influence: 1 }, undefined, { policy: 2 }, 2, 'policy', 'shock'),
  c('antitrust-hearing', 'Antitrust Hearing Meltdown', 'Policy', 3, 'late', 'Every moat becomes a hearing exhibit and procurement teams freeze.', { influence: 4, money: 1 }, { influence: 2 }, undefined, { policy: 5, moat: -1 }, 4, 'policy', 'shock'),
  c('boardroom-pivot', 'Boardroom Pivot', 'Market', 2, 'mid', 'The company is an AI infrastructure business now.', { money: 2, influence: 1 }, { money: 1, energy: 1 }, undefined, { moat: 2, grid: 1 }, 2, 'market', 'shock'),
  c('ipo-war-chest', 'Meme-Stock AI IPO', 'Market', 3, 'late', 'Retail euphoria becomes a war chest before lockup expires.', { money: 2, influence: 2 }, { money: 5 }, { money: 1 }, { moat: 3 }, 5, 'market', 'priority'),
  c('crypto-demand-returns', 'Crypto Demand Returns', 'Demand', 2, 'mid', 'The bid stack gets weird again.', { compute: 2, energy: 2 }, { money: 3 }, undefined, { moat: 1, grid: -1 }, 3, 'market', 'shock'),
  c('sanctions-shock', 'China War Games Around Taiwan', 'Risk', 3, 'late', 'Joint Sword drills make every sourcing plan feel one headline away from failure.', { influence: 3, money: 2 }, { influence: 2, compute: 1 }, undefined, { policy: 4 }, 4, 'risk', 'shock'),
  c('grace-cpu-bundle', 'Grace CPU Bundle', 'Silicon', 2, 'mid', 'The accelerator sale now comes with the rest of the box.', { compute: 2, energy: 2 }, { compute: 1, money: 1 }, { compute: 1 }, { capacity: 2, moat: 2 }, 3, 'fab', 'priority'),
]

export const OPENING_MARKET_CARD_IDS = [
  'substrate-supplier',
  'firmware-miracle',
  'earthquake-insurance',
  'water-permit',
  'hopper-fire-sale',
]

export const EVENTS: EventCard[] = [
  { id: 'china-sales-window', name: 'China Sales Window', headline: 'Sell before the rule changes.', rule: 'Money costs -1. Influence costs +1.', costMod: { money: -1, influence: 1 } },
  { id: 'tariff-whiplash', name: 'Tariff Whiplash', headline: 'The same shipment has three different prices.', rule: 'Money costs +1.', costMod: { money: 1 } },
  { id: 'asml-credential-leak', name: 'ASML Credential Leak', headline: 'A toolchain login becomes a board-level incident.', rule: 'Influence costs +1. Compute costs -1.', costMod: { influence: 1, compute: -1 } },
  { id: 'foundry-lockdown', name: 'Foundry Lockdown', headline: 'A single fab incident freezes the whole calendar.', rule: 'Fabrication cards cannot be built this phase.', blockedSuits: ['Fabrication'] },
  { id: 'compiler-zero-day', name: 'Compiler Zero-Day', headline: 'Nobody trusts the toolchain until the patch lands.', rule: 'Software cards cannot be built this phase.', blockedSuits: ['Software'] },
  { id: 'hbm-sold-out', name: 'HBM Sold Out', headline: 'Memory vendors stop answering calls.', rule: 'Compute costs +1. Money costs -1.', costMod: { compute: 1, money: -1 } },
  { id: 'power-price-spike', name: 'Power Price Spike', headline: 'The marginal megawatt gets ugly.', rule: 'Energy budget -1.', incomeMod: { energy: -1 } },
  { id: 'panic-order', name: 'Panic Order', headline: 'A model demo turns into a purchase order.', rule: 'Money costs -1. Compute costs -1.', costMod: { money: -1, compute: -1 } },
]

const shockEventByCardId: Record<string, string> = {
  'euv-queue': 'asml-credential-leak',
  'cuda-lock-in': 'compiler-zero-day',
  'jensen-soju-toast': 'hbm-sold-out',
  'sovereign-ai-mou': 'china-sales-window',
  'export-license-counsel': 'tariff-whiplash',
  'data-center-rezoning': 'power-price-spike',
  'nuclear-ppa': 'power-price-spike',
  'benchmark-leak': 'panic-order',
  'gray-market-broker': 'tariff-whiplash',
  'lobbyist-dinner': 'power-price-spike',
  'customs-waiver': 'tariff-whiplash',
  'tariff-arbitrage': 'tariff-whiplash',
  'dram-price-spike': 'hbm-sold-out',
  'silicon-photonics-bet': 'compiler-zero-day',
  'government-supercluster': 'panic-order',
  'carbon-credit-swap': 'power-price-spike',
  'heat-reuse-district': 'power-price-spike',
  'open-source-compiler': 'compiler-zero-day',
  'vendor-lock-review': 'compiler-zero-day',
  'antitrust-hearing': 'china-sales-window',
  'boardroom-pivot': 'panic-order',
  'crypto-demand-returns': 'panic-order',
  'sanctions-shock': 'foundry-lockdown',
}

export const shockEventForCard = (card: Card) =>
  shockEventByCardId[card.id] ?? 'tariff-whiplash'
