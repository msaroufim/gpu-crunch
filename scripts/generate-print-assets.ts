import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import {
  CARDS,
  EVENTS,
  RESOURCES,
  effectRules,
  effectiveCost,
  productiveIncome,
  resourceLabels,
  shockEventForCard,
  type Card,
  type EventCard,
  type Resource,
  type ResourceMap,
} from '../src/game.ts'

const cardWidth = 750
const cardHeight = 1050
const outputRoot = path.resolve('print-assets')
const cardOutput = path.join(outputRoot, 'cards')
const eventOutput = path.join(outputRoot, 'events')

const resourceShort: Record<Resource, string> = {
  money: 'M',
  influence: 'INF',
  compute: 'CPU',
  energy: 'PWR',
}

const artLabels: Record<Card['art'], string> = {
  fab: 'FAB',
  memory: 'HBM',
  package: '2.5D',
  power: 'GRID',
  policy: 'LAW',
  cloud: 'CLOUD',
  network: 'NET',
  software: 'SW',
  market: 'MKT',
  risk: 'RISK',
  toast: 'SOJU',
  cooling: 'COOL',
}

const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const fileSafe = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')

const mapEntries = (values?: Partial<ResourceMap>) =>
  RESOURCES.map((resource) => [resource, values?.[resource] ?? 0] as const)
    .filter(([, value]) => value > 0)

function resourcePips(values?: Partial<ResourceMap>, empty = 'None') {
  const entries = mapEntries(values)
  if (entries.length === 0) return `<span class="empty">${empty}</span>`
  return entries
    .map(([resource, value]) => `
      <span class="pip ${resource}" title="${resourceLabels[resource]}">
        <b>${resourceShort[resource]}</b><strong>${value}</strong>
      </span>
    `)
    .join('')
}

function resourceChanges(values?: Partial<ResourceMap>) {
  const entries = RESOURCES.map((resource) => [resource, values?.[resource] ?? 0] as const)
    .filter(([, value]) => value !== 0)
  if (entries.length === 0) return ''
  return entries
    .map(([resource, value]) => `
      <span class="change ${value < 0 ? 'discount' : 'tax'}">
        ${resourceShort[resource]} ${value > 0 ? `+${value}` : value}
      </span>
    `)
    .join('')
}

function cardSpecial(card: Card) {
  const parts: string[] = []
  if (card.starter) parts.push('<b>START</b> Free opening card.')
  if (card.effect) {
    const forcedEvent = card.effect === 'shock'
      ? EVENTS.find((event) => event.id === shockEventForCard(card))
      : undefined
    parts.push(`<b>${effectRules[card.effect].name}</b> ${effectRules[card.effect].text}`)
    if (forcedEvent) parts.push(`<em>Forces next crisis: ${escapeHtml(forcedEvent.name)}.</em>`)
  }
  return parts.length > 0 ? `<div class="special">${parts.join('<br>')}</div>` : ''
}

function cardHtml(card: Card, index: number) {
  const printedCost = card.starter ? undefined : effectiveCost(card)
  return pageHtml(`
    <article id="card" class="print-card tier-${card.tier} art-${card.art}">
      <div class="top">
        <section>
          <h2>Income</h2>
          <div class="pips">${resourcePips(productiveIncome(card), 'None')}</div>
        </section>
        <section class="right">
          <h2>Cost</h2>
          <div class="pips">${card.starter ? '<span class="free">FREE</span>' : resourcePips(printedCost, 'Free')}</div>
        </section>
      </div>

      <div class="art">
        <span>${escapeHtml(artLabels[card.art])}</span>
      </div>

      <div class="meta">
        <span>${escapeHtml(card.suit)}</span>
        <strong>${card.vp} VP</strong>
      </div>

      <h1>${escapeHtml(card.name)}</h1>
      <p class="flavor">${escapeHtml(card.flavor)}</p>
      ${cardSpecial(card)}
      <footer>
        <span>#${String(index + 1).padStart(2, '0')} / ${CARDS.length}</span>
        <span>${escapeHtml(card.era.toUpperCase())} T${card.tier}</span>
      </footer>
    </article>
  `)
}

function blockedSuits(event: EventCard) {
  if (!event.blockedSuits?.length) return ''
  return `<div class="blocked"><b>Blocked:</b> ${event.blockedSuits.map(escapeHtml).join(', ')}</div>`
}

function eventHtml(event: EventCard, index: number) {
  return pageHtml(`
    <article id="card" class="print-card event-card">
      <div class="event-label">Crisis Event</div>
      <h1>${escapeHtml(event.name)}</h1>
      <p class="headline">${escapeHtml(event.headline)}</p>

      <div class="event-window">
        <h2>Market Shock</h2>
        <p>${escapeHtml(event.rule)}</p>
      </div>

      <div class="change-grid">
        ${resourceChanges(event.costMod) || '<span class="empty">No cost changes</span>'}
      </div>
      ${event.incomeMod ? `<div class="change-grid income-mod">${resourceChanges(event.incomeMod)}</div>` : ''}
      ${blockedSuits(event)}

      <footer>
        <span>Event #${String(index + 1).padStart(2, '0')} / ${EVENTS.length}</span>
        <span>Shuffle after opening draft</span>
      </footer>
    </article>
  `)
}

function pageHtml(body: string) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body {
            width: ${cardWidth}px;
            height: ${cardHeight}px;
            margin: 0;
            background: #d8e4ea;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #102033;
          }
          .print-card {
            position: relative;
            width: ${cardWidth}px;
            height: ${cardHeight}px;
            overflow: hidden;
            border: 18px solid #102033;
            border-radius: 34px;
            background:
              linear-gradient(90deg, rgba(16,32,51,0.035) 1px, transparent 1px),
              linear-gradient(rgba(16,32,51,0.035) 1px, transparent 1px),
              #fbfdff;
            background-size: 42px 42px;
            padding: 36px;
          }
          .print-card::before {
            content: "";
            position: absolute;
            inset: 16px;
            border: 3px solid #bac8d3;
            border-radius: 20px;
            pointer-events: none;
          }
          .top {
            position: relative;
            z-index: 1;
            display: flex;
            justify-content: space-between;
            gap: 28px;
            min-height: 150px;
          }
          section { width: 48%; }
          section.right { text-align: right; }
          h2 {
            margin: 0 0 12px;
            color: #647386;
            font-size: 26px;
            line-height: 1;
            text-transform: uppercase;
            letter-spacing: 0;
          }
          .pips {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
          }
          .right .pips { justify-content: flex-end; }
          .pip, .free, .empty, .change {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-width: 78px;
            height: 52px;
            padding: 0 13px;
            border: 2px solid rgba(16,32,51,0.12);
            border-radius: 14px;
            font-size: 22px;
            font-weight: 900;
          }
          .pip b {
            font-size: 17px;
            letter-spacing: 0;
          }
          .pip strong { font-size: 25px; }
          .money, .free { background: #fff0c2; }
          .influence { background: #d9f2ef; }
          .compute { background: #dff1ff; }
          .energy { background: #e9f6c8; }
          .empty { background: #eef3f7; color: #647386; }
          .art {
            position: relative;
            z-index: 1;
            display: grid;
            place-items: center;
            width: 100%;
            height: 285px;
            margin: 28px 0 26px;
            overflow: hidden;
            border: 4px solid #102033;
            border-radius: 20px;
            background:
              linear-gradient(90deg, rgba(255,255,255,0.24) 1px, transparent 1px),
              linear-gradient(rgba(255,255,255,0.24) 1px, transparent 1px),
              #315c73;
            background-size: 44px 44px;
          }
          .art::before {
            content: "";
            position: absolute;
            inset: -40px 140px;
            transform: rotate(-38deg);
            border: 12px solid rgba(255,255,255,0.18);
          }
          .art span {
            position: relative;
            z-index: 1;
            min-width: 170px;
            padding: 18px 22px;
            border: 6px solid rgba(255,255,255,0.8);
            border-radius: 18px;
            background: rgba(16,32,51,0.68);
            color: white;
            font-size: 52px;
            line-height: 1;
            text-align: center;
            font-weight: 950;
          }
          .art-fab .art, .art-package .art { background-color: #6d5a2d; }
          .art-memory .art { background-color: #744a80; }
          .art-power .art, .art-cooling .art { background-color: #3e7052; }
          .art-policy .art, .art-risk .art { background-color: #775547; }
          .art-cloud .art, .art-network .art { background-color: #285272; }
          .art-software .art { background-color: #526071; }
          .art-market .art, .art-toast .art { background-color: #7a5c2c; }
          .meta {
            position: relative;
            z-index: 1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            color: #5c6b7d;
            font-size: 26px;
            font-weight: 950;
            text-transform: uppercase;
          }
          .meta strong { color: #102033; font-size: 30px; }
          h1 {
            position: relative;
            z-index: 1;
            min-height: 92px;
            margin: 0 0 16px;
            font-size: 45px;
            line-height: 1.02;
            letter-spacing: 0;
          }
          .flavor, .headline {
            position: relative;
            z-index: 1;
            margin: 0;
            color: #35455a;
            font-size: 25px;
            line-height: 1.22;
            font-weight: 650;
          }
          .special {
            position: absolute;
            left: 36px;
            right: 36px;
            bottom: 86px;
            min-height: 92px;
            padding: 18px 20px;
            border: 3px solid #b8c8d7;
            border-radius: 18px;
            background: #eef5f9;
            color: #17283d;
            font-size: 22px;
            line-height: 1.18;
            font-weight: 700;
          }
          .special b { text-transform: uppercase; }
          .special em {
            display: block;
            margin-top: 7px;
            color: #526174;
            font-style: normal;
          }
          footer {
            position: absolute;
            left: 36px;
            right: 36px;
            bottom: 30px;
            display: flex;
            justify-content: space-between;
            color: #657489;
            font-size: 18px;
            font-weight: 800;
            text-transform: uppercase;
          }
          .event-card {
            background:
              linear-gradient(90deg, rgba(16,32,51,0.04) 1px, transparent 1px),
              linear-gradient(rgba(16,32,51,0.04) 1px, transparent 1px),
              #fffaf1;
          }
          .event-label {
            display: inline-flex;
            padding: 12px 16px;
            border: 3px solid #102033;
            border-radius: 14px;
            background: #ffd978;
            font-size: 24px;
            font-weight: 950;
            text-transform: uppercase;
          }
          .event-card h1 {
            margin-top: 52px;
            min-height: 150px;
            font-size: 58px;
          }
          .event-window {
            margin-top: 54px;
            padding: 26px;
            border: 4px solid #102033;
            border-radius: 20px;
            background: #fff;
          }
          .event-window p {
            margin: 0;
            font-size: 34px;
            line-height: 1.2;
            font-weight: 900;
          }
          .change-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 26px;
          }
          .change {
            min-width: 120px;
            height: 58px;
            font-size: 24px;
          }
          .discount { background: #dff3dc; }
          .tax { background: #ffe1d8; }
          .income-mod .change { background: #e9e0ff; }
          .blocked {
            margin-top: 22px;
            padding: 18px;
            border: 3px solid #d08c72;
            border-radius: 18px;
            background: #fff0eb;
            font-size: 26px;
            font-weight: 850;
          }
        </style>
      </head>
      <body>${body}</body>
    </html>`
}

async function renderOne(page: Page, html: string, target: string) {
  await page.setViewportSize({ width: cardWidth, height: cardHeight })
  await page.setContent(html, { waitUntil: 'load' })
  await page.locator('#card').screenshot({ path: target })
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(cardOutput, { recursive: true })
  await mkdir(eventOutput, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: cardWidth, height: cardHeight }, deviceScaleFactor: 1 })

  const cards = []
  for (let index = 0; index < CARDS.length; index += 1) {
    const card = CARDS[index]
    const filename = `${String(index + 1).padStart(2, '0')}-${fileSafe(card.name)}.png`
    await renderOne(page, cardHtml(card, index), path.join(cardOutput, filename))
    cards.push({ id: card.id, name: card.name, file: `cards/${filename}` })
  }

  const events = []
  for (let index = 0; index < EVENTS.length; index += 1) {
    const event = EVENTS[index]
    const filename = `${String(index + 1).padStart(2, '0')}-${fileSafe(event.name)}.png`
    await renderOne(page, eventHtml(event, index), path.join(eventOutput, filename))
    events.push({ id: event.id, name: event.name, file: `events/${filename}` })
  }

  await browser.close()

  await writeFile(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), size: { width: cardWidth, height: cardHeight }, cards, events }, null, 2)}\n`,
  )

  console.log(`Generated ${cards.length} card PNGs and ${events.length} event PNGs in ${outputRoot}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
