import { announce } from './a11y.js'
import { el, text } from './dom.js'
import { t } from '../i18n/index.js'
import { formatBytes } from './try-it/view-bits.js'

// Minimum animation sequence (ms). A local response can come back in 15 ms:
// without a floor, the laser is just an unreadable flash. The durations below
// drive ONLY the animation — the displayed numbers remain the real measurements.
const SWEEP_MS = 120 // outbound: 0 → OUT_HOLD %
const SEAL_MS = 50 // outbound: OUT_HOLD → 100% when headers arrive
const RETURN_MS = 100 // return: 100 → 0%

// The outbound stops before the end as long as the server hasn't responded: a bar
// that reaches 100% and then waits announces a completion that hasn't happened.
const OUT_HOLD = 85

// Below this threshold, the body arrives in one or two chunks and a bar
// driven by bytes would just stutter: the animation clock is enough.
const BYTE_DRIVEN_MIN = 64 * 1024

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// `onSettled`: the visual sequence is finished, bar stopped. Used to
// chain another animation without overlapping it with the laser still in flight.
// Never called on network failure — there's nothing to chain.
export function createSendMeter({ onSettled } = {}) {
  const beamOut = el('div', 'api-send-beam api-send-beam-out')
  const beamIn = el('div', 'api-send-beam api-send-beam-in')
  const spark = el('div', 'api-send-spark')
  const rail = el('div', 'api-send-rail', beamOut, beamIn, spark)

  // overflow-hidden and not `truncate`: text-overflow doesn't apply to
  // flex children, the ellipsis would never show. This is a last-resort
  // guard rail — the content is sized to fit (cf. renderStats).
  const phases = el(
    'div',
    'api-send-phases flex items-baseline gap-1.5 min-w-0 overflow-hidden whitespace-nowrap',
  )
  const total = el('div', 'api-send-total shrink-0 font-semibold')
  const stats = el('div', 'api-send-stats flex items-baseline justify-between gap-2', phases, total)

  // The numbers scroll continuously: announcing them would be an uninterrupted
  // flow. Only the start goes through the live region — the outcome is
  // announced by the caller, which alone knows the response status.
  stats.setAttribute('aria-hidden', 'true')

  const node = el(
    'div',
    'api-send-meter grow min-w-0 flex flex-col justify-center gap-1.5',
    rail,
    stats,
  )

  let phase = 'idle' // idle | out | wait | in | done | error
  let clock = 0 // origin of the animation AND of the displayed measurements
  let outMs = null // start → headers received
  let inMs = null // headers → body fully read
  let serverMs = null // real server time, if the API exposes it
  let sizeBytes = null
  let byteDriven = false
  let floorDone = false
  let bodyDone = false
  let raf = 0
  const timers = new Set()

  const after = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
    return id
  }
  const clearTimers = () => {
    for (const id of timers) clearTimeout(id)
    timers.clear()
  }

  const now = () => performance.now() - clock

  // `pct` = position of the spark. On the outbound it drags the primary bar from the
  // left; on the return the outbound stays full and the accent bar overlays it by
  // revealing itself from the right — hence the two complementary clips.
  function paint(pct, ms) {
    const duration = reduceMotion() ? 0 : ms
    const returning = phase === 'in' || phase === 'done'
    for (const beam of [beamOut, beamIn]) beam.style.transitionDuration = `${duration}ms`
    spark.style.transitionDuration = `${duration}ms`
    beamOut.style.clipPath = returning
      ? 'inset(0 0 0 0)'
      : `inset(0 ${100 - Math.min(pct, 100)}% 0 0)`
    beamIn.style.clipPath = returning ? `inset(0 0 0 ${pct}%)` : 'inset(0 0 0 100%)'
    spark.style.left = `${pct}%`
  }

  function renderStats() {
    const outValue = outMs ?? (phase === 'out' || phase === 'wait' ? now() : null)
    const inValue = inMs ?? (phase === 'in' ? now() - (outMs ?? 0) : null)

    const parts = []
    // Splitting network/server only makes sense if the time announced by the API
    // fits within the measured outbound. Beyond that (clocks out of sync, proxy in
    // between), we don't fake a "network 0 ms": the outbound stays a single number.
    const split = serverMs != null && outValue != null && serverMs > 0 && serverMs <= outValue
    if (split) {
      parts.push(stat(t('tryit.meterNet'), num(outValue - serverMs), t('tryit.meterNetTitle')))
      parts.push(stat(t('tryit.meterServer'), num(serverMs), t('tryit.meterServerTitle')))
    } else if (outValue != null) {
      parts.push(stat(t('tryit.meterOut'), num(outValue), t('tryit.meterOutTitle')))
    }
    if (inValue != null) parts.push(stat(t('tryit.meterIn'), num(inValue), t('tryit.meterInTitle')))
    // Measured in the panel: phases + total have 228px available. Three timings
    // take up 157 at worst, the total 45 — the size (62) only fits in
    // the case without server splitting, and yields rather than truncate a number.
    if (!split && sizeBytes != null) {
      parts.push(stat(t('tryit.meterSize'), formatBytes(sizeBytes), t('tryit.meterSizeTitle')))
    }

    phases.replaceChildren(...interleave(parts))
    // The unit is only carried by the total: repeating it on each phase costs
    // ~17px per occurrence, and the row can't afford it.
    const totalValue = outMs != null && inMs != null ? outMs + inMs : now()
    total.replaceChildren(text(t('tryit.duration', { ms: Math.round(totalValue) })))
    total.title = t('tryit.meterTotalTitle')
  }

  function tick() {
    renderStats()
    raf = requestAnimationFrame(tick)
  }

  function stopTicking() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  // The outbound only closes once both conditions are met:
  // headers received AND the animation floor elapsed.
  function sealOut() {
    if (phase !== 'out' && phase !== 'wait') return
    const elapsed = now()
    const duration = Math.max(SEAL_MS, SWEEP_MS + SEAL_MS - elapsed)
    rail.classList.remove('is-waiting')
    paint(100, duration)
    after(duration, startReturn)
  }

  function startReturn() {
    phase = 'in'
    rail.classList.add('is-returning')
    // Large body: it's `progress()` that drives the bar, and the body
    // may already be fully read — hence the immediate finish(), without which nothing
    // would come to close the sequence.
    if (byteDriven) {
      finish()
      return
    }
    paint(0, RETURN_MS)
    after(RETURN_MS, () => {
      floorDone = true
      finish()
    })
  }

  function finish() {
    if (phase !== 'in' || !floorDone || !bodyDone) return
    phase = 'done'
    // Byte-driven control leaves the bar mid-course: it still has this
    // last leg to travel before being truly still.
    const settleMs = byteDriven ? 120 : 0
    paint(0, settleMs)
    rail.classList.add('is-done')
    stopTicking()
    renderStats()
    // Goes through `after`: a new send in the meantime cancels the notification
    // along with the other timers, instead of having it pop up on the
    // next sequence that has already started.
    after(settleMs, () => onSettled?.())
  }

  return {
    node,

    // `originMs`: the caller imposes its origin so that the total displayed here
    // and the entry's `durationMs` are the same measurement. Without it, the
    // forced reflow below is enough to offset them by 1 to 3 ms.
    start(originMs) {
      clearTimers()
      stopTicking()
      phase = 'out'
      clock = originMs ?? performance.now()
      outMs = inMs = serverMs = sizeBytes = null
      byteDriven = floorDone = bodyDone = false

      rail.className = 'api-send-rail'
      node.classList.add('is-live')
      // Reset to zero without transition, otherwise the previous run's bar
      // visibly flows back before starting again.
      paint(0, 0)
      rail.offsetWidth // forces the reflow so the 0% is committed
      paint(OUT_HOLD, SWEEP_MS)
      after(SWEEP_MS, () => {
        if (phase !== 'out') return
        phase = 'wait'
        rail.classList.add('is-waiting')
      })
      announce(t('tryit.sending'))
      tick()
    },

    // Headers received: end of the outbound, start of the return. `atMs` = exact
    // instant of the event, recorded by the caller before any processing.
    headers({ serverMs: server, atMs } = {}) {
      if (phase !== 'out' && phase !== 'wait') return
      outMs = (atMs ?? performance.now()) - clock
      if (server != null) serverMs = server
      sealOut()
    },

    progress(received, contentLength) {
      if (phase !== 'in' && phase !== 'out' && phase !== 'wait') return
      if (!byteDriven && contentLength >= BYTE_DRIVEN_MIN) byteDriven = true
      if (!byteDriven || phase !== 'in' || !contentLength) return
      // A compressed body decompresses beyond its Content-Length: we
      // clamp the ratio rather than let the bar overflow.
      const ratio = Math.min(1, received / contentLength)
      paint(100 - ratio * 100, 120)
    },

    // Body fully read.
    done({ sizeBytes: size = null, serverMs: server = null, atMs } = {}) {
      if (phase === 'done' || phase === 'error' || phase === 'idle') return
      if (inMs == null) inMs = Math.max(0, (atMs ?? performance.now()) - clock - (outMs ?? 0))
      if (size != null) sizeBytes = size
      if (server != null && serverMs == null) serverMs = server
      bodyDone = true
      if (byteDriven) floorDone = true
      finish()
    },

    // Network/CORS failure: no response exists, the spark scatters. An
    // exception thrown AFTER the response has been rendered no longer concerns the send:
    // repainting the panel red would contradict a response that was in fact received.
    fail() {
      if (phase === 'idle' || phase === 'done') return
      if (outMs == null) outMs = now()
      phase = 'error'
      clearTimers()
      stopTicking()
      rail.className = 'api-send-rail is-error'
      renderStats()
    },
  }
}

function stat(label, value, title) {
  const node = el(
    'span',
    'api-send-stat whitespace-nowrap',
    el('span', 'text-subtle', text(label)),
    text(` ${value}`),
  )
  node.title = title
  return node
}

function interleave(parts) {
  return parts.flatMap((part, i) => (i ? [el('span', 'text-faint', text('·')), part] : [part]))
}

// The body of a short JSON response is read in under a millisecond:
// displaying "0" would read as "not measured" rather than "instant".
const num = (value) => (value < 0.5 ? t('tryit.durationSub') : String(Math.round(value)))
