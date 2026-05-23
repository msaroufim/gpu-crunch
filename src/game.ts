export type Resource = 'money' | 'influence' | 'compute' | 'energy'
export type Track = 'capacity' | 'policy' | 'grid' | 'moat'
export type Era = 'early' | 'mid' | 'late'

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
}

export type EffectId =
  | 'scout'
  | 'surge'
  | 'raid'
  | 'disrupt'
  | 'chain'
  | 'hack'

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
}

export const RESOURCES: Resource[] = ['money', 'influence', 'compute', 'energy']
export const TRACKS: Track[] = ['capacity', 'policy', 'grid', 'moat']

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
  scout: { name: 'Scout', text: 'Cycle the two lowest-VP market cards. Gain +1 Influence this phase.', broken: true },
  surge: { name: 'Surge', text: 'Gain +3 Money, +2 Compute, and +2 Energy this phase.', broken: true },
  raid: { name: 'Raid', text: 'Each rival loses 1 Money and 1 Compute if able. You gain what they lose.', broken: true },
  disrupt: { name: 'Disrupt', text: 'Trash the highest-VP card in the market, then refill it.', broken: true },
  chain: { name: 'Chain', text: 'Immediately take another action.', broken: true },
  hack: { name: 'Hack', text: 'Ignore event cost penalties on this build. This card costs -2 Money.', broken: true },
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
  card.vp >= 3 ? undefined : card.income

export const effectiveCost = (card: Card, event?: EventCard): ResourceMap => {
  const cost = emptyResources()
  const vpPremium = Math.max(0, card.vp - 2)
  for (const resource of RESOURCES) {
    const eventMod = card.effect === 'hack' ? Math.min(0, event?.costMod?.[resource] ?? 0) : event?.costMod?.[resource] ?? 0
    const hackDiscount = card.effect === 'hack' && resource === 'money' ? -2 : 0
    const premium = resource === 'money' ? vpPremium * 2 : resource === 'compute' ? vpPremium : 0
    cost[resource] = Math.max(0, (card.cost[resource] ?? 0) + eventMod + hackDiscount + premium)
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
})

export const CARDS: Card[] = [
  c('taiwan-foundry-slot', 'Taiwan Foundry Slot', 'Fabrication', 1, 'early', 'A wafer start with everyone watching the calendar.', { money: 2, influence: 1 }, { compute: 1 }, { money: 1 }, { capacity: 2 }, 1, 'fab', 'hack'),
  c('hbm-allocation', 'HBM Allocation', 'Memory', 1, 'early', 'The memory vendor finally returns your call.', { money: 2 }, { compute: 1 }, { compute: 1 }, { capacity: 1, moat: 1 }, 1, 'memory', 'scout'),
  c('advanced-packaging', 'Advanced Packaging', 'Fabrication', 2, 'mid', 'Tiny bridges, huge bottlenecks.', { money: 3, compute: 1 }, { compute: 2 }, { compute: 1 }, { capacity: 3 }, 2, 'package', 'surge'),
  c('euv-queue', 'Reverse-Engineered Lithography Rig', 'Fabrication', 2, 'mid', 'A clean-room project with suspiciously familiar tolerances.', { money: 3, influence: 1 }, undefined, { money: 1, compute: 1 }, { capacity: 2, policy: 1 }, 2, 'fab', 'hack'),
  c('cowos-expansion', 'CoWoS Expansion', 'Fabrication', 3, 'late', 'Capex turns into slots if you can wait long enough.', { money: 5, energy: 1 }, { compute: 2 }, { compute: 2 }, { capacity: 4, grid: 1 }, 4, 'package', 'chain'),
  c('substrate-supplier', 'Substrate Supplier', 'Fabrication', 1, 'early', 'The unglamorous layer that saves the quarter.', { money: 1 }, { money: 1 }, { money: 1 }, { capacity: 1 }, 0, 'package', 'surge'),
  c('driver-team', 'Driver Team', 'Software', 1, 'early', 'Half the performance came from a Friday night patch.', { money: 1, compute: 1 }, { compute: 1 }, undefined, { moat: 2 }, 1, 'software', 'hack'),
  c('cuda-lock-in', 'CUDA Lock-in', 'Software', 2, 'mid', 'Every migration plan starts with a sigh.', { money: 2, compute: 2 }, undefined, { money: 1 }, { moat: 4 }, 3, 'software', 'disrupt'),
  c('jensen-soju-toast', 'Jensen Soju Toast', 'Market', 1, 'early', 'A table toast turns into another DRAM shipment.', { influence: 2 }, { influence: 1, compute: 1 }, undefined, { policy: 1, moat: 1 }, 2, 'toast', 'scout'),
  c('sovereign-ai-mou', 'Sovereign AI MoU', 'Policy', 2, 'mid', 'A national plan, a ceremonial pen, and a purchase order.', { influence: 3, money: 1 }, { money: 2 }, { influence: 1 }, { policy: 3, capacity: 1 }, 3, 'policy', 'hack'),
  c('cloud-preorder', 'Cloud Preorder', 'Demand', 1, 'early', 'Capacity booked before the rack exists.', { money: 2, compute: 1 }, { money: 2 }, undefined, { moat: 1, capacity: 1 }, 1, 'cloud', 'surge'),
  c('hyperscaler-panic-buy', 'GPU FOMO Panic Buy', 'Demand', 2, 'mid', 'A benchmark leak makes every CFO approve emergency spend.', { money: 3 }, { money: 1, compute: 1 }, undefined, { moat: 2 }, 2, 'cloud', 'surge'),
  c('export-license-counsel', 'Export License Counsel', 'Policy', 1, 'early', 'A lawyer turns ambiguity into shipment velocity.', { money: 1, influence: 1 }, { influence: 1 }, { influence: 1 }, { policy: 2 }, 1, 'policy', 'hack'),
  c('data-center-rezoning', 'Election Year Zoning Deal', 'Energy', 2, 'mid', 'A governor needs jobs before November and the permits move overnight.', { money: 2, influence: 2 }, { energy: 2 }, undefined, { grid: 3, policy: 1 }, 2, 'power', 'surge'),
  c('utility-interconnect', 'Utility Interconnect', 'Energy', 1, 'early', 'The queue number matters more than the brochure.', { money: 2, energy: 1 }, { energy: 1 }, { energy: 1 }, { grid: 2 }, 1, 'power', 'hack'),
  c('nuclear-ppa', 'Nuclear PPA', 'Energy', 3, 'late', 'Baseload with lawyers attached.', { money: 4, influence: 2, energy: 1 }, { energy: 2 }, { energy: 2 }, { grid: 5, policy: 1 }, 5, 'power', 'chain'),
  c('liquid-cooling-retrofit', 'Liquid Cooling Retrofit', 'Energy', 2, 'mid', 'Your racks stop thermal throttling and start flexing.', { money: 2, energy: 2 }, { compute: 1 }, { compute: 1 }, { grid: 2, capacity: 1 }, 2, 'cooling', 'surge'),
  c('blackwell-ramp', 'Blackwell Ramp Goes Vertical', 'Silicon', 3, 'late', 'The flagship finally ships and the whole roadmap gets pulled forward.', { money: 5, compute: 2, energy: 1 }, { compute: 3 }, { compute: 2 }, { capacity: 5, moat: 2 }, 6, 'fab', 'chain'),
  c('hopper-fire-sale', 'Hopper Fire Sale', 'Market', 1, 'early', 'Last generation still trains this generation.', { money: 1 }, { compute: 1 }, undefined, { capacity: 1 }, 0, 'market', 'scout'),
  c('refurbished-mining-rigs', 'Gray-Market Mining Rigs', 'Market', 1, 'early', 'Hashrate becomes batch inference if you squint.', { money: 1, energy: 1 }, { compute: 1 }, undefined, { capacity: 1, grid: -1 }, 1, 'market', 'raid'),
  c('gray-market-broker', 'Dubai Gray-Market Broker', 'Market', 2, 'mid', 'It arrives with no warranty, three invoices, and perfect timing.', { money: 2, influence: 1 }, { compute: 2 }, undefined, { capacity: 1, policy: -1 }, 2, 'market', 'raid'),
  c('benchmark-leak', 'Vaguepost', 'Market', 1, 'early', 'One founder posts a GPU emoji and the market invents a roadmap.', { influence: 1 }, { money: 1 }, undefined, { moat: 2 }, 1, 'market', 'scout'),
  c('analyst-day', 'Analyst Day', 'Market', 1, 'early', 'Slides become financing.', { influence: 1 }, { money: 2 }, undefined, { moat: 1, policy: 1 }, 1, 'market', 'surge'),
  c('lobbyist-dinner', 'Anti-AI Protest Backlash', 'Policy', 2, 'mid', 'A protest blocks one site and quietly unlocks subsidies in another state.', { money: 2, influence: 1 }, { influence: 1 }, undefined, { policy: 3 }, 2, 'policy', 'raid'),
  c('customs-waiver', 'Customs Waiver', 'Policy', 1, 'early', 'A signature beats a warehouse full of boxes.', { influence: 2 }, { money: 1, compute: 1 }, undefined, { policy: 2 }, 1, 'policy', 'hack'),
  c('tariff-arbitrage', 'Tariff Midnight Loophole', 'Policy', 2, 'mid', 'The route is longer, the invoice is cleaner, and rivals eat the delay.', { money: 2, influence: 2 }, { money: 2 }, undefined, { policy: 2, moat: 1 }, 2, 'policy', 'raid'),
  c('earthquake-insurance', 'Foundry Earthquake Insurance', 'Risk', 1, 'early', 'You cannot stop the quake, but you can buy resilience.', { money: 2 }, undefined, { money: 1 }, { policy: 1, capacity: 1 }, 1, 'risk', 'disrupt'),
  c('port-strike-buffer', 'Port Strike Buffer', 'Risk', 1, 'early', 'Inventory is inefficient until it saves you.', { money: 2 }, { compute: 1 }, undefined, { capacity: 1, moat: 1 }, 1, 'risk', 'scout'),
  c('dram-price-spike', 'DRAM Price Spike', 'Memory', 2, 'mid', 'A bad quarter for buyers, a great quarter for you.', { money: 2, influence: 1 }, { money: 3 }, undefined, { moat: 2 }, 2, 'memory', 'surge'),
  c('networking-fabric', 'Networking Fabric', 'Cluster', 2, 'mid', 'The GPUs were never the whole cluster.', { money: 3, compute: 1 }, { compute: 1 }, { compute: 1 }, { capacity: 2, moat: 1 }, 2, 'network', 'raid'),
  c('infiniband-switch', 'InfiniBand Switch', 'Cluster', 2, 'mid', 'Latency is a resource if you can monopolize it.', { money: 3, energy: 1 }, undefined, { compute: 1 }, { capacity: 2, moat: 2 }, 3, 'network', 'disrupt'),
  c('firmware-miracle', 'Firmware Miracle', 'Software', 1, 'early', 'The same silicon gets a better story.', { compute: 1 }, { compute: 1, energy: 1 }, undefined, { moat: 1 }, 1, 'software', 'chain'),
  c('chiplet-yield-fix', 'Chiplet Yield Fix', 'Silicon', 2, 'mid', 'A package-level fix turns scraps into margin.', { money: 3, compute: 1 }, { money: 1, compute: 1 }, { money: 1 }, { capacity: 2, moat: 1 }, 2, 'package', 'surge'),
  c('silicon-photonics-bet', 'Secret Photonics Breakthrough', 'Cluster', 3, 'late', 'The lab demo works once and the board decides once is enough.', { money: 4, compute: 2, influence: 1 }, { compute: 2 }, { compute: 1 }, { capacity: 3, moat: 3 }, 5, 'network', 'chain'),
  c('government-supercluster', 'Election Supercluster Pledge', 'Policy', 3, 'late', 'A campaign promise turns into a national compute purchasing program.', { money: 4, influence: 3, energy: 1 }, { compute: 2 }, { influence: 1, compute: 1 }, { policy: 4, capacity: 2 }, 5, 'policy', 'scout'),
  c('university-lab-grant', 'University Lab Grant', 'Policy', 1, 'early', 'Cheap talent, expensive procurement.', { influence: 1 }, { compute: 1 }, { influence: 1 }, { policy: 1, moat: 1 }, 1, 'policy', 'scout'),
  c('startup-allocation-lottery', 'Startup Allocation Lottery', 'Demand', 1, 'early', 'You won four boards and a cloud credit coupon.', { influence: 1, money: 1 }, { compute: 1, money: 1 }, undefined, { moat: 1 }, 1, 'cloud', 'surge'),
  c('model-training-deadline', 'Ship the Model', 'Demand', 2, 'mid', 'The evals are weird, the launch date is real, and every cluster gets emptied.', { money: 2, compute: 2 }, { money: 2 }, undefined, { moat: 3 }, 2, 'cloud', 'chain'),
  c('inference-optimization', 'Acquire vLLM Team', 'Software', 2, 'mid', 'The fastest kernel is the one you bought before lunch.', { compute: 2 }, { energy: 2 }, { money: 1 }, { moat: 2, grid: 1 }, 3, 'software', 'hack'),
  c('scheduler-wizard', 'Scheduler Wizard', 'Software', 1, 'early', 'Utilization rises without buying another rack.', { money: 1, compute: 1 }, { compute: 1 }, undefined, { capacity: 1, moat: 1 }, 1, 'software', 'scout'),
  c('power-cap-firmware', 'Power Cap Firmware', 'Energy', 1, 'early', 'Less clock, more cluster.', { compute: 1, energy: 1 }, { energy: 2 }, undefined, { grid: 2 }, 1, 'power', 'surge'),
  c('carbon-credit-swap', 'Carbon Credit Swap', 'Energy', 2, 'mid', 'A spreadsheet finds clean power in another county.', { money: 2, influence: 1 }, { energy: 1, influence: 1 }, undefined, { grid: 2, policy: 1 }, 2, 'power', 'hack'),
  c('water-permit', 'Water Permit', 'Energy', 1, 'early', 'Cooling begins at the county office.', { influence: 1, money: 1 }, { energy: 1 }, { energy: 1 }, { grid: 1, policy: 1 }, 1, 'cooling', 'hack'),
  c('heat-reuse-district', 'Heat Reuse District', 'Energy', 2, 'mid', 'Waste heat becomes political capital.', { money: 2, energy: 1 }, { influence: 2 }, { influence: 1 }, { grid: 2, policy: 2 }, 3, 'cooling', 'surge'),
  c('open-source-compiler', 'Open Source Compiler', 'Software', 2, 'mid', 'The community finds performance you did not budget for.', { compute: 1, influence: 2 }, { compute: 1 }, { compute: 1 }, { moat: 2, policy: 1 }, 3, 'software', 'hack'),
  c('vendor-lock-review', 'Vendor Lock Review', 'Policy', 2, 'mid', 'A procurement memo slows the leader down.', { influence: 2, compute: 1 }, { influence: 1 }, undefined, { policy: 2 }, 2, 'policy', 'disrupt'),
  c('antitrust-hearing', 'Antitrust Hearing Meltdown', 'Policy', 3, 'late', 'Every moat becomes a hearing exhibit and procurement teams freeze.', { influence: 4, money: 1 }, { influence: 2 }, undefined, { policy: 5, moat: -1 }, 4, 'policy', 'disrupt'),
  c('boardroom-pivot', 'Boardroom Pivot', 'Market', 2, 'mid', 'The company is an AI infrastructure business now.', { money: 2, influence: 1 }, { money: 1, energy: 1 }, undefined, { moat: 2, grid: 1 }, 2, 'market', 'chain'),
  c('ipo-war-chest', 'Meme-Stock AI IPO', 'Market', 3, 'late', 'Retail euphoria becomes a war chest before lockup expires.', { money: 3, influence: 2 }, { money: 4 }, { money: 1 }, { moat: 3 }, 5, 'market', 'surge'),
  c('crypto-demand-returns', 'Crypto Demand Returns', 'Demand', 2, 'mid', 'The bid stack gets weird again.', { energy: 2, money: 2 }, { money: 3 }, undefined, { moat: 1, grid: -1 }, 3, 'market', 'raid'),
  c('sanctions-shock', 'China War Games Around Taiwan', 'Risk', 3, 'late', 'Joint Sword drills make every sourcing plan feel one headline away from failure.', { influence: 3, money: 2 }, { influence: 2, compute: 1 }, undefined, { policy: 4 }, 4, 'risk', 'disrupt'),
  c('grace-cpu-bundle', 'Grace CPU Bundle', 'Silicon', 2, 'mid', 'The accelerator sale now comes with the rest of the box.', { money: 3, compute: 1, energy: 1 }, { compute: 1, money: 1 }, { compute: 1 }, { capacity: 2, moat: 2 }, 3, 'fab', 'chain'),
]

export const EVENTS: EventCard[] = [
  { id: 'taiwan-war-games', name: 'China War Games Around Taiwan', headline: 'Joint Sword drills put foundry risk back on every board slide.', rule: 'Compute costs +1 this phase.', costMod: { compute: 1 } },
  { id: 'hbm-sold-out', name: 'HBM Capacity Sold Out', headline: 'Memory suppliers say AI demand is outrunning available HBM capacity.', rule: 'Compute costs +1. Everyone gets +1 Influence budget this phase.', costMod: { compute: 1 }, incomeMod: { influence: 1 } },
  { id: 'anti-ai-protests', name: 'Anti-AI Protests Block Data Centers', headline: 'Local hearings become national TV.', rule: 'Energy costs +1 this phase.', costMod: { energy: 1 } },
  { id: 'election-shock', name: 'Election Shock', headline: 'The new platform rewrites zoning, tariffs, and subsidy assumptions.', rule: 'Influence costs +1. Everyone gets +1 Money budget this phase.', costMod: { influence: 1 }, incomeMod: { money: 1 } },
  { id: 'chips-grants', name: 'Emergency CHIPS Grants', headline: 'Subsidy paperwork becomes a resource.', rule: 'Money costs -1. Everyone gets +1 Influence budget this phase.', costMod: { money: -1 }, incomeMod: { influence: 1 } },
  { id: 'tariff-whiplash', name: 'Tariff Whiplash', headline: 'Routing decisions matter again.', rule: 'Money costs +1 this phase.', costMod: { money: 1 } },
  { id: 'power-spike', name: 'Power Price Spike', headline: 'The marginal megawatt gets ugly.', rule: 'Energy budget -1 this phase.', incomeMod: { energy: -1 } },
  { id: 'model-breakthrough', name: 'Model Breakthrough Panic', headline: 'A new benchmark makes every old cluster feel obsolete.', rule: 'Compute budget +1 this phase.', incomeMod: { compute: 1 } },
  { id: 'export-controls', name: 'Export Controls Tighten', headline: 'Legal review hits every shipment.', rule: 'Influence costs +1. Everyone gets +1 Influence budget this phase.', costMod: { influence: 1 }, incomeMod: { influence: 1 } },
  { id: 'earthquake-aftershock', name: 'Foundry Earthquake Aftershock', headline: 'Buffer inventory suddenly looks wise.', rule: 'Money costs +1. Everyone gets +1 Influence budget this phase.', costMod: { money: 1 }, incomeMod: { influence: 1 } },
  { id: 'hyperscaler-freeze', name: 'Hyperscaler Capex Freeze', headline: 'Cloud CFOs discover discipline.', rule: 'Money budget -1 this phase.', incomeMod: { money: -1 } },
  { id: 'shipping-backlog', name: 'Shipping Backlog Goes Viral', headline: 'The GPUs exist. The trucks do not.', rule: 'Money costs +1. Everyone gets +1 Energy budget this phase.', costMod: { money: 1 }, incomeMod: { energy: 1 } },
]
