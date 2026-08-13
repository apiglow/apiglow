import { t } from '../i18n/index.js'
import { scenarioHash } from '../router.js'
import { el, text } from './dom.js'
import { markdownBlock } from './markdown.js'
import { methodBadgeClass } from './method-colors.js'

// Scenarios pinned on the home page (`pinned: true` in the config, docs/scenarios.md
// §3): an authentication flow has more value close at hand than buried in
// the nav. Reserved for the config — the home page belongs to the API's editor, not
// to scenarios the reader has hacked together.
//
// The card exists as soon as the config declares a pinned entry, and fills in
// when the loader has resolved it: an entry can declare several scenarios (an
// Arazzo document, one per workflow), so even how many boxes to draw is not
// known from the config alone.

// Beyond that, the card no longer lists steps one by one: the home page isn't the
// scenario view.
const MAX_STEP_CHIPS = 6

export function pinnedScenariosCard(entries, { ops = new Map(), resolved } = {}) {
  const pinned = (entries ?? []).filter((entry) => entry.pinned)
  if (!pinned.length) return null
  const list = el('div', 'flex flex-col gap-2')
  resolved
    ?.then((records) => {
      list.replaceChildren(
        ...records.filter((record) => record.pinned).map((record) => scenarioCard(record, ops)),
      )
    })
    .catch((err) => console.error('[api-doc] pinned scenarios unavailable:', err))
  return el(
    'div',
    'card card-border border-base-300 bg-base-200/50',
    el(
      'div',
      'card-body p-4 gap-3',
      el(
        'div',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1',
        el('h2', 'card-title text-base', text(t('scenario.pinnedTitle'))),
        el('span', 'text-sm text-subtle', text(t('scenario.pinnedIntro'))),
      ),
      list,
    ),
  )
}

function scenarioCard(record, ops) {
  const open = el('a', 'btn btn-sm btn-primary btn-soft', text(t('scenario.pinnedOpen')))
  open.href = scenarioHash(record.id)
  open.dataset.pinnedScenario = record.id
  const title = el('span', 'font-bold', text(record.title))
  const head = el('div', 'flex flex-wrap items-center gap-2', title, el('span', 'grow'), open)
  const detail = el('div', 'flex flex-col gap-2')
  const box = el(
    'div',
    'border border-base-300 bg-base-100 rounded-box p-3 flex flex-col gap-2',
    head,
    detail,
  )
  box.dataset.pinnedCard = record.id
  // File unreachable or unreadable: the box stays, with its link — it's the
  // scenario view that will explain it.
  const scenario = record.scenario
  if (!scenario) return box

  head.insertBefore(
    el(
      'span',
      'badge badge-ghost badge-sm',
      text(t('scenario.stepCount', { count: scenario.steps.length })),
    ),
    title.nextSibling,
  )
  const description = markdownBlock(scenario.description)
  if (description) {
    description.classList.add('text-sm')
    detail.append(description)
  }
  const steps = scenario.steps.slice(0, MAX_STEP_CHIPS).map((step) => stepChip(step, ops))
  if (scenario.steps.length > MAX_STEP_CHIPS) {
    detail.append(
      el(
        'div',
        'flex flex-wrap items-center gap-1.5',
        ...steps,
        el('span', 'text-xs text-subtle', text('…')),
      ),
    )
  } else if (steps.length) {
    detail.append(el('div', 'flex flex-wrap items-center gap-1.5', ...steps))
  }
  return box
}

function stepChip(step, ops) {
  const op = ops.get(step.opId)
  return el(
    'span',
    'inline-flex items-center gap-1 text-xs font-mono text-subtle',
    el('span', methodBadgeClass(op?.method), text(op?.method ?? '?')),
    text(op?.path ?? step.opId),
  )
}
