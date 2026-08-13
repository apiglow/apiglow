import { BUNDLED_CREDITS, PROJECT_LICENSE } from '../credits.js'
import { ARAZZO_VERSION } from '../export/arazzo.js'
import { t } from '../i18n/index.js'
import { SUPPORTED_OPENAPI_VERSIONS, SUPPORTED_SWAGGER_VERSIONS } from '../openapi/loader.js'
import { OVERLAY_VERSION } from '../openapi/overlay.js'
import { modalDismiss, openModal } from './a11y.js'
import { el, text } from './dom.js'
import { EXTERNAL_SVG_SM, SHIELD_SVG } from './icons.js'
import { searchShortcutLabel } from './search-palette.js'

// "About", opened from the footer: what this tool is, under which license it
// ships, and what open-source work it carries. A CDN install has no README and
// no LICENSE file next to it — this dialog is the only place those notices
// reach the people actually running the code, so it is a distribution
// obligation before it is a UI feature.
//
// Everything here describes the TOOL, never the documented API: the host's
// branding stops at the header (rule 10).

function externalLink(label, url) {
  const icon = el('span', 'inline-flex text-subtle')
  icon.innerHTML = EXTERNAL_SVG_SM
  icon.setAttribute('aria-hidden', 'true')
  const link = el('a', 'btn btn-xs btn-ghost gap-1.5', text(label), icon)
  link.href = url
  // New tab: the docs are a single-page app, and a click on "Report a bug"
  // that unloads a filled-in try-it panel loses work the reader never
  // agreed to lose.
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

function shortcutRow(keys, label) {
  return el(
    'div',
    'flex items-center gap-2',
    el('span', 'flex items-center gap-1', ...keys.map((key) => el('kbd', 'kbd kbd-xs', text(key)))),
    el('span', 'text-subtle', text(label)),
  )
}

class AboutDialog extends HTMLElement {
  #dialog = null
  #body = null
  #build = {}

  // Build-time identity injected by Vite from package.json (see vite.config.js)
  // and forwarded by the shell: `{ name, version, homepage, bugs }`. Not host
  // config — the host cannot rename or re-badge the tool crediting itself.
  set build(info) {
    this.#build = info ?? {}
  }

  open() {
    this.#renderBody()
    openModal(this.#dialog)
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({
      backdropLabel: t('about.close'),
      closeLabel: t('about.close'),
    })
    this.#body = el('div')
    this.#dialog = el(
      'dialog',
      'modal',
      el('div', 'modal-box max-w-lg', dismiss, this.#body),
      backdrop,
    )
    this.replaceChildren(this.#dialog)
  }

  #renderBody() {
    this.#body.replaceChildren(
      el(
        'div',
        'flex flex-col gap-5',
        this.#identity(),
        this.#facts(),
        this.#privacy(),
        this.#shortcuts(),
        this.#credits(),
      ),
    )
  }

  #identity() {
    const { name, version, homepage, bugs } = this.#build
    const links = el('div', 'flex flex-wrap items-center gap-1')
    if (homepage) links.append(externalLink(t('about.project'), homepage))
    if (bugs) links.append(externalLink(t('about.reportBug'), bugs))
    return el(
      'header',
      'flex flex-col gap-2 pe-8',
      el(
        'div',
        'flex items-baseline gap-2',
        el('h3', 'text-lg font-bold', text(name ?? '')),
        version ? el('span', 'badge badge-ghost badge-sm font-mono', text(`v${version}`)) : null,
      ),
      el('p', 'text-sm text-subtle', text(t('about.tagline'))),
      links.children.length ? links : null,
    )
  }

  // License and supported specs read as facts about the product, so they are a
  // definition list rather than prose: this is the part people come to copy
  // into a compliance ticket.
  #facts() {
    const openapi = SUPPORTED_OPENAPI_VERSIONS.map((v) => `${v}.x`).join(' · ')
    // Swagger 2.0 sits on the same line as the OpenAPI versions: from the
    // reader's side it is one promise ("this reads my document"), and how it is
    // kept — normalization or conversion — is our business, not theirs.
    const swagger = SUPPORTED_SWAGGER_VERSIONS.map((v) => `Swagger ${v}`).join(' · ')
    const rows = [
      [t('about.license'), `${PROJECT_LICENSE.spdx} — ${PROJECT_LICENSE.copyright}`],
      [t('about.supports'), `OpenAPI ${openapi} · ${swagger} · Overlay ${OVERLAY_VERSION}`],
      // Imports and exports are two separate promises: the formats a reader can
      // bring in are not the ones they can take away.
      [t('about.imports'), t('about.imports.list', { version: ARAZZO_VERSION })],
      [t('about.exports'), t('about.exports.list', { version: ARAZZO_VERSION })],
    ]
    const list = el('dl', 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs')
    for (const [label, value] of rows)
      list.append(el('dt', 'text-subtle whitespace-nowrap', text(label)), el('dd', '', text(value)))
    return list
  }

  // Stated in the About rather than buried in the docs: this tool sends the
  // reader's tokens to the API under test, and "where does that go" deserves an
  // answer the reader can find without trusting a marketing page.
  #privacy() {
    const icon = el('span', 'text-success')
    icon.innerHTML = SHIELD_SVG
    icon.setAttribute('aria-hidden', 'true')
    return el(
      'section',
      'flex gap-2 rounded-box border border-base-300 p-3',
      icon,
      el(
        'div',
        'flex flex-col gap-1',
        el('h4', 'font-bold text-sm', text(t('about.privacy.title'))),
        el('p', 'text-xs text-subtle', text(t('about.privacy'))),
      ),
    )
  }

  #shortcuts() {
    return el(
      'section',
      'flex flex-col gap-2',
      el('h4', 'font-bold text-sm', text(t('about.shortcuts.title'))),
      el(
        'div',
        'flex flex-wrap gap-x-6 gap-y-1 text-xs',
        shortcutRow(searchShortcutLabel().split(' '), t('about.shortcuts.search')),
        shortcutRow(['esc'], t('about.shortcuts.close')),
      ),
    )
  }

  #credits() {
    const items = BUNDLED_CREDITS.map((credit) => {
      const link = el('a', 'link link-hover font-medium', text(credit.name))
      link.href = credit.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      return el(
        'li',
        'flex flex-wrap items-baseline justify-between gap-x-3',
        el(
          'span',
          'min-w-0',
          link,
          el('span', 'text-subtle', text(` — ${t(`about.credit.${credit.id}`)}`)),
        ),
        el('span', 'font-mono text-subtle shrink-0', text(`${credit.version} · ${credit.license}`)),
      )
    })
    return el(
      'section',
      'flex flex-col gap-2',
      el('h4', 'font-bold text-sm', text(t('about.credits.title'))),
      el('p', 'text-xs text-subtle', text(t('about.credits.intro'))),
      el('ul', 'flex flex-col gap-1 text-xs', ...items),
    )
  }
}

if (!customElements.get('about-dialog')) customElements.define('about-dialog', AboutDialog)
