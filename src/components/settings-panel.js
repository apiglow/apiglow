import { t } from '../i18n/index.js'
import {
  checkUserOverlay,
  clearUserOverlay,
  formatUserOverlay,
  parseUserOverlay,
  readUserOverlay,
  saveUserOverlay,
  USER_OVERLAY_INVALID_JSON,
  USER_OVERLAY_MAX_BYTES,
  USER_OVERLAY_SKELETON,
  userOverlayFilename,
  userOverlayOrigin,
} from '../openapi/user-overlay.js'
import { auditHash } from '../router.js'
import { eraseEverything, storageInventory } from '../storage/maintenance.js'
import { announce, modalDismiss, openModal } from './a11y.js'
import { copyTextButton } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadText } from './download.js'
import { CHECK_SVG_SM_BOLD } from './icons.js'
import { markdownInline } from './markdown.js'

// Technical/maintenance drawer, deliberately kept out of the reading path: a
// gear at the end of the toolbar, nothing in the nav. What lives here is what
// the doc itself never needs — what this browser has stored, and how to hand it
// back. Everything it can erase is declared in `storage/maintenance.js`; this
// file only renders and confirms.
//
// Scope note that the UI states explicitly: purges are installation-wide, not
// scoped to the active spec. A half-cleared multi-spec install is a support
// case nobody can reason about.

// Browser quotas run to several GB: a figure in MB there is a wall of digits
// nobody reads back in a bug report.
const BYTE_UNITS = [
  ['GB', 1024 ** 3],
  ['MB', 1024 ** 2],
]

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null
  for (const [unit, size] of BYTE_UNITS) {
    if (bytes >= size) return `${(bytes / size).toFixed(1)} ${unit}`
  }
  // Floored at 1 KB: "0 KB" next to a non-empty inventory reads as a bug.
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// The overlay counter runs against a 64 KB cap and starts on a document of a few
// hundred bytes: the KB floor above would freeze it at "1 KB" over the whole
// range a workaround actually occupies.
function formatSmallBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : formatBytes(bytes)
}

class SettingsPanel extends HTMLElement {
  #dialog = null
  #body = null
  #inventory = []
  #diagnostics = {}
  #counts = new Map()
  #audit = false
  #source = null
  #overlayFromHost = false

  // `{ history, scenarios }` — the two stores the shell owns. Everything else
  // the inventory touches is module-level (snapshots) or localStorage.
  set stores(stores) {
    this.#inventory = storageInventory(stores)
  }

  // Derived values only (rule 10): the shell resolves the host config, this
  // component never sees it.
  set diagnostics(info) {
    this.#diagnostics = info ?? {}
  }

  // Schema audit (docs/audit.md §6): this panel is the feature's ONLY entry
  // point — deliberately the least prominent place in the UI, since the audit
  // addresses the API's author, not the reader of its docs.
  set audit(enabled) {
    this.#audit = enabled === true
  }

  // The parsed schema as the app loaded it — the only thing here that is not a
  // derived value, and the exception rule 6 does not cover: the user overlay's
  // dry run has nothing to check against but the raw document its targets
  // address. A thunk resolved at check time: the raw document is rebuilt
  // lazily by the loader, and this panel must not force it at boot.
  set schemaSource(source) {
    this.#source = source ?? null
  }

  // `focus` names the section the opener promised — today the header badge,
  // which says "patched schema" and must land on the editor rather than at the
  // top of a panel whose first screen is about something else.
  open({ focus = null } = {}) {
    this.#renderBody()
    openModal(this.#dialog, {
      focus: focus === 'user-overlay' ? this.#body.querySelector('[data-user-overlay]') : null,
    })
    this.#refreshCounts()
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({ backdropLabel: t('settings.close') })
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
    // Whose document sits in the reader's overlay slot (decision 11), read once
    // for the three places that say it. Read here rather than taken from the
    // load-time diagnostics: the panel is rebuilt after a save, and the origin
    // flips on that very save.
    this.#overlayFromHost = userOverlayOrigin() === 'host'
    this.#body.replaceChildren(
      el(
        'div',
        'flex flex-col gap-6',
        el(
          'header',
          'flex flex-col gap-1 pe-8',
          el('h3', 'text-lg font-bold', text(t('settings.title'))),
          el('p', 'text-sm text-subtle', text(t('settings.intro'))),
        ),
        this.#auditSection(),
        this.#storageSection(),
        this.#diagnosticsSection(),
        this.#userOverlaySection(),
        this.#dangerSection(),
      ),
    )
  }

  // --- schema audit -----------------------------------------------------

  // No grade shown here on purpose: displaying one would force the report to be
  // computed every time the panel opens, and the panel must stay cheap to open.
  #auditSection() {
    if (!this.#audit) return null
    const button = el('button', 'btn btn-sm btn-outline self-start', text(t('audit.open')))
    button.type = 'button'
    button.dataset.auditOpen = ''
    button.addEventListener('click', () => {
      this.#dialog.close()
      window.location.hash = auditHash()
    })
    return el(
      'section',
      'flex flex-col gap-2',
      el('h4', 'font-bold text-sm', text(t('audit.title'))),
      el('p', 'text-xs text-subtle', text(t('audit.settings.hint'))),
      button,
    )
  }

  // --- stored data ------------------------------------------------------

  #storageSection() {
    const rows = this.#inventory.map((row) => this.#storageRow(row))
    return el(
      'section',
      'flex flex-col gap-2',
      el('h4', 'font-bold text-sm', text(t('settings.storage.title'))),
      el('p', 'text-xs text-subtle', text(t('settings.storage.scope'))),
      el(
        'ul',
        'flex flex-col divide-y divide-base-300 border border-base-300 rounded-box',
        ...rows,
      ),
    )
  }

  #storageRow(row) {
    const count = el('span', 'badge badge-ghost badge-sm font-mono shrink-0', text('…'))
    count.dataset.countFor = row.id
    const button = el('button', 'btn btn-xs btn-outline btn-error', text(t('settings.clear')))
    button.type = 'button'
    // Disabled until the count lands: offering to clear a dataset before
    // knowing whether it holds anything invites a pointless confirmation.
    button.disabled = true
    const action = confirmable(button, {
      onConfirm: () => this.#runClear(row),
      confirmLabel: t('settings.confirm'),
      cancelLabel: t('settings.cancel'),
    })
    const item = el(
      'li',
      'flex items-center gap-3 px-3 py-2',
      el(
        'div',
        'min-w-0 flex-1',
        el(
          'div',
          'flex items-center gap-2',
          el('span', 'text-sm font-medium', text(t(`settings.data.${row.id}`))),
          count,
        ),
        el('p', 'text-xs text-subtle', text(t(`settings.data.${row.id}.hint`))),
      ),
      action,
    )
    item.dataset.dataset = row.id
    return item
  }

  async #refreshCounts() {
    await Promise.all(
      this.#inventory.map(async (row) => {
        let value = 0
        try {
          value = (await row.count()) ?? 0
        } catch (err) {
          console.error('[api-doc] settings: count failed for', row.id, err)
        }
        this.#counts.set(row.id, value)
        this.#applyCount(row.id, value)
      }),
    )
    this.#refreshEstimate()
  }

  // Targeted at the row rather than a re-render: the user may already be
  // mid-confirmation on another row, and rebuilding the list would cancel it.
  #applyCount(id, value) {
    const badge = this.#body.querySelector(`[data-count-for="${id}"]`)
    if (badge) badge.textContent = String(value)
    const button = this.#body.querySelector(`[data-dataset="${id}"] button`)
    if (button) button.disabled = value === 0
  }

  async #runClear(row) {
    try {
      await row.clear()
    } catch (err) {
      console.error('[api-doc] settings: clear failed for', row.id, err)
      announce(t('settings.clearError'))
      return
    }
    announce(t('settings.cleared', { data: t(`settings.data.${row.id}`) }))
    if (row.reload) {
      window.location.reload()
      return
    }
    this.#counts.set(row.id, 0)
    this.#applyCount(row.id, 0)
    this.#refreshEstimate()
  }

  // --- diagnostics ------------------------------------------------------

  #diagnosticsSection() {
    const list = el('dl', 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs')
    for (const [label, value] of this.#diagnosticLines()) {
      list.append(
        el('dt', 'text-subtle whitespace-nowrap', text(label)),
        el('dd', 'font-mono break-all', text(value)),
      )
    }
    const estimate = el('dd', 'font-mono break-all', text('…'))
    estimate.dataset.storageEstimate = ''
    list.append(
      el('dt', 'text-subtle whitespace-nowrap', text(t('settings.diag.storage'))),
      estimate,
    )

    const copy = copyTextButton({
      classes: 'btn btn-xs btn-ghost self-start shrink-0',
      label: t('export.copy'),
      getText: () => this.#diagnosticsText(),
      successClass: 'text-success',
    })

    return el(
      'section',
      'flex flex-col gap-2',
      // The copy sits on the heading rather than under the last block: trailing
      // the overlay lists, it read as "copy the overlays" — it takes the whole
      // section, and the section is what a bug report needs.
      el(
        'div',
        'flex items-center justify-between gap-2',
        el(
          'div',
          'flex flex-col gap-1',
          el('h4', 'font-bold text-sm', text(t('settings.diag.title'))),
          el('p', 'text-xs text-subtle', text(t('settings.diag.hint'))),
        ),
        copy,
      ),
      list,
      this.#overlayInfos(),
      this.#overlayWarnings(),
    )
  }

  // Overlay 1.1's `info.description`: what an overlay is *for*, which the
  // count of applied actions never says. External CommonMark, so it renders
  // through the sanitizing helper like every other authored description.
  // Built like `#overlayWarnings` below — same label-plus-framed-list shape, so
  // the two blocks of the same section read as one thing. The title, the tag
  // and the description each own a line of their own: run together inline, an
  // overlay named "Local fixes" and a sentence starting with "Why" read as one
  // broken phrase.
  #overlayInfos() {
    const infos = this.#diagnostics.overlays?.infos ?? []
    if (!infos.length) return null
    return el(
      'div',
      'flex flex-col gap-1.5',
      el('span', 'text-xs font-bold text-subtle', text(t('settings.diag.overlayInfo'))),
      el(
        'ul',
        'flex flex-col divide-y divide-base-300 border border-base-300 rounded-box',
        ...infos.map((info) =>
          el(
            'li',
            'flex flex-col gap-1 px-3 py-2',
            el(
              'div',
              'flex flex-wrap items-center gap-2',
              // The application order, which the "Local patch" line above names
              // to point at one of these entries.
              el('span', 'badge badge-xs badge-ghost font-mono shrink-0', text(info.overlay)),
              // `info.title` is required by the spec, but an overlay that omits
              // it still has to be nameable: the panel lists several of them.
              el(
                'span',
                'text-sm font-medium',
                text(info.title || t('settings.diag.overlayInfoUntitled', info)),
              ),
              this.#userOverlayTag(info.overlay),
            ),
            info.description
              ? el('div', 'text-xs text-subtle', markdownInline(info.description))
              : null,
          ),
        ),
      ),
    )
  }

  // An overlay that could not be applied has nowhere else to be seen: it edits
  // the schema before anything renders, so its failure looks exactly like a
  // schema that never said what the integrator thinks it says.
  //
  // Tinted frame rather than daisyUI's `alert`: the alert lays its children out
  // in a grid column, so a label followed by a list of failures came out as one
  // run-on line — and the warning color belongs on the label, not on message
  // text that has to stay readable.
  #overlayWarnings() {
    const warnings = this.#diagnostics.overlays?.warnings ?? []
    if (!warnings.length) return null
    return el(
      'div',
      'flex flex-col gap-1.5',
      el('span', 'text-xs font-bold text-warning', text(t('settings.diag.overlayWarnings'))),
      el(
        'ul',
        'flex flex-col divide-y divide-warning/20 border border-warning/40 bg-warning/5 rounded-box',
        ...warnings.map((warning) =>
          el(
            'li',
            'flex flex-wrap items-center gap-2 px-3 py-2',
            el('span', 'text-xs break-words', text(overlayWarningText(warning))),
            this.#userOverlayTag(warning.overlay),
          ),
        ),
      ),
    )
  }

  // Which of the listed overlays is the user's own (decision 3): the block
  // lists it exactly like the host's, so without this it reads as one more
  // thing the integrator declared — and the one overlay the reader can fix
  // themselves would be the one they cannot recognize.
  //
  // Same slot, two owners (decision 11): until the reader saves an edit, what
  // sits there is the patch the installation handed them, and the tag says so
  // rather than crediting them with it.
  #userOverlayTag(index) {
    const user = this.#diagnostics.overlays?.user
    if (!user || index !== user) return null
    const fromHost = this.#overlayFromHost
    return el(
      'span',
      `badge badge-xs shrink-0 ${fromHost ? 'badge-info' : 'badge-warning'}`,
      text(t(fromHost ? 'settings.diag.hostOverlayTag' : 'settings.diag.userOverlayTag')),
    )
  }

  // Only the fields that exist: an empty "Spec" line in a single-spec install
  // reads as a bug in the panel.
  #diagnosticLines() {
    const info = this.#diagnostics
    const lines = [
      [t('settings.diag.app'), info.appVersion || '—'],
      [t('settings.diag.api'), info.apiVersion || '—'],
      [t('settings.diag.openapi'), info.openapiVersion || '—'],
      [t('settings.diag.schema'), info.schemaUrl || '—'],
    ]
    // A converted document (Swagger 2.0) reports the conversion's target
    // version above: without this line the two numbers would be unexplainable.
    if (info.convertedFrom) {
      lines.splice(3, 0, [t('settings.diag.converted'), `Swagger ${info.convertedFrom}`])
    }
    if (info.overlays?.count) {
      lines.push([
        t('settings.diag.overlays'),
        t('settings.diag.overlayApplied', {
          count: info.overlays.count,
          actions: info.overlays.actions,
        }),
      ])
    }
    // Named on its own line rather than folded into the count above: a bug
    // report written from a locally patched schema has to say so, and its index
    // is what ties it to the entries the two blocks below mark as the user's.
    if (info.overlays?.user) {
      lines.push([
        t('settings.diag.userOverlay'),
        t(
          this.#overlayFromHost
            ? 'settings.diag.hostOverlayActive'
            : 'settings.diag.userOverlayActive',
          { overlay: info.overlays.user },
        ),
      ])
    }
    if (info.specId) lines.push([t('settings.diag.spec'), info.specId])
    lines.push(
      [t('settings.diag.theme'), document.documentElement.dataset.theme || '—'],
      [t('settings.diag.language'), document.documentElement.lang || '—'],
    )
    return lines
  }

  async #refreshEstimate() {
    const target = this.#body?.querySelector('[data-storage-estimate]')
    if (!target) return
    target.textContent = (await storageEstimate()) ?? t('settings.diag.unavailable')
  }

  // Plain text on purpose: this is pasted into an issue, not re-parsed.
  #diagnosticsText() {
    const lines = this.#diagnosticLines().map(([label, value]) => `${label}: ${value}`)
    for (const warning of this.#diagnostics.overlays?.warnings ?? []) {
      lines.push(`${t('settings.diag.overlayWarnings')}: ${overlayWarningText(warning)}`)
    }
    // The inventory's own order, rather than a second list of ids to keep in
    // step with it; the label key follows the id.
    for (const { id } of this.#inventory)
      lines.push(`${t(`settings.data.${id}`)}: ${this.#counts.get(id) ?? 0}`)
    lines.push(`UA: ${navigator.userAgent}`)
    return lines.join('\n')
  }

  // --- user overlay -----------------------------------------------------
  //
  // docs/user-overlay.md. Placed right under the diagnostics: the warnings this
  // editor produces are the ones the block above lists once the document is
  // applied, so the two read as one conversation about the same schema.

  #userOverlaySection() {
    const stored = readUserOverlay()
    const fromHost = this.#overlayFromHost
    const editor = el(
      'textarea',
      'block w-full h-48 p-3 bg-base-100 font-mono text-xs resize-y outline-none',
    )
    // An empty editor teaches nothing: the seed shows the shape of a document
    // whose example action is inert until moved into `actions`.
    editor.value = stored ? formatUserOverlay(stored) : USER_OVERLAY_SKELETON
    // The badge opens this panel focused here, and focusing a textarea puts the
    // caret at the end: without this, the one entry point to the editor lands
    // the reader in the middle of their own JSON.
    editor.setSelectionRange(0, 0)
    editor.spellcheck = false
    editor.dataset.userOverlay = ''
    editor.setAttribute('aria-label', t('userOverlay.editor'))

    const report = el('div', 'flex flex-col gap-1 text-xs')
    report.dataset.userOverlayReport = ''
    this.#reportIdle(report)

    const check = el('button', 'btn btn-sm btn-outline', text(t('userOverlay.check')))
    check.type = 'button'
    check.dataset.userOverlayCheck = ''
    check.addEventListener('click', () => this.#runCheck(editor.value, report))

    const save = el('button', 'btn btn-sm btn-primary', text(t('userOverlay.save')))
    save.type = 'button'
    save.dataset.userOverlaySave = ''
    save.addEventListener('click', () => this.#runSave(editor.value, report))

    // The exit (decision 8), offered on what is typed rather than on what is
    // stored: the file worth handing upstream is often the one being written,
    // and a download that silently emitted the last save would be a different
    // document than the one on screen.
    const download = el('button', 'btn btn-sm btn-ghost', text(t('userOverlay.download')))
    download.type = 'button'
    download.dataset.userOverlayDownload = ''
    download.addEventListener('click', () => this.#runDownload(editor.value))

    // What the frame's header says about what is typed: the weight against the
    // cap, or why the download is greyed out. A disabled button that never says
    // what it is waiting for is the panel's own version of a silent failure.
    const state = el('span', '')
    const syncState = () => {
      const parsed = parseUserOverlay(editor.value)
      download.disabled = !parsed.ok
      if (!parsed.ok) {
        state.className = 'badge badge-xs badge-error badge-soft shrink-0'
        state.replaceChildren(
          text(
            parsed.code === USER_OVERLAY_INVALID_JSON
              ? t('userOverlay.notJson')
              : t('userOverlay.notOverlay'),
          ),
        )
        state.removeAttribute('title')
        return
      }
      // Measured on the serialized document, like the cap the save enforces —
      // the editor's own indentation is not what gets stored.
      const bytes = new TextEncoder().encode(JSON.stringify(parsed.document)).length
      const max = formatBytes(USER_OVERLAY_MAX_BYTES)
      state.className =
        bytes > USER_OVERLAY_MAX_BYTES
          ? 'font-mono text-xs text-error shrink-0'
          : 'font-mono text-xs text-subtle shrink-0'
      state.replaceChildren(text(`${formatSmallBytes(bytes)} / ${max}`))
      state.title = t('userOverlay.sizeLabel', { max })
    }
    syncState()
    editor.addEventListener('input', () => {
      syncState()
      // A verdict stops being about the document on screen the moment it is
      // edited: keeping it there would let a stale "would apply" outlive the
      // action it described.
      this.#reportIdle(report)
    })

    const actions = el(
      'div',
      'flex flex-wrap items-center gap-2 px-3 py-2 border-t border-base-300 bg-base-200',
      check,
      save,
      download,
    )
    // Offered only when there is something to remove — the one destructive
    // action of this section, and a confirm on an empty store is a riddle. Kept
    // at the far end of the bar: it is the only button here that ends the
    // patch, and it sat next to the download that saves it.
    if (stored) {
      const clear = el('button', 'btn btn-sm btn-outline btn-error', text(t('userOverlay.clear')))
      clear.type = 'button'
      clear.dataset.userOverlayClear = ''
      const cell = confirmable(clear, {
        onConfirm: () => this.#runClearOverlay(),
        confirmLabel: t('settings.confirm'),
        cancelLabel: t('settings.cancel'),
        className: 'btn btn-sm',
      })
      cell.classList.add('ms-auto')
      actions.append(cell)
    }

    // The document as a file rather than as a field: the frame carries the name
    // the download will bear, which is also what says the patch is scoped to
    // this spec and not to the whole install.
    const frame = el(
      'div',
      // The frame carries the focus ring the textarea gave up when it lost its
      // own border: the editor fills the box edge to edge, so an outline on it
      // would be drawn under the header and the action bar.
      'rounded-box border border-base-300 overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
      el(
        'div',
        'flex items-center justify-between gap-2 px-3 py-1.5 border-b border-base-300 bg-base-200',
        el(
          'span',
          'font-mono text-xs text-subtle truncate',
          text(userOverlayFilename(this.#diagnostics.specId)),
        ),
        state,
      ),
      editor,
      actions,
    )

    return el(
      'section',
      'flex flex-col gap-2',
      el(
        'div',
        'flex items-center justify-between gap-2',
        el('h4', 'font-bold text-sm', text(t('userOverlay.title'))),
        // Whether a patch is active cannot be read off the editor: the textarea
        // holds the seeded skeleton and a stored document alike.
        stored
          ? el(
              'span',
              `badge badge-sm badge-soft ${fromHost ? 'badge-info' : 'badge-warning'}`,
              text(t(fromHost ? 'userOverlay.stateHost' : 'userOverlay.stateOn')),
            )
          : el('span', 'badge badge-sm badge-ghost', text(t('userOverlay.stateOff'))),
      ),
      el('p', 'text-xs text-subtle', text(t('userOverlay.hint'))),
      // Said once, where the document is: a patch nobody in this browser typed
      // is exactly the thing a reader needs told, and the two ways out of it —
      // edit, or remove — are the buttons right below.
      fromHost ? el('p', 'text-xs text-info', text(t('userOverlay.fromHost'))) : null,
      frame,
      report,
    )
  }

  // The report's resting state: what Check is for, said where its result will
  // land, rather than an empty strip under the buttons.
  #reportIdle(report) {
    report.replaceChildren(el('p', 'text-subtle', text(t('userOverlay.reportIdle'))))
  }

  // The dry run (docs/user-overlay.md decision 5): the document applied to the
  // schema already in memory, the result dropped. Nothing is written, nothing
  // reloads — which is the whole point of having it next to a button that does
  // both. The base is the schema as the app currently renders it, overlays
  // included: what a check answers is "what would this document do to what I
  // am looking at", not "what will the next load look like".
  #runCheck(value, report) {
    const result = checkUserOverlay(value, this.#source?.() ?? null)
    if (!result.ok) {
      this.#reportError(result, report)
      return
    }
    // The same frame as the editor above it, so a dry run reads as the answer
    // to the document rather than as loose text under a button.
    report.replaceChildren(
      el(
        'div',
        'rounded-box border border-base-300 overflow-hidden',
        el(
          'div',
          'px-3 py-2 border-b border-base-300 bg-base-200 text-subtle',
          text(
            t('userOverlay.checkSummary', {
              actions: result.actions,
              count: result.trace.length,
            }),
          ),
        ),
        el(
          'ul',
          'flex flex-col divide-y divide-base-300',
          ...result.trace.map((entry) => this.#traceLine(entry)),
          // A document-level warning (no action, unknown version) belongs to no
          // line above and would otherwise be the one thing a check swallows.
          ...result.documentWarnings.map((warning) =>
            el('li', 'px-3 py-2 text-warning break-words', text(overlayWarningText(warning))),
          ),
        ),
      ),
    )
  }

  // Per action: what it points at, and how many nodes that turned out to be —
  // the number no warning carries, because an action that works emits none.
  // The target leads on its own line: it is what the reader compares against
  // the document above, and the count is the verdict on it.
  #traceLine(entry) {
    const count =
      entry.matches === null
        ? t('userOverlay.unresolved')
        : t('userOverlay.matches', { matches: entry.matches })
    return el(
      'li',
      'flex flex-col gap-1 px-3 py-2',
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        el('code', 'font-mono break-all min-w-0', text(entry.target || t('userOverlay.noTarget'))),
        el(
          'span',
          entry.applied
            ? 'badge badge-xs badge-success badge-soft shrink-0'
            : 'badge badge-xs badge-ghost shrink-0',
          text(count),
        ),
      ),
      ...entry.warnings.map((warning) =>
        el('p', 'text-warning break-words', text(overlayWarningText(warning))),
      ),
    )
  }

  #runSave(value, report) {
    const result = saveUserOverlay(value)
    if (!result.ok) {
      this.#reportError(result, report)
      return
    }
    // Overlays run once, on the parsed source, before anything reads it: an
    // applied edit is a reload, not a re-render (decision 4).
    announce(t('userOverlay.saved'))
    window.location.reload()
  }

  #runDownload(value) {
    const parsed = parseUserOverlay(value)
    // The button is disabled on anything that does not parse; this is the same
    // verdict, not a second one — the click can only arrive between a keystroke
    // and the `input` it fires.
    if (!parsed.ok) return
    downloadText(userOverlayFilename(this.#diagnostics.specId), formatUserOverlay(parsed.document))
  }

  #runClearOverlay() {
    clearUserOverlay()
    announce(t('userOverlay.cleared'))
    window.location.reload()
  }

  #reportError(result, report) {
    const message = t(`userOverlay.error.${result.code}`, {
      size: formatBytes(result.bytes),
      max: formatBytes(USER_OVERLAY_MAX_BYTES),
    })
    report.replaceChildren(
      el('div', 'alert alert-error alert-soft text-xs', el('span', '', text(message))),
    )
    announce(message)
  }

  // --- danger zone ------------------------------------------------------

  #dangerSection() {
    const button = el('button', 'btn btn-sm btn-error', text(t('settings.reset.action')))
    button.type = 'button'
    button.dataset.resetAll = ''
    const action = confirmable(button, {
      onConfirm: () => this.#eraseAll(),
      confirmLabel: t('settings.reset.confirm'),
      cancelLabel: t('settings.cancel'),
      className: 'btn btn-sm btn-error',
    })
    const box = el(
      'div',
      'border border-error/40 rounded-box p-3 flex flex-col gap-2',
      el('p', 'text-sm', text(t('settings.reset.warning'))),
      action,
    )
    return el(
      'section',
      'flex flex-col gap-2',
      el('h4', 'font-bold text-sm text-error', text(t('settings.reset.title'))),
      box,
    )
  }

  async #eraseAll() {
    const failed = await eraseEverything(this.#inventory)
    if (failed.length) {
      // Reloading anyway: what did get erased is already gone, and leaving the
      // user on a page half-backed by deleted data is the worse of the two.
      console.error('[api-doc] settings: partial reset, failed rows:', failed)
      announce(t('settings.reset.partial'))
    }
    window.location.reload()
  }
}

// Two-step confirmation in place of `window.confirm`: this panel is injected
// into someone else's page, where a native dialog is out of style and, inside
// an embedded context, sometimes suppressed outright — and a suppressed confirm
// silently means "no" on a button whose whole job is to be deliberate. The
// action cell swaps to a confirm/cancel pair and swaps back, so no second modal
// stacks on this one.
function confirmable(trigger, { onConfirm, confirmLabel, cancelLabel, className = 'btn btn-xs' }) {
  const cell = el('div', 'flex items-center gap-1 shrink-0')
  const reset = () => cell.replaceChildren(trigger)
  trigger.addEventListener('click', () => {
    const yes = el('button', `${className} btn-error`, iconLabel(confirmLabel))
    yes.type = 'button'
    const no = el('button', `${className} btn-ghost`, text(cancelLabel))
    no.type = 'button'
    // Focus goes back to the trigger on cancel: it is the element that was
    // just replaced under the user's cursor, and losing focus to <body> here
    // drops a keyboard user out of the dialog's flow.
    no.addEventListener('click', () => {
      reset()
      trigger.focus()
    })
    yes.addEventListener('click', () => {
      reset()
      onConfirm()
    })
    cell.replaceChildren(yes, no)
    yes.focus()
  })
  reset()
  return cell
}

// A warning code carries which overlay raised it only when several are in play.
// The dry run has exactly one document — its own — so the prefix would name a
// number the author never gave it.
function overlayWarningText(warning) {
  const message = t(`overlay.code.${warning.code}`, warning)
  return warning.overlay ? t('overlay.warning', { overlay: warning.overlay, message }) : message
}

function iconLabel(label) {
  const span = el('span', 'inline-flex items-center gap-1')
  span.append(icon(CHECK_SVG_SM_BOLD, 'inline-flex'), text(label))
  return span
}

// `navigator.storage.estimate()` is origin-wide: it counts whatever else the
// host page stores, so the panel labels it as such rather than presenting it as
// the doc's own footprint.
async function storageEstimate() {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {}
    const used = formatBytes(usage)
    if (!used) return null
    const total = formatBytes(quota)
    return total ? `${used} / ${total}` : used
  } catch {
    return null
  }
}

if (!customElements.get('settings-panel')) customElements.define('settings-panel', SettingsPanel)
