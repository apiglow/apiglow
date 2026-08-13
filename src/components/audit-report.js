import { CATEGORIES, GRADES, LOWEST_GRADE } from '../audit/constants.js'
import { gradeFor } from '../audit/engine.js'
import { toAuditMarkdown } from '../export/audit-markdown.js'
import { t } from '../i18n/index.js'
import { opHash } from '../router.js'
import { copyTextButton } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadAction, downloadsBar } from './download-action.js'
import { CHEVRON_RIGHT_SVG, JUMP_SVG } from './icons.js'
import { specStats } from './spec-stats.js'

// Schema audit page (docs/audit.md §6), routed on #/audit. Renders the plain
// report `auditSchema` returns — the component never touches the schema itself,
// and every string it shows comes from the rule id plus the finding's params.

// Static class maps (rule 2): a `badge-${severity}` would be purged out of the
// built CSS.
const SEVERITY_BADGE = {
  error: 'badge badge-sm badge-error',
  warning: 'badge badge-sm badge-warning',
  info: 'badge badge-sm badge-info',
}

// Grade color, and the matching bar color for a category score. Both read from
// the same bands so a green letter never sits above an orange bar.
const GRADE_TEXT = {
  A: 'text-success',
  B: 'text-success',
  C: 'text-warning',
  D: 'text-warning',
  F: 'text-error',
}
const GRADE_PROGRESS = {
  A: 'progress progress-success',
  B: 'progress progress-success',
  C: 'progress progress-warning',
  D: 'progress progress-warning',
  F: 'progress progress-error',
}

// Same order as the counts in the report, most severe first.
const SEVERITIES = ['error', 'warning', 'info']

class AuditReport extends HTMLElement {
  #report = null
  #download = null

  set report(report) {
    this.#report = report
    if (this.isConnected) this.#render()
  }

  // The schema as served, from the shell — the only thing on this page the
  // report cannot produce on its own, since where the document came from is
  // host config (rule 10). Same descriptor as the home page's.
  set download(descriptor) {
    this.#download = descriptor
    if (this.isConnected && this.#report) this.#render()
  }

  connectedCallback() {
    this.classList.add('block', 'max-w-4xl', 'flex', 'flex-col', 'gap-6')
    if (this.#report) this.#render()
  }

  #render() {
    const report = this.#report
    // Sections are built before the summary so its score bars can hold a
    // reference to the section they score — a category with no finding has no
    // section, and its bar must not offer to jump to one.
    const sections = new Map(
      report.counts.total
        ? report.categories.filter((c) => c.findings.length).map((c) => [c.id, categorySection(c)])
        : [],
    )
    this.replaceChildren(
      el(
        'header',
        'flex flex-col gap-1',
        el(
          'div',
          'flex flex-wrap items-center justify-between gap-2',
          el('h1', 'text-2xl font-bold', text(t('audit.title'))),
          copyButton(() => toAuditMarkdown(report)),
        ),
        el('p', 'text-sm text-subtle', text(t('audit.intro'))),
      ),
      identityCard(report, this.#download),
      summaryCard(report, sections),
      helpBlock(),
      ...(sections.size ? sections.values() : [emptyState()]),
    )
  }
}

// A grade and five category names mean nothing without the bands and the
// definitions behind them, and spelling them out permanently would bury the
// findings. Collapsed by default: read once, then never again.
function helpBlock() {
  const details = el(
    'details',
    'group collapse collapse-arrow border border-base-300 bg-base-200/40',
    el('summary', 'collapse-title min-h-0 py-3 text-sm font-bold', text(t('audit.help.title'))),
    el(
      'div',
      'collapse-content flex flex-col gap-4 text-sm pb-4',
      el(
        'div',
        'flex flex-col gap-2',
        el('h3', 'font-bold', text(t('audit.help.grades'))),
        gradeScale(),
        el('p', 'text-subtle', text(t('audit.help.scoring'))),
      ),
      definitionList(
        t('audit.help.severities'),
        SEVERITIES.map((severity) => ({
          term: el('span', SEVERITY_BADGE[severity], text(t(`audit.severity.${severity}`))),
          text: t(`audit.help.severity.${severity}`),
        })),
      ),
      definitionList(
        t('audit.help.categories'),
        CATEGORIES.map((id) => ({
          term: el('span', 'font-bold', text(t(`audit.category.${id}`))),
          text: t(`audit.help.category.${id}`),
        })),
      ),
    ),
  )
  details.dataset.auditHelp = ''
  return details
}

// Built from the engine's own thresholds rather than restated here: a band that
// moves must move in one place (docs/audit.md §3).
function gradeScale() {
  const bands = GRADES.map(([grade, threshold]) =>
    el(
      'span',
      'flex items-baseline gap-1',
      el('span', `font-bold ${GRADE_TEXT[grade]}`, text(grade)),
      el('span', 'font-mono text-xs text-subtle', text(`≥ ${threshold}`)),
    ),
  )
  bands.push(
    el(
      'span',
      'flex items-baseline gap-1',
      el('span', `font-bold ${GRADE_TEXT[LOWEST_GRADE]}`, text(LOWEST_GRADE)),
      el('span', 'font-mono text-xs text-subtle', text(`< ${GRADES[GRADES.length - 1][1]}`)),
    ),
  )
  return el('div', 'flex flex-wrap gap-x-4 gap-y-1', ...bands)
}

function definitionList(title, entries) {
  return el(
    'div',
    'flex flex-col gap-2',
    el('h3', 'font-bold', text(title)),
    el(
      'dl',
      'flex flex-col gap-1',
      ...entries.flatMap(({ term, text: body }) => [
        el('dt', 'inline', term),
        el('dd', 'text-subtle mb-1', text(body)),
      ]),
    ),
  )
}

// What is being audited, before how it scores: an audit read out of context —
// pasted screenshot, tab left open next to another one — has to say which API
// and which revision it graded.
function identityCard(report, download) {
  const { api, scope } = report
  const meta = [
    api.version ? t('audit.api.version', { version: api.version }) : null,
    report.openapi ? `OpenAPI ${report.openapi}` : null,
  ].filter(Boolean)
  const card = el(
    'section',
    'rounded-box border border-base-300 p-4 flex flex-col gap-3',
    el(
      'div',
      'flex flex-col gap-1',
      api.title ? el('h2', 'text-xl font-bold', text(api.title)) : null,
      meta.length ? el('p', 'text-sm text-subtle font-mono', text(meta.join(' — '))) : null,
    ),
    contactLine(api),
    scopeStats(scope),
  )
  card.dataset.auditIdentity = ''
  if (download) {
    const bar = downloadsBar([
      downloadAction({
        help: t('welcome.specHelp'),
        helpText: t('welcome.specText'),
        label: t('welcome.specDownload'),
        filename: download.filename,
        load: download.load,
        notes: download.notes,
        onError: download.onError,
      }),
    ])
    // The bar carries its own top margin for the home page's flow; here the
    // card's gap already spaces it.
    bar.classList.remove('mt-4')
    card.append(bar)
  }
  return card
}

// The perimeter, in figures — hidden operations included, which is exactly what
// makes it worth printing: the audit spans more than the rendered navigation.
// Every count is shown, zeros included: a nought here is the finding, not an
// empty slot (no security scheme, no group, no webhook are all things the
// report goes on to grade).
function scopeStats(scope) {
  return specStats([
    ['operations', scope.operations],
    ['groups', scope.groups],
    ['webhooks', scope.webhooks],
    ['securitySchemes', scope.securitySchemes],
    ['schemas', scope.schemas],
  ])
}

// `info.contact` and `info.license` are graded by the `info-metadata` rule:
// showing what the document does carry closes the loop between the finding and
// the field it is about.
function contactLine({ contact, license }) {
  const line = el('div', 'flex flex-wrap items-center gap-x-4 gap-y-1 text-sm')
  const contactLabel = contact?.name || contact?.email || contact?.url
  if (contactLabel) {
    const href = contact.url || (contact.email ? `mailto:${contact.email}` : null)
    line.append(labelled(t('audit.api.contact'), String(contactLabel), href))
  }
  if (license?.name || license?.identifier) {
    line.append(
      labelled(t('audit.api.license'), String(license.name || license.identifier), license.url),
    )
  }
  return line.childNodes.length ? line : null
}

function labelled(label, value, href) {
  const safe = safeHref(href)
  const body = safe ? el('a', 'link link-primary', text(value)) : el('span', '', text(value))
  if (safe) {
    body.href = safe
    body.target = '_blank'
    body.rel = 'noopener noreferrer'
  }
  return el('span', 'flex items-center gap-1', el('span', 'text-subtle', text(label)), body)
}

// These URLs come from the schema, and an href is one of the few places
// external content reaches the DOM without passing through DOMPurify (rule 5):
// anything but http/https/mailto renders as plain text rather than as a link.
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function safeHref(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    return LINK_SCHEMES.has(new URL(value, window.location.href).protocol) ? value : null
  } catch {
    return null
  }
}

// The report's only action: hand it over as Markdown, for a ticket or a commit
// message. Generated on click rather than at render: an 80-finding report is
// paid for only if someone asks for it.
function copyButton(generate) {
  const btn = copyTextButton({
    classes: 'btn btn-sm btn-outline',
    label: t('audit.copy'),
    getText: generate,
    announceText: t('audit.copied'),
  })
  btn.dataset.auditCopy = ''
  return btn
}

// How much of each severity, for the whole report or for one category. A
// severity with nothing in it is left out rather than shown as a zero: the
// badges are a weight, and "0 error(s)" reads as a finding.
function severityCounts(counts) {
  return SEVERITIES.filter((severity) => counts[severity]).map((severity) =>
    el(
      'span',
      SEVERITY_BADGE[severity],
      text(t(`audit.count.${severity}`, { n: counts[severity] })),
    ),
  )
}

// Grade, aggregate score, counts, then one bar per scored category — including
// the ones with no finding, whose 100 % is exactly what a reader wants to see.
function summaryCard(report, sections) {
  // The shipped ruleset always scores at least the readiness category (one
  // unconditional check on the document), so grade and score are never null here.
  const grade = report.grade
  const counts = severityCounts(report.counts)
  const card = el(
    'section',
    'rounded-box border border-base-300 p-4 flex flex-col gap-4',
    el(
      'div',
      'flex flex-wrap items-center gap-x-6 gap-y-2',
      el(
        'div',
        'flex items-baseline gap-2',
        el('span', `text-5xl font-bold leading-none ${GRADE_TEXT[grade]}`, text(grade)),
        el('span', 'text-sm text-subtle', text(t('audit.score', { score: report.score }))),
      ),
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        ...(counts.length ? counts : [el('span', 'badge badge-sm', text(t('audit.noFinding')))]),
      ),
    ),
    el(
      'div',
      'flex flex-col gap-2',
      ...report.categories.map((category) => categoryBar(category, sections.get(category.id))),
    ),
  )
  card.dataset.auditSummary = ''
  return card
}

function categoryBar(category, section) {
  const label = t(`audit.category.${category.id}`)
  // <progress> alone announces a bare percentage: the label names which score it
  // is, and the visible figure next to it says the same thing to everyone else.
  const bar = el('progress', `${GRADE_PROGRESS[gradeFor(category.score)]} w-full`)
  bar.value = category.score
  bar.max = 100
  bar.setAttribute('aria-label', t('audit.scoreOf', { category: label, score: category.score }))
  return el(
    'div',
    'grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-3 text-sm',
    section ? jumpToSection(label, category.id, section) : el('span', '', text(label)),
    bar,
    el('span', 'font-mono text-xs text-subtle', text(`${category.score} %`)),
  )
}

// The summary's index role, made operable: on a long report the bars are the
// only way to reach a category without scrolling past the ones above it.
// A button rather than an `href="#…"` anchor — the app is hash-routed, and an
// in-page fragment would be read as a navigation.
//
// Two signals rather than one, because the bars that jump sit right next to
// bars that don't: a persistent link color and underline (`link-primary`, not
// `link-hover`, which is indistinguishable from plain text until pointed at),
// and the arrow saying where the click goes. Nothing else on this page is
// primary-colored and underlined.
function jumpToSection(label, categoryId, section) {
  const glyph = icon(JUMP_SVG, 'contents')
  const btn = el(
    'button',
    'link link-primary text-left w-fit flex items-center gap-1',
    text(label),
    glyph,
  )
  btn.type = 'button'
  btn.dataset.auditJump = categoryId
  btn.title = t('audit.jump', { category: label })
  btn.addEventListener('click', () => {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Scrolling alone leaves a keyboard user where they were: focus follows the
    // jump, on the heading that names where they landed. `preventScroll`, or
    // focusing would snap past the smooth scroll just started.
    section.querySelector('h2')?.focus({ preventScroll: true })
  })
  return btn
}

// Findings arrive sorted by severity then rule then position (engine.js): the
// section renders them in order, one entry per rule rather than one per
// finding. A schema-wide omission — every property undescribed — is one
// decision to make, not two thousand rows to scroll past.
function categorySection(category) {
  const heading = el(
    'h2',
    'text-lg font-bold flex flex-wrap items-center gap-2 scroll-mt-4',
    text(t(`audit.category.${category.id}`)),
    el('span', 'badge badge-sm badge-ghost font-mono', text(`${category.score} %`)),
    ...severityCounts(category.counts),
  )
  // Programmatic focus target only — it never joins the tab order.
  heading.tabIndex = -1
  const section = el(
    'section',
    'flex flex-col gap-2',
    heading,
    el(
      'ul',
      'list border border-base-300 rounded-box',
      ...groupByRule(category.findings).map(ruleGroup),
    ),
  )
  section.dataset.auditCategory = category.id
  return section
}

// Consecutive runs, not a keyed map: the engine's sort already puts a rule's
// findings together, and grouping in place is what keeps the groups themselves
// ordered by severity then rule.
function groupByRule(findings) {
  const groups = []
  for (const finding of findings) {
    const last = groups[groups.length - 1]
    if (last?.ruleId === finding.ruleId) last.findings.push(finding)
    else groups.push({ ruleId: finding.ruleId, severity: finding.severity, findings: [finding] })
  }
  return groups
}

// How many occurrences a group lays out at once, and how many each "show more"
// adds. A rule that fires on every property of a large schema reaches four
// figures: rendering them all on expansion is what made the page unscrollable
// in the first place.
const OCCURRENCE_PAGE = 50

function ruleGroup(group) {
  const row = el('li', 'list-row items-start')
  row.dataset.ruleId = group.ruleId
  // A single occurrence has nothing to fold: its own message says more than the
  // rule's generic label ever could.
  row.append(
    el('span', SEVERITY_BADGE[group.severity], text(t(`audit.severity.${group.severity}`))),
    group.findings.length === 1 ? singleFinding(group.findings[0]) : foldedGroup(group),
  )
  return row
}

function singleFinding(finding) {
  const row = el(
    'div',
    'flex flex-col gap-1 min-w-0',
    el('p', 'text-sm', text(t(`audit.rule.${finding.ruleId}.message`, finding.params))),
    locationLine(finding),
    rationale(finding),
  )
  row.dataset.auditFinding = finding.ruleId
  return row
}

// The rationale is per rule, so folding hoists it out of the occurrences it was
// repeated in: the group states the defect once, and unfolds into where.
function foldedGroup(group) {
  const count = group.findings.length
  const label = t(`audit.rule.${group.ruleId}.label`)
  // The native marker is suppressed (`list-none`) because it sits outside the
  // flex row and drifts from the label: this one is a child of the row and
  // turns with the state, which is the only signal that a row opens at all.
  const chevron = icon(CHEVRON_RIGHT_SVG, 'contents')
  const summary = el(
    'summary',
    'text-sm cursor-pointer flex items-center gap-2 list-none',
    // The row no longer wraps — a wrapped line would strand the chevron on its
    // own — so the label is what gives way on a narrow screen.
    el('span', 'link link-hover min-w-0', text(label)),
    el('span', 'badge badge-sm badge-ghost font-mono', text(String(count))),
    chevron,
  )
  // The badge is a bare figure to the eye and an ambiguous one to a screen
  // reader: the accessible name says what it counts.
  summary.setAttribute('aria-label', `${label} — ${t('audit.group.occurrences', { n: count })}`)
  const list = el('div', 'flex flex-col gap-2 mt-2')
  const details = el(
    'details',
    'group min-w-0',
    summary,
    el('div', 'mt-1 flex flex-col gap-2', rationaleText(group.findings[0]), list),
  )
  // Occurrences are built on first expansion, then a page at a time: an
  // unopened group of two thousand costs nothing, and an opened one costs a
  // page.
  let rendered = 0
  const more = el('button', 'btn btn-xs btn-ghost self-start')
  more.type = 'button'
  more.dataset.auditMore = group.ruleId
  const showNext = () => {
    const next = group.findings.slice(rendered, rendered + OCCURRENCE_PAGE)
    list.append(...next.map(occurrenceRow))
    rendered += next.length
    const remaining = count - rendered
    more.replaceChildren(text(t('audit.group.showMore', { n: remaining })))
    more.classList.toggle('hidden', remaining === 0)
  }
  more.addEventListener('click', showNext)
  list.after(more)
  details.addEventListener('toggle', () => {
    if (details.open && !rendered) showNext()
  })
  return details
}

function occurrenceRow(finding) {
  const row = el(
    'div',
    'flex flex-col gap-0.5 min-w-0 border-s-2 border-base-300 ps-3',
    el('p', 'text-sm text-subtle', text(t(`audit.rule.${finding.ruleId}.message`, finding.params))),
    locationLine(finding),
  )
  row.dataset.auditFinding = finding.ruleId
  return row
}

// Three cases (docs/audit.md §3): a routable operation gets a link, a hidden one
// gets a badge instead of a dead link, and anything else is located by its
// JSON pointer into the document.
function locationLine(finding) {
  const line = el('div', 'flex flex-wrap items-center gap-2 text-xs min-w-0')
  if (finding.opRef) {
    const link = el('a', 'link link-primary font-mono', text(finding.location))
    link.href = opHash(finding.opRef)
    link.dataset.auditLink = finding.opRef
    line.append(link)
  } else {
    if (finding.location) line.append(el('span', 'font-mono text-subtle', text(finding.location)))
    if (finding.hidden) {
      line.append(el('span', 'badge badge-xs badge-ghost', text(t('audit.hidden'))))
    } else if (finding.dataPath) {
      const pointer = el(
        'code',
        'font-mono text-subtle break-all min-w-0',
        text(shortPointer(finding.dataPath)),
      )
      pointer.title = finding.dataPath
      line.append(pointer)
    }
  }
  return line.childNodes.length ? line : null
}

// A recursive schema yields pointers of several hundred characters whose middle
// repeats one segment over and over: three lines of noise burying the finding
// above them. Both ends are what locates it — the definition it starts from and
// the key it lands on — so the repetition is what gets cut. The full pointer
// stays in the title, and in the Markdown export, which is untouched.
const POINTER_MAX_SEGMENTS = 9
const POINTER_KEPT_TAIL = 4

function shortPointer(path) {
  const segments = path.split('/')
  if (segments.length <= POINTER_MAX_SEGMENTS) return path
  const head = segments.slice(0, POINTER_MAX_SEGMENTS - POINTER_KEPT_TAIL)
  const tail = segments.slice(-POINTER_KEPT_TAIL)
  return `${head.join('/')}/…/${tail.join('/')}`
}

// A lone finding keeps its rationale one click away, as the whole report used
// to: the row already reads on its own, and the "why" is the second question.
function rationale(finding) {
  return el(
    'details',
    '',
    el('summary', 'text-xs cursor-pointer link link-hover w-fit', text(t('audit.why'))),
    rationaleText(finding),
  )
}

// A folded group already cost a click to open, and its label is generic: the
// rationale is what makes it actionable, so it shows straight away rather than
// behind a second disclosure. A group passes its first finding — the two
// rationales that interpolate a finding's own value then name that one, which
// the occurrences listed right below make readable.
function rationaleText(finding) {
  return el('p', 'text-xs text-subtle', text(t(`audit.rule.${finding.ruleId}.why`, finding.params)))
}

function emptyState() {
  const alert = el(
    'div',
    'alert alert-success alert-soft',
    el(
      'div',
      'flex flex-col gap-1',
      el('span', 'font-bold', text(t('audit.empty.title'))),
      el('span', 'text-sm', text(t('audit.empty.hint'))),
    ),
  )
  alert.setAttribute('role', 'status')
  return alert
}

if (!customElements.get('audit-report')) customElements.define('audit-report', AuditReport)
