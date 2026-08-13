import { MASK } from '../export/redact.js'
import { t } from '../i18n/index.js'
import { el, text } from './dom.js'
import { pointerToPath } from '../scenarios/pointer.js'
import { statusColorClass } from './method-colors.js'

// Rendering of a step result (docs/scenarios.md §5.2) — shared by the timeline
// of the scenario view and by the step-by-step bar: the two execution
// modes produce the same object, they must read it the same way.

// Step status color: static map (rule 2 — no built classes).
const STATUS_BADGE = {
  ok: 'badge badge-success badge-sm',
  failed: 'badge badge-error badge-sm',
  blocked: 'badge badge-warning badge-sm',
  skipped: 'badge badge-ghost badge-sm',
}

// `showMissing`: the step-by-step bar offers an entry form instead
// of the list of missing variables — repeating "define them in
// the environment" right above the field waiting for them wouldn't help anyone.
export function stepReportBlock(result, { openHistory = null, showMissing = true } = {}) {
  const status = result.result?.response?.status
  const head = el(
    'div',
    'flex flex-wrap items-center gap-2 text-sm',
    el(
      'span',
      STATUS_BADGE[result.status] ?? 'badge badge-sm',
      text(t(`scenario.status.${result.status}`)),
    ),
    result.reason ? el('span', 'text-subtle', text(t(`scenario.reason.${result.reason}`))) : null,
    status
      ? el('span', `font-mono font-bold ${statusColorClass(status)}`, text(String(status)))
      : null,
    result.result
      ? el('span', 'text-subtle font-mono text-xs', text(`${result.result.durationMs} ms`))
      : null,
  )
  if (result.result && openHistory) {
    const link = el('button', 'btn btn-ghost btn-xs', text(t('scenario.viewInHistory')))
    link.type = 'button'
    // The step, not just its endpoint: the popin must open on THIS
    // entry, expanded — an endpoint called twenty times doesn't help. Sorting, for
    // its part, is decided by the caller: the scenario view frames on its scenario.
    link.addEventListener('click', () => openHistory({ opId: result.opId, stepId: result.stepId }))
    head.append(link)
  }
  const lines = []
  for (const name of showMissing ? (result.missing ?? []) : []) {
    lines.push(
      el('div', 'font-mono text-xs text-error', text(t('tryit.missingVars', { names: name }))),
    )
  }
  if (result.result?.error) {
    lines.push(el('code', 'font-mono text-xs break-all text-error', text(result.result.error)))
  }
  for (const check of result.checks ?? []) {
    if (check.ok) continue
    lines.push(el('div', 'font-mono text-xs text-error break-all', text(checkLabel(check))))
  }
  for (const extract of result.extracted ?? []) {
    const value = extract.ok
      ? `${extract.name} = ${extract.sensitive ? MASK : extract.value}`
      : `${extract.name} — ${t(`scenario.extract.${extract.code}`)}`
    lines.push(
      el(
        'div',
        `font-mono text-xs break-all ${extract.ok ? 'text-subtle' : 'text-error'}`,
        text(value),
      ),
    )
  }
  for (const warning of result.warnings ?? []) {
    lines.push(
      el(
        'div',
        'font-mono text-xs text-subtle',
        text(t('scenario.warn.variable-shadowed', { name: warning.name })),
      ),
    )
  }
  return el('div', 'border-t border-base-300 pt-2 flex flex-col gap-1', head, ...lines)
}

// One failed check, one line. Four shapes rather than one, because the ops
// fail in genuinely different ways: a query assertion has neither an expected
// value nor an observed one (an empty nodelist is the whole failure), and a
// pattern is not a value the reader should see quoted like a literal.
function checkLabel(check) {
  if (check.kind === 'status') {
    return t('scenario.checkStatus', { expected: check.expected, actual: check.actual })
  }
  if (check.op === 'matches') {
    return t('scenario.checkMatches', {
      query: check.query,
      reason: t(`scenario.match.${check.code ?? 'empty'}`),
    })
  }
  // The verdict names the path the way the editor displays it: two notations
  // for the same field would make the failure unrecognizable.
  const pointer = pointerToPath(check.pointer) || t('scenario.chain.wholeBody')
  if (check.op === 'regex' && !check.code) {
    return t('scenario.checkRegex', {
      pointer,
      pattern: check.expected,
      actual: formatValue(check.actual),
    })
  }
  return t('scenario.checkAssertion', {
    pointer,
    expected: check.code ? t(`scenario.extract.${check.code}`) : formatValue(check.expected),
    actual: formatValue(check.actual),
  })
}

function formatValue(value) {
  if (value === undefined) return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
