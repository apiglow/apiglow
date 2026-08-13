// The insight strip (docs/network-insights.md §4.3): one wrapping row of chips
// reading what a response's headers say, plus the two actions HTTP allows on a
// safe method. Nothing here is stored — the strip is recomputed from the
// entry's own headers every time it renders (decision 3), so a fresh response
// and an archived one go through exactly the same code.
//
// The one thing the two callers can't share is their background: the try-it's
// response mockup is a navy panel outside the theme (fixed colors, like the
// rest of `view-bits.js`), the history detail is the ordinary page. Hence
// `SURFACE` — two static skins (rule 2), one renderer.

import { t } from '../i18n/index.js'
import { analyzeResponseHeaders } from '../openapi/insights.js'
import { conditionalRequest, followRequest } from '../openapi/request-builder.js'
import { hoverCopyButton } from './copy-button.js'
import { el, text } from './dom.js'
import { PANEL_BUTTON, copyIconButton, formatBytes } from './try-it/view-bits.js'

const CHIP_SHAPE = 'rounded-full px-2 py-0.5 text-[11px] font-mono'

const SURFACE = {
  panel: {
    row: 'flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-white/10',
    // The caption is a colour of its own, never an opacity over the chip's:
    // multiplied into `text-white/70` it lands at 0.42 of the ink, well under
    // the AA floor the sweep gates on (§12).
    caption: 'text-white/60',
    chip: {
      neutral: `${CHIP_SHAPE} bg-white/10 text-white/70`,
      warning: `${CHIP_SHAPE} bg-amber-400/15 text-amber-300`,
      accent: `${CHIP_SHAPE} bg-violet-400/15 text-violet-300`,
    },
    action: PANEL_BUTTON,
    copy: (getText) => copyIconButton(getText),
  },
  page: {
    row: 'flex flex-wrap items-center gap-1.5',
    // Softened, not neutralized: on a badge the caption keeps the tone's hue,
    // which is exactly what a `currentColor` mix is for.
    caption: 'text-quiet',
    chip: {
      neutral: 'badge badge-sm badge-ghost font-mono',
      warning: 'badge badge-sm badge-warning badge-soft font-mono',
      accent: 'badge badge-sm badge-accent badge-soft font-mono',
    },
    action: 'btn btn-xs btn-ghost',
    copy: (getText) => hoverCopyButton(getText, t('export.copy')),
  },
}

// Which rel gets its own button. `first`/`last` stay in the chip's tooltip:
// a row of four buttons would drown the two anyone actually clicks (§4.2).
const FOLLOW_LABELS = { next: 'tryit.insights.followNext', prev: 'tryit.insights.followPrev' }

const CHIPS = {
  'rate-limit': rateLimitChip,
  'retry-after': retryAfterChip,
  deprecation: deprecationChip,
  pagination: paginationChips,
  correlation: correlationChip,
  validators: validatorChips,
}

// `nextHopProtocol` is an ALPN id; anything not listed here gets no badge
// rather than a raw token nobody can read (§5.2, rule 2).
const PROTOCOL_LABELS = {
  'http/1.0': 'HTTP/1.0',
  'http/1.1': 'HTTP/1.1',
  h2: 'HTTP/2',
  h2c: 'HTTP/2',
  h3: 'HTTP/3',
}

/**
 * @param {object} entry - a history entry, fresh or archived.
 * @param {object} options
 * @param {'panel'|'page'} options.surface - which background it lands on.
 * @param {boolean} options.live - true while the response is the current one: its
 *   deadlines are still ahead and tick. An archive's are spent, and render as the
 *   clock time they pointed at.
 * @param {((built: object) => void)|null} options.send - the pipeline the two
 *   actions go through. Without it, the chips render and nothing is clickable.
 * @returns {HTMLElement|null} null when the response says nothing worth a chip —
 *   which is the ordinary case on a third-party API (decision 2).
 */
export function insightStrip(entry, { surface = 'panel', live = false, send = null } = {}) {
  const response = entry?.response
  if (!response) return null
  // Read as of when the response arrived, whenever it is rendered. That is what
  // makes a deadline an instant instead of a duration: `Retry-After: 30` and a
  // `Retry-After` HTTP-date both reduce to `timestamp + resetSeconds` once the
  // analyzer has read them against the entry's own clock.
  const at = entry.timestamp
  const insights = analyzeResponseHeaders(response.headers, {
    status: response.status,
    method: entry.method,
    url: entry.request?.url ?? '',
    now: at,
  })
  const context = { skin: SURFACE[surface], live, at, entry, send }
  const built = insights.map((insight) => CHIPS[insight.kind](insight, context))
  // Header chips, then the transfer facts appended to the same row (§5.2),
  // then the actions — buttons last, so the row reads as facts before verbs.
  const chips = [...built.flatMap((one) => one.chips), ...transferChips(entry.transfer, context)]
  if (!chips.length) return null
  const strip = el('div', context.skin.row, ...chips, ...built.flatMap((one) => one.actions))
  // Named for the e2e guard that checks the strip is ABSENT on a plain API:
  // "no chip anywhere" is only assertable against something that has a name.
  strip.dataset.insightStrip = surface
  return strip
}

// What the browser measured about the exchange itself (§5.2). Nothing is shown
// for the unremarkable case: an uncompressed body over an unnamed protocol is
// not a finding, it is Tuesday.
function transferChips(transfer, context) {
  if (!transfer) return []
  const chips = []
  const protocol = PROTOCOL_LABELS[transfer.protocol?.toLowerCase()]
  if (protocol) chips.push(chip(context, 'neutral', protocol, []))
  // The threshold stays here, unlike the rate limit's `low` which the core
  // computes: the snapshot is STORED, and a flag derivable from two of its own
  // fields would be state duplicated into storage (decision 3).
  const { encodedBodySize, decodedBodySize } = transfer
  if (decodedBodySize > encodedBodySize && encodedBodySize > 0) {
    chips.push(
      chip(context, 'neutral', t('tryit.insights.compressed'), [
        text(
          t('tryit.insights.compressedValue', {
            wire: formatBytes(encodedBodySize),
            decoded: formatBytes(decodedBodySize),
            ratio: (decodedBodySize / encodedBodySize).toFixed(1),
          }),
        ),
      ]),
    )
  }
  if (transfer.fromCache) {
    const node = chip(context, 'neutral', t('tryit.insights.fromCache'), [])
    // The duration next to it timed a read from disk, not a round trip.
    node.title = t('tryit.insights.fromCacheTitle')
    chips.push(node)
  }
  return chips
}

function rateLimitChip({ limit, remaining, resetSeconds, low }, context) {
  const values = []
  if (remaining !== null) {
    values.push(
      text(
        limit === null
          ? t('tryit.insights.rateLimitLeft', { remaining })
          : t('tryit.insights.rateLimitLeftOf', { remaining, limit }),
      ),
    )
  }
  if (resetSeconds !== null) {
    values.push(
      deadline(resetSeconds, context, 'tryit.insights.resetsIn', 'tryit.insights.resetsAt'),
    )
  }
  return {
    chips: [chip(context, low ? 'warning' : 'neutral', t('tryit.insights.rateLimit'), values)],
    actions: [],
  }
}

function retryAfterChip({ seconds }, context) {
  const node = chip(context, 'warning', t('tryit.insights.retryAfter'), [
    deadline(seconds, context, 'tryit.insights.retryIn', 'tryit.insights.retryAt'),
  ])
  return { chips: [node], actions: [] }
}

function deprecationChip({ deprecated, sunsetDate }, context) {
  const label = deprecated ? t('tryit.insights.deprecated') : t('tryit.insights.sunsetAnnounced')
  const values = sunsetDate
    ? [text(t('tryit.insights.sunsetOn', { date: new Date(sunsetDate).toLocaleDateString() }))]
    : []
  return { chips: [chip(context, 'accent', label, values)], actions: [] }
}

function paginationChips({ links, followable }, context) {
  const node = chip(context, 'neutral', t('tryit.insights.pagination'), [
    text(links.map((link) => link.rel).join(' · ')),
  ])
  node.title = links.map((link) => `${link.rel}: ${link.url}`).join('\n')
  const buttons = followable
    ? links
        .filter((link) => FOLLOW_LABELS[link.rel])
        .map((link) =>
          actionButton(context, t(FOLLOW_LABELS[link.rel]), t('tryit.insights.followTitle'), () =>
            context.send(followRequest(context.entry, link.url)),
          ),
        )
    : []
  return { chips: [node], actions: buttons.filter(Boolean) }
}

function correlationChip({ name, value }, context) {
  const node = chip(context, 'neutral', name, [text(value)])
  // `group` is what reveals the page skin's copy button on hover; the panel
  // skin's is always visible and ignores it.
  return {
    chips: [
      el(
        'span',
        'group inline-flex items-center gap-1',
        node,
        context.skin.copy(() => value),
      ),
    ],
    actions: [],
  }
}

function validatorChips({ etag, lastModified, replayable }, context) {
  const node = etag
    ? chip(context, 'neutral', t('tryit.insights.etag'), [text(etag)])
    : chip(context, 'neutral', t('tryit.insights.lastModified'), [text(lastModified)])
  const button = replayable
    ? actionButton(
        context,
        t('tryit.insights.conditionalReplay'),
        t('tryit.insights.conditionalReplayTitle'),
        () => context.send(conditionalRequest(context.entry, { etag, lastModified })),
      )
    : null
  return { chips: [node], actions: button ? [button] : [] }
}

// The label is a caption when it captions something, and the whole chip when it
// stands alone (a protocol badge has no second half to dim itself against).
function chip(context, tone, label, values) {
  const caption = values.length
    ? el('span', context.skin.caption, text(`${label} `))
    : el('span', '', text(label))
  return el('span', context.skin.chip[tone], caption, ...values)
}

// An action exists only when something can carry it out: the history detail
// shows the same chips with no pipeline behind them (§4.2).
function actionButton(context, label, title, onClick) {
  if (!context.send) return null
  const button = el('button', context.skin.action, text(label))
  button.type = 'button'
  button.title = title
  button.addEventListener('click', onClick)
  return button
}

// A deadline reads as a countdown while it is still ahead, and as the clock
// time it pointed at once the response is an archive (§4.3). Anchored on the
// response: switching to the example and back must not restart the countdown.
function deadline(seconds, { live, at }, inKey, atKey) {
  const targetAt = at + seconds * 1000
  if (!live) {
    return el('span', '', text(t(atKey, { time: new Date(targetAt).toLocaleTimeString() })))
  }
  return countdown(targetAt, (left) => t(inKey, { seconds: left }))
}

// A countdown is a hint, not an alarm clock (decision 8): it ticks while it is
// on screen and stops itself the moment a re-render drops it. Only the reading
// taken at render time is exposed to assistive tech — a value rewritten every
// second would be announced every second (§4.3, the send meter's pattern).
function countdown(targetAt, format) {
  const ticking = el('span', '')
  ticking.setAttribute('aria-hidden', 'true')
  const paint = () => {
    const left = Math.max(0, Math.round((targetAt - Date.now()) / 1000))
    ticking.textContent = format(left)
    return left
  }
  const atRender = paint()
  const timer = setInterval(() => {
    // Detached by a re-render — or never inserted at all, which the first tick
    // is late enough to tell.
    if (!ticking.isConnected || paint() === 0) clearInterval(timer)
  }, 1000)
  return el('span', '', el('span', 'sr-only', text(format(atRender))), ticking)
}
