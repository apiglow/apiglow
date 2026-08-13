import { t } from '../i18n/index.js'
import { opHash } from '../router.js'
import { modalDismiss, openModal } from './a11y.js'
import { el, text } from './dom.js'
import { methodBadgeClass } from './method-colors.js'

// Local schema changelog (competitive analysis, prio 2): modal listing the
// operations added / removed / changed since the last snapshot seen on
// this browser. onFirstOpen: "diff seen" — the shell replaces the
// stored snapshot there, only once; the modal stays viewable for the whole
// session.
class SchemaChangelog extends HTMLElement {
  #dialog = null
  #body = null
  #diff = null
  #acknowledged = false
  onFirstOpen = null

  // { added, removed, changed, oldVersion, newVersion, since } — lists
  // of operations { id, method, path, summary } produced by diffOperations.
  set diff(diff) {
    this.#diff = diff
  }

  open() {
    if (!this.#diff || !this.#dialog) return
    this.#renderBody()
    openModal(this.#dialog)
    if (!this.#acknowledged) {
      this.#acknowledged = true
      this.onFirstOpen?.()
    }
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({ backdropLabel: t('env.close') })
    this.#body = el('div')
    this.#dialog = el(
      'dialog',
      'modal',
      el('div', 'modal-box max-w-2xl', dismiss, this.#body),
      backdrop,
    )
    this.replaceChildren(this.#dialog)
  }

  #renderBody() {
    const diff = this.#diff
    const blocks = [el('h3', 'text-lg font-bold', text(t('changelog.title')))]
    if (diff.oldVersion !== diff.newVersion) {
      blocks.push(
        el(
          'div',
          'font-mono text-sm text-subtle',
          text(`${diff.oldVersion || '?'} → ${diff.newVersion || '?'}`),
        ),
      )
    }
    if (diff.since) {
      blocks.push(
        el(
          'p',
          'text-xs text-subtle',
          text(t('changelog.since', { date: new Date(diff.since).toLocaleString() })),
        ),
      )
    }
    const sections = [
      this.#section('changelog.added', 'status-success', diff.added, true),
      this.#section('changelog.removed', 'status-error', diff.removed, false),
      this.#section('changelog.changed', 'status-warning', diff.changed, true),
    ].filter(Boolean)
    // Case "version bump without operation change": the badge was
    // displayed for the version, the modal must explain the absence of lists.
    if (!sections.length) {
      const note = el(
        'div',
        'alert alert-info text-sm mt-3',
        el('span', '', text(t('changelog.versionOnly'))),
      )
      note.setAttribute('role', 'note')
      sections.push(note)
    }
    this.#body.replaceChildren(el('div', 'flex flex-col gap-2', ...blocks, ...sections))
  }

  // One section per kind of change: colored status badge + list.
  // Removed operations no longer exist in the doc — no link.
  #section(labelKey, statusClass, ops, linkable) {
    if (!ops.length) return null
    const rows = ops.map((op) => {
      const content = [
        el('span', methodBadgeClass(op.method), text(op.method)),
        el('span', 'truncate', text(op.summary || op.path)),
        op.summary ? el('code', 'font-mono text-xs text-subtle truncate', text(op.path)) : null,
      ]
      if (!linkable)
        return el('div', 'flex items-center gap-2 px-2 py-1 min-w-0 text-subtle', ...content)
      const link = el(
        'a',
        'flex items-center gap-2 px-2 py-1 min-w-0 rounded-field hover:bg-base-200',
        ...content,
      )
      link.href = opHash(op.id)
      link.addEventListener('click', () => this.#dialog.close())
      return link
    })
    return el(
      'section',
      'mt-2',
      el(
        'div',
        'flex items-center gap-2 mb-1',
        el('span', `status ${statusClass}`),
        el('h4', 'text-sm font-bold', text(`${t(labelKey)} (${ops.length})`)),
      ),
      ...rows,
    )
  }
}

if (!customElements.get('schema-changelog'))
  customElements.define('schema-changelog', SchemaChangelog)
