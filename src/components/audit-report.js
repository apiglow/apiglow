import { CATEGORIES, GRADES, gradeFor, LOWEST_GRADE } from '../audit/constants.js'
import { profileDetail, toAuditMarkdown } from '../export/audit-markdown.js'
import { currentLanguage, t } from '../i18n/index.js'
import { opHash } from '../router.js'
import { copyTextButton } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadAction, downloadsBar } from './download-action.js'
import {
  CALLOUT_TIP_SVG,
  CHECK_MARK_SVG_SM,
  CHEVRON_RIGHT_SVG,
  CHEVRON_SVG_SM,
  COPY_SVG_SM,
  JUMP_SVG,
} from './icons.js'

// Schema audit page (docs/audit.md §6), routed on #/audit. Renders the plain
// report `auditSchema` returns — the component never touches the schema itself,
// and every string it shows comes from the rule id plus the finding's params.

// Static class maps (rule 2): a `badge-${severity}` would be purged out of the
// built CSS.
const SEVERITY_BADGE = {
  error: 'badge badge-sm badge-soft badge-error',
  warning: 'badge badge-sm badge-soft badge-warning',
  info: 'badge badge-sm badge-soft badge-info',
}

// The same tag at the head of every finding row, one width for the three
// severities: the titles after it then start on one vertical line, which is
// what lets the eye run down a section. On a phone the tag sits above the
// title instead, which keeps the whole width for the text.
const ROW_BADGE = 'shrink-0 self-start sm:w-28 justify-center sm:mt-0.5'

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

// Figures as the reader's language writes them: 40 148, not 40148.
function figure(n) {
  return new Intl.NumberFormat(currentLanguage()).format(n)
}

class AuditReport extends HTMLElement {
  #report = null
  #download = null
  #progress = null
  // The schema's text, fetched once and only for a finding that quotes it.
  #source = null

  set report(report) {
    this.#report = report
    this.#progress = null
    if (this.isConnected) this.#render()
  }

  // The schema as served, from the shell — the only thing on this page the
  // report cannot produce on its own, since where the document came from is
  // host config (rule 10). Same descriptor as the home page's.
  set download(descriptor) {
    this.#download = descriptor
    this.#source = null
    if (this.isConnected && this.#report) this.#render()
  }

  // While the run is sliced over frames (app.js): its share done, in [0, 1].
  // Only the bar moves from one call to the next — the card around it is built
  // once, so the reader is not re-announced the same status every frame.
  set progress(share) {
    this.#progress = share
    if (!this.isConnected || this.#report) return
    const bar = this.querySelector('[data-audit-progress]')
    if (bar) bar.value = Math.round(share * 100)
    else this.#render()
  }

  connectedCallback() {
    this.classList.add('block', 'max-w-4xl', 'flex', 'flex-col', 'gap-6')
    if (this.#report || this.#progress !== null) this.#render()
  }

  #render() {
    const report = this.#report
    if (!report) {
      this.replaceChildren(pageHeader(null), loadingCard(this.#progress ?? 0))
      return
    }
    // Sections are built before the summary so its score bars can hold a
    // reference to the section they score — a category with no finding has no
    // section, and its bar must not offer to jump to one.
    const quote = (finding) => sourceExcerpt(finding, () => this.#text())
    const sections = new Map(
      report.counts.total
        ? report.categories
            .filter((c) => c.findings.length)
            .map((c) => [c.id, categorySection(c, quote)])
        : [],
    )
    this.replaceChildren(
      pageHeader(report),
      overviewCard(report, sections, this.#download),
      helpBlock(),
      ...(sections.size ? sections.values() : [emptyState()]),
    )
  }

  #text() {
    if (!this.#download?.load) return Promise.resolve(null)
    this.#source ??= this.#download.load().catch(() => null)
    return this.#source
  }
}

function pageHeader(report) {
  return el(
    'header',
    'flex flex-col gap-1',
    el(
      'div',
      'flex flex-wrap items-center justify-between gap-2',
      el('h1', 'text-2xl font-bold', text(t('audit.title'))),
      report ? copyButton(() => toAuditMarkdown(report)) : null,
    ),
    el('p', 'text-sm text-subtle', text(t('audit.intro'))),
  )
}

// The run takes half a second on the heaviest schema the demo carries, sliced
// so the page keeps answering: an empty page for that long reads as broken.
function loadingCard(share) {
  const bar = el('progress', 'progress progress-primary w-full')
  bar.max = 100
  bar.value = Math.round(share * 100)
  bar.dataset.auditProgress = ''
  bar.setAttribute('aria-label', t('audit.running'))
  const status = el(
    'p',
    'flex items-center gap-2 font-semibold',
    el('span', 'loading loading-spinner loading-sm text-primary'),
    text(t('audit.running')),
  )
  status.setAttribute('role', 'status')
  return el(
    'section',
    'rounded-box border border-base-300 p-6 flex flex-col gap-3',
    status,
    bar,
    el('p', 'text-xs text-subtle', text(t('audit.runningHint'))),
  )
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

// One card for what was graded and how it scored. What comes first is the
// verdict — the grade, then each category's bar — and the identity of the
// document heads it as a caption: an audit read out of context (a screenshot,
// a tab left open beside another) still says which API and which revision it
// graded, without that taking the first screen on a phone.
function overviewCard(report, sections, download) {
  return el(
    'section',
    'rounded-box border border-base-300 overflow-hidden',
    identityBlock(report, download),
    summaryBlock(report, sections),
  )
}

function identityBlock(report, download) {
  const { api, scope } = report
  const meta = [
    api.version ? t('audit.api.version', { version: api.version }) : null,
    report.openapi ? `OpenAPI ${report.openapi}` : null,
  ].filter(Boolean)
  const head = el(
    'div',
    'flex flex-wrap items-start justify-between gap-x-4 gap-y-2',
    el(
      'div',
      'flex flex-col gap-0.5 min-w-0',
      api.title ? el('h2', 'text-xl font-bold break-words', text(api.title)) : null,
      meta.length ? el('p', 'text-sm text-subtle font-mono', text(meta.join(' · '))) : null,
    ),
  )
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
    // heading row already spaces it.
    bar.classList.remove('mt-4')
    head.append(bar)
  }
  const block = el(
    'div',
    'flex flex-col gap-3 p-4 sm:p-5 bg-base-200/50 border-b border-base-300',
    head,
    contactLine(api),
    scopeFacts(scope),
  )
  block.dataset.auditIdentity = ''
  return block
}

// The perimeter, in figures — hidden operations included, which is exactly what
// makes it worth printing: the audit spans more than the rendered navigation.
// Every count is shown, zeros included: a nought here is the finding, not an
// empty slot (no security scheme, no group, no webhook are all things the
// report goes on to grade). A line of figures rather than the home page's
// tiles: here they caption the grade, they are not the page.
function scopeFacts(scope) {
  return el(
    'dl',
    'flex flex-wrap gap-x-6 gap-y-2',
    ...[
      ['operations', scope.operations],
      ['groups', scope.groups],
      ['webhooks', scope.webhooks],
      ['securitySchemes', scope.securitySchemes],
      ['schemas', scope.schemas],
    ].map(([key, value]) => {
      const fact = el(
        'div',
        'flex flex-col',
        el('dt', 'text-xs text-subtle', text(t(`welcome.${key}`))),
        el('dd', 'text-lg font-semibold tabular-nums leading-tight', text(figure(value))),
      )
      fact.dataset.auditFact = key
      return fact
    }),
  )
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
    classes: 'btn btn-sm btn-outline gap-1.5',
    label: () => [icon(COPY_SVG_SM, 'contents'), text(t('audit.copy'))],
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
      text(t(`audit.count.${severity}`, { n: figure(counts[severity]) })),
    ),
  )
}

// Grade, aggregate score, counts, then one bar per scored category — including
// the ones with no finding, whose 100 % is exactly what a reader wants to see.
// Side by side from a tablet up: the letter is read first, the bars explain it.
function summaryBlock(report, sections) {
  const counts = severityCounts(report.counts)
  const block = el(
    'div',
    'p-4 sm:p-5 grid gap-6 md:grid-cols-[auto_1fr] md:items-center',
    el(
      'div',
      'flex flex-col items-center gap-3 md:min-w-40',
      gradeDial(report),
      el(
        'div',
        'flex flex-wrap justify-center gap-1.5',
        ...(counts.length
          ? counts
          : [el('span', 'badge badge-sm badge-soft badge-success', text(t('audit.noFinding')))]),
      ),
    ),
    el(
      'div',
      'flex flex-col gap-3 min-w-0',
      profileNote(report.profile),
      // One grid for every bar: the bars start on one line whatever the length
      // of the category names before them.
      el(
        'div',
        'grid grid-cols-[auto_1fr_auto] gap-y-0.5',
        ...report.categories.map((category) => categoryBar(category, sections.get(category.id))),
      ),
    ),
  )
  block.dataset.auditSummary = ''
  return block
}

// The default ruleset always scores at least the readiness category (one
// unconditional check on the document); a configuration switching rules off
// can leave nothing to grade, and the dial then says so rather than invent a
// letter. The ring is the score, the letter its band.
function gradeDial(report) {
  const { grade, score } = report
  const dial = el(
    'div',
    `radial-progress ${grade ? GRADE_TEXT[grade] : 'text-base-300'}`,
    el(
      'span',
      'flex flex-col items-center leading-none',
      el('span', `text-5xl font-bold ${grade ? '' : 'text-subtle'}`, text(grade ?? '—')),
      el(
        'span',
        'text-xs text-subtle mt-1',
        text(grade ? t('audit.score', { score }) : t('audit.ungraded')),
      ),
    ),
  )
  dial.style.setProperty('--value', String(score ?? 0))
  dial.style.setProperty('--size', '7.5rem')
  dial.style.setProperty('--thickness', '0.5rem')
  dial.setAttribute('role', 'img')
  dial.setAttribute(
    'aria-label',
    grade ? `${grade} — ${t('audit.score', { score })}` : t('audit.ungraded'),
  )
  return dial
}

// A grade computed under a custom rule set is not the default grade: said next
// to it, so that a screenshot or a pasted report cannot pass one for the other.
function profileNote(profile) {
  if (!profile?.custom) return null
  const note = el(
    'p',
    'text-xs flex flex-wrap items-center gap-2',
    el('span', 'badge badge-sm badge-outline', text(t('audit.profile.custom'))),
    el('span', 'text-subtle', text(profileDetail(profile))),
  )
  note.dataset.auditProfile = ''
  return note
}

function categoryBar(category, section) {
  const label = t(`audit.category.${category.id}`)
  // <progress> alone announces a bare percentage: the label names which score it
  // is, and the visible figure next to it says the same thing to everyone else.
  const bar = el('progress', `${GRADE_PROGRESS[gradeFor(category.score)]} w-full min-w-16`)
  bar.value = category.score
  bar.max = 100
  bar.setAttribute('aria-label', t('audit.scoreOf', { category: label, score: category.score }))
  const score = el('span', 'font-mono text-xs text-subtle text-end', text(`${category.score} %`))
  // A row spans the three columns of the summary's grid and takes them over
  // (`subgrid`), so a whole row can be the jump while its cells stay aligned.
  const row = 'col-span-3 grid grid-cols-subgrid items-center gap-x-3 rounded-field px-2 py-1.5'
  if (!section) {
    return el(
      'div',
      row,
      el(
        'span',
        'flex items-center gap-1.5 text-sm',
        text(label),
        icon(CHECK_MARK_SVG_SM, 'contents text-success'),
      ),
      bar,
      score,
    )
  }
  return jumpToSection(row, label, category.id, section, bar, score)
}

// The summary's index role, made operable: on a long report the bars are the
// only way to reach a category without scrolling past the ones above it.
// A button rather than an `href="#…"` anchor — the app is hash-routed, and an
// in-page fragment would be read as a navigation.
//
// Two signals rather than one, because the bars that jump sit right next to
// bars that don't: a persistent link color and underline on the name
// (`link-primary`, not `link-hover`, which is indistinguishable from plain
// text until pointed at), and the arrow saying where the click goes. The
// whole row is the target. A category with nothing to jump to carries a check
// mark instead.
function jumpToSection(row, label, categoryId, section, bar, score) {
  const name = el(
    'span',
    'link link-primary flex items-center gap-1 text-sm w-fit',
    text(label),
    icon(JUMP_SVG, 'contents'),
  )
  const btn = el('button', `${row} text-left cursor-pointer hover:bg-base-200`, name, bar, score)
  btn.type = 'button'
  btn.dataset.auditJump = categoryId
  btn.setAttribute('aria-label', t('audit.jump', { category: label }))
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
function categorySection(category, quote) {
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
    'flex flex-col gap-3 scroll-mt-4',
    heading,
    el(
      'ul',
      'rounded-box border border-base-300 divide-y divide-base-300 overflow-hidden',
      ...groupByRule(category.findings).map((group) => ruleGroup(group, quote)),
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

function ruleGroup(group, quote) {
  const row = el('li', 'flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 px-4 py-3')
  row.dataset.ruleId = group.ruleId
  // A single occurrence has nothing to fold: its own message says more than the
  // rule's generic label ever could.
  row.append(
    el(
      'span',
      `${SEVERITY_BADGE[group.severity]} ${ROW_BADGE}`,
      text(t(`audit.severity.${group.severity}`)),
    ),
    group.findings.length === 1
      ? singleFinding(group.findings[0], quote)
      : foldedGroup(group, quote),
  )
  return row
}

function singleFinding(finding, quote) {
  const row = el(
    'div',
    'flex flex-col gap-1 min-w-0 flex-1',
    el('p', 'text-sm font-medium', text(t(`audit.rule.${finding.ruleId}.message`, finding.params))),
    locationLine(finding),
    quote(finding),
    rationale(finding),
  )
  row.dataset.auditFinding = finding.ruleId
  return row
}

// The rationale is per rule, so folding hoists it out of the occurrences it was
// repeated in: the group states the defect once, and unfolds into where.
function foldedGroup(group, quote) {
  const count = group.findings.length
  const label = t(`audit.rule.${group.ruleId}.label`)
  // The native marker is suppressed (`list-none`) because it sits outside the
  // flex row and drifts from the label: this one is a child of the row and
  // turns with the state, which is the only signal that a row opens at all.
  const chevron = icon(CHEVRON_RIGHT_SVG, 'contents')
  const summary = el(
    'summary',
    'text-sm font-medium cursor-pointer flex items-center gap-2 list-none',
    // The row no longer wraps — a wrapped line would strand the chevron on its
    // own — so the label is what gives way on a narrow screen.
    el('span', 'link link-hover min-w-0', text(label)),
    el('span', 'badge badge-sm badge-ghost font-mono', text(figure(count))),
    chevron,
  )
  // The badge is a bare figure to the eye and an ambiguous one to a screen
  // reader: the accessible name says what it counts.
  summary.setAttribute('aria-label', `${label} — ${t('audit.group.occurrences', { n: count })}`)
  const list = el('div', 'flex flex-col gap-2')
  const details = el(
    'details',
    'group min-w-0 flex-1',
    summary,
    el('div', 'mt-3 flex flex-col gap-3', rationaleText(group.findings[0]), list),
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
    list.append(...next.map((finding) => occurrenceRow(finding, quote)))
    rendered += next.length
    const remaining = count - rendered
    more.replaceChildren(text(t('audit.group.showMore', { n: figure(remaining) })))
    more.classList.toggle('hidden', remaining === 0)
  }
  more.addEventListener('click', showNext)
  list.after(more)
  details.addEventListener('toggle', () => {
    if (details.open && !rendered) showNext()
  })
  return details
}

// Where first, then what: in a folded group every occurrence breaks the same
// rule, and what tells them apart — the schema, the operation — is what the
// eye looks for.
function occurrenceRow(finding, quote) {
  const row = el(
    'div',
    'flex flex-col gap-0.5 min-w-0 border-s-2 border-base-300 ps-3 py-0.5',
    locationLine(finding),
    el('p', 'text-sm text-subtle', text(t(`audit.rule.${finding.ruleId}.message`, finding.params))),
    quote(finding),
  )
  row.dataset.auditFinding = finding.ruleId
  return row
}

// Three cases (docs/audit.md §3): a routable operation gets a link, a hidden one
// gets a badge instead of a dead link, and anything else is located by its
// JSON pointer into the document.
function locationLine(finding) {
  const line = el('div', 'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs min-w-0')
  if (finding.opRef) {
    // `py-1` is the 24 px of WCAG 2.5.8: the location sits alone on its line
    // rather than inside a sentence, so the inline exception does not cover it
    // and a bare `text-xs` link would be an 16 px target.
    const link = el('a', 'link link-primary font-mono py-1 break-all', text(finding.location))
    link.href = opHash(finding.opRef)
    link.dataset.auditLink = finding.opRef
    line.append(link)
  } else {
    if (finding.location) {
      line.append(el('span', 'font-mono font-medium break-all min-w-0', text(finding.location)))
    }
    if (finding.hidden) {
      line.append(el('span', 'badge badge-xs badge-ghost', text(t('audit.hidden'))))
    } else if (finding.dataPath) {
      const pointer = el(
        'code',
        'font-mono text-faint break-all min-w-0',
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
    'group/why flex flex-col gap-1',
    // Same 24 px as the location line above: a standalone disclosure, not text
    // in a sentence. The chevron is the folded groups' own, turned down: one
    // sign for "opens" across the page, where the native triangle was another.
    el(
      'summary',
      'text-xs cursor-pointer w-fit py-1 list-none flex items-center gap-1 text-subtle hover:text-base-content',
      el('span', 'link link-hover', text(t('audit.why'))),
      icon(
        CHEVRON_SVG_SM,
        'contents [&>svg]:transition-transform group-open/why:[&>svg]:rotate-180',
      ),
    ),
    rationaleText(finding),
  )
}

// A folded group already cost a click to open, and its label is generic: the
// rationale is what makes it actionable, so it shows straight away rather than
// behind a second disclosure. A group passes its first finding — the two
// rationales that interpolate a finding's own value then name that one, which
// the occurrences listed right below make readable. Why it matters, then what
// to do: the second line is the recipe, kept apart so it reads as one.
function rationaleText(finding) {
  const key = `audit.rule.${finding.ruleId}`
  return el(
    'div',
    'flex flex-col gap-2 text-xs rounded-box bg-base-200/60 p-3',
    el('p', 'text-subtle', text(t(`${key}.why`, finding.params))),
    el(
      'p',
      'flex gap-2',
      icon(CALLOUT_TIP_SVG, 'contents [&>svg]:size-4 text-success'),
      el(
        'span',
        '',
        el('span', 'font-semibold', text(`${t('audit.howToFix')} `)),
        text(t(`${key}.fix`, finding.params)),
      ),
    ),
  )
}

function emptyState() {
  const alert = el(
    'div',
    'alert alert-success alert-soft items-start',
    icon(CHECK_MARK_SVG_SM, 'contents [&>svg]:size-5'),
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

// What a reading problem points at, quoted from the file: the line before, the
// line itself with a caret under the column, the line after. A position alone
// sends the reader to an editor to find out what "line 12, column 7" holds;
// the excerpt usually says it at a glance. Filled once the text arrives (the
// download descriptor's, the browser's cached copy of the request the loader
// made); nothing is shown if it cannot be read.
const EXCERPT_CONTEXT = 1
const EXCERPT_WIDTH = 100

function sourceExcerpt(finding, loadText) {
  const { line, column } = finding.params ?? {}
  if (finding.ruleId !== 'document-syntax' || !Number.isInteger(line)) return null
  const slot = el('div', 'min-w-0')
  loadText().then((source) => {
    const lines = typeof source === 'string' ? source.split(/\r?\n/) : []
    if (line < 1 || line > lines.length) return
    const first = Math.max(1, line - EXCERPT_CONTEXT)
    const last = Math.min(lines.length, line + EXCERPT_CONTEXT)
    // A minified one-line JSON file holds the whole document on line 1: the
    // window moves to the column rather than quoting megabytes.
    const from = Math.max(0, (column ?? 1) - 1 - EXCERPT_WIDTH / 2)
    const cut = (textLine) => {
      const piece = textLine.slice(from, from + EXCERPT_WIDTH)
      return `${from ? '…' : ''}${piece}${textLine.length > from + EXCERPT_WIDTH ? '…' : ''}`
    }
    const code = el('div', 'mockup-code text-xs before:hidden pt-3 pb-3')
    for (let at = first; at <= last; at += 1) {
      const pre = el(
        'pre',
        at === line ? 'bg-error/25' : '',
        el('code', '', text(cut(lines[at - 1]))),
      )
      pre.dataset.prefix = String(at)
      code.append(pre)
      if (at === line && column) {
        // Spaces under the text before the column, tabs kept as tabs, so the
        // caret lands under the same character whatever the tab width.
        const lead = lines[at - 1].slice(from, column - 1).replace(/[^\t]/g, ' ')
        const caret = el('pre', 'text-error', el('code', '', text(`${from ? ' ' : ''}${lead}^`)))
        caret.dataset.prefix = ''
        code.append(caret)
      }
    }
    code.setAttribute('aria-label', t('audit.excerpt', { line }))
    code.setAttribute('role', 'group')
    slot.append(code)
  })
  return slot
}

if (!customElements.get('audit-report')) customElements.define('audit-report', AuditReport)
