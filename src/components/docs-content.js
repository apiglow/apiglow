// DOM decoration of a rendered docs page (docs/docs-pages.md §4.2–4.3), run
// after sanitization: the markdown side (src/docs/markdown.js) produces plain
// HTML that already reads correctly, and these turn it into the app's own
// components. Splitting it this way is what keeps the fallback honest — a
// callout that isn't decorated is still a blockquote, a tab group that isn't
// decorated is still every snippet in order.
import { mayHoldVariables, segmentVariables } from '../docs/vars.js'
import { MASK } from '../export/redact.js'
import { t } from '../i18n/index.js'
import { readPref, writePref } from '../storage/prefs.js'
import { linkTabPanel, wireTablist } from './a11y.js'
import { hoverCopyButton } from './copy-button.js'
import { el, icon, text } from './dom.js'
import {
  CALLOUT_CAUTION_SVG,
  CALLOUT_IMPORTANT_SVG,
  CALLOUT_NOTE_SVG,
  CALLOUT_TIP_SVG,
  CALLOUT_WARNING_SVG,
} from './icons.js'

// Static map, never built from the type name (rule 2 — the JIT purge deletes
// what it cannot read). NOTE and IMPORTANT deliberately share a colour: the
// distinction the author drew is carried by the icon and the label.
const CALLOUT_ALERT = {
  NOTE: 'alert-info',
  TIP: 'alert-success',
  IMPORTANT: 'alert-info',
  WARNING: 'alert-warning',
  CAUTION: 'alert-error',
}

const CALLOUT_ICON = {
  NOTE: CALLOUT_NOTE_SVG,
  TIP: CALLOUT_TIP_SVG,
  IMPORTANT: CALLOUT_IMPORTANT_SVG,
  WARNING: CALLOUT_WARNING_SVG,
  CAUTION: CALLOUT_CAUTION_SVG,
}

const CALLOUT_MARKER = /^\s*\[!([A-Z]+)\]\s*/

// GFM alert syntax: `> [!NOTE]` on the first line of a blockquote. Chosen over
// `:::` containers because it degrades to a plain blockquote in any renderer
// and is what GitHub itself renders.
export function decorateCallouts(root) {
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild
    if (first?.tagName !== 'P') continue
    const match = CALLOUT_MARKER.exec(first.textContent ?? '')
    const type = match?.[1]
    if (!type || !CALLOUT_ALERT[type]) continue
    // The marker is consumed, whatever followed it on the same line is kept:
    // `> [!NOTE] Read this first` is a one-line callout.
    first.textContent = (first.textContent ?? '').replace(CALLOUT_MARKER, '')
    if (!first.textContent.trim()) first.remove()

    const body = el('div', 'min-w-0')
    body.append(...quote.childNodes)
    const callout = el(
      'div',
      `alert ${CALLOUT_ALERT[type]} alert-soft md-callout items-start gap-3 my-3`,
      icon(CALLOUT_ICON[type]),
      el(
        'div',
        'min-w-0',
        el('p', 'font-semibold', text(t(`page.callout.${type.toLowerCase()}`))),
        body,
      ),
    )
    // No role="alert": static prose, not a live region — announcing it would
    // interrupt the reader for something they are about to read anyway.
    quote.replaceWith(callout)
  }
}

// A standalone fenced block gets a header naming its language and holding a
// copy button — a tab group already has a bar (its tablist), so its panels are
// skipped rather than given a second one. The label is the fence's language
// token as written; there is nothing to translate in it.
export function decorateCodeHeaders(root) {
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.closest('[data-code-tabs]')) continue
    const code = pre.querySelector(':scope > code')
    if (!code) continue
    const lang = [...code.classList]
      .find((cls) => cls.startsWith('language-'))
      ?.slice('language-'.length)
    // `group` feeds the copy button's hover reveal (see .api-hover-reveal).
    const wrapper = el('div', 'md-code group')
    pre.replaceWith(wrapper)
    wrapper.append(
      el(
        'div',
        'md-code-header',
        el('span', 'md-code-lang', text(lang ?? '')),
        // Read at click time, never captured: interpolation (§12) runs after
        // this decoration, and what the reader copies has to be what they see.
        hoverCopyButton(() => plainText(code), t('page.copyCode')),
      ),
      pre,
    )
  }
}

// The plain text a rendered subtree STANDS FOR — which `textContent` stops
// being the moment a chip replaces a variable: a masked one holds `••••` and a
// missing one the bare name, and neither reads as anything on its own. A chip
// declares its text in `data-copy-text` and this walk takes it instead of
// descending into it (§12.1 — a snippet must paste runnable, a secret must not
// paste at all). Every surface that quotes page text goes through here — the
// fence copy button and the table of contents alike — or they disagree.
export function plainText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  if (node.dataset.copyText !== undefined) return node.dataset.copyText
  let out = ''
  for (const child of node.childNodes) out += plainText(child)
  return out
}

// The chosen language, shared by every group on every page (§4.3). One
// localStorage key, one value, no growth — rule 13's policy for this dataset
// is a hard cap of one.
const CODE_LANG_KEY = 'code-lang'

// Adjacent fences became a `.code-tabs` container upstream; here it becomes a
// real tablist. Groups register together so that picking "Python" in one moves
// every other group that has a Python tab — the Slate/Docusaurus behavior.
export function decorateCodeTabs(root) {
  const groups = []
  for (const container of root.querySelectorAll('[data-code-tabs]')) {
    const group = buildTabGroup(container, (lang) => {
      writePref(CODE_LANG_KEY, lang)
      for (const other of groups) other.select(lang)
    })
    if (group) groups.push(group)
  }
  const preferred = readPref(CODE_LANG_KEY)
  for (const group of groups) group.select(preferred)
}

function buildTabGroup(container, onPick) {
  const panels = [...container.querySelectorAll(':scope > pre')]
  if (panels.length < 2) return null
  const langs = panels.map((panel) => panel.dataset.tabLang || panel.dataset.tabLabel || '')
  const tablist = el('div', 'tabs tabs-box tabs-sm w-fit max-w-full overflow-x-auto')
  tablist.setAttribute('role', 'tablist')
  tablist.setAttribute('aria-label', t('page.codeTabs'))
  const tabs = panels.map((panel) => {
    const tab = el('button', 'tab', text(panel.dataset.tabLabel || ''))
    tab.type = 'button'
    return tab
  })
  tablist.append(...tabs)
  for (const panel of panels) linkTabPanel(tabs, panel)

  // One state transition: the visual switch and the ARIA/tabindex side always
  // move together, so they are never two calls a third caller could half-make.
  const show = (index) => {
    tabs.forEach((tab, i) => {
      tab.classList.toggle('tab-active', i === index)
    })
    panels.forEach((panel, i) => {
      panel.classList.toggle('hidden', i !== index)
    })
    activate(index)
  }
  const activate = wireTablist(tablist, tabs, (index) => {
    show(index)
    onPick(langs[index])
  })
  container.classList.add('flex', 'flex-col', 'gap-1', 'my-3')
  container.prepend(tablist)

  // A preference nobody's group offers leaves that group on its first tab:
  // the user asked for Python, this snippet only exists in cURL, and showing
  // nothing would be worse than showing the one thing there is.
  return { select: (lang) => show(Math.max(0, langs.indexOf(lang))) }
}

// --- Variable interpolation (§12) ------------------------------------------

// Post-sanitize, post-highlight walk over the text nodes of a rendered page:
// headings, prose, code spans and fences alike. Late on purpose — a value is
// inserted as a TEXT NODE, so a base URL full of underscores can never become
// emphasis, and no value can shift the structure the author wrote.
//
// Returns the undo. The caller re-walks by restoring first: the pristine text
// nodes come back untouched, so the second walk sees exactly what the first
// one did instead of chewing on its own output.
export function interpolateVariables(root, { variables = {}, onManageEnv = null } = {}) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (mayHoldVariables(node.nodeValue)) targets.push(node)
  }
  const replaced = targets.map((node) => {
    const segments = segmentVariables(node.nodeValue, variables)
    const replacements = segments.map((segment) => segmentNode(segment, onManageEnv))
    node.replaceWith(...replacements)
    return { node, replacements }
  })
  return () => {
    for (const { node, replacements } of replaced) {
      replacements[0].replaceWith(node)
      for (let i = 1; i < replacements.length; i++) replacements[i].remove()
    }
  }
}

function segmentNode(segment, onManageEnv) {
  if (segment.kind === 'value') return text(segment.value)
  if (segment.kind === 'masked') return maskedChip(segment.name)
  if (segment.kind === 'missing') return missingChip(segment.name, onManageEnv)
  return text(segment.text)
}

// What every chip owes, whatever state it shows: a name, a label, and the text
// it stands for. Stated once, because `plainText` and the e2e selectors read
// this contract and a state that forgot half of it would still look right.
function varChip(chip, name, labelKey) {
  chip.setAttribute('aria-label', t(labelKey, { name }))
  // `{{name}}` and not the name alone: a chip stands for a template the reader
  // has to fill in themselves, and pasting the bare name would look resolved.
  chip.dataset.copyText = `{{${name}}}`
  chip.dataset.varName = name
  // `role="img"` carries the whole i18n'd name: `aria-label` on a bare <span>
  // is an ARIA violation in its own right, and the sweep would say so. A
  // button takes its label natively.
  if (chip.tagName !== 'BUTTON') chip.setAttribute('role', 'img')
  return chip
}

// The value never reaches the DOM (§12.1), so there is nothing to redact —
// which is also why the dots are decoration and the name is what shows.
function maskedChip(name) {
  return varChip(
    el(
      'span',
      'md-var md-var-masked',
      el('span', '', text(name)),
      el('span', 'md-var-dots text-faint', text(MASK)),
    ),
    name,
    'page.vars.masked',
  )
}

// A real button, because "define it" is the only next step and the environment
// manager is where it happens. Without a manager — `environmentsLocked` — the
// signal stays, the offer goes: a button that leads nowhere is worse than
// none.
function missingChip(name, onManageEnv) {
  const chip = el(onManageEnv ? 'button' : 'span', 'md-var md-var-missing', text(name))
  chip.dataset.varMissing = ''
  if (onManageEnv) {
    chip.type = 'button'
    chip.addEventListener('click', () => onManageEnv())
  }
  return varChip(chip, name, onManageEnv ? 'page.vars.missing' : 'page.vars.missingLocked')
}
