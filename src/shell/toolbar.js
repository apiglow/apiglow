// The header's tools and the dialogs behind them: schema changelog, request
// history, the request importer, and the preferences menu — which holds the
// theme and language sections, the maintenance drawer and the About box.
//
// Every value this module needs is passed in already resolved — it never sees
// the host config object (rule 10); `app.js` reads it and hands over the parts.
//
// State ownership is the reason the two mutable pieces are shaped differently:
// the diff is written here and only read outside, so it stays here and is
// published through `changesFor()`; the current operation id is written by the
// router, so it stays there and arrives as a callback, read on each use.
import { appMenu } from '../components/app-menu.js'
import { el, iconButton, text } from '../components/dom.js'
import { IMPORT_SVG } from '../components/icons.js'
import { resolveLanguageChoice } from '../components/lang-switcher.js'
import { resolveThemeChoice } from '../components/theme-switcher.js'
import { t } from '../i18n/index.js'
import { diffOperations, FINGERPRINT_FORMAT, fingerprintRun } from '../openapi/diff.js'
import { readSchemaSnapshot, writeSchemaSnapshot } from '../storage/schema-snapshot.js'
import { historyIcon } from './header.js'

// Local schema diff (Bump.sh-changelog style, no backend): "Schema
// changed" badge when the loaded schema differs from the last snapshot seen
// on this browser. The snapshot is replaced on the first opening of the
// modal (= diff seen); the badge stays viewable for the whole session. Without a
// prior snapshot (first load), we save without flagging anything.
// Diff indexed by operation, available only once the snapshot is read:
// the nav and the doc then re-render with their badges.
function createChangelog({ model, nav, doc, byId, snapshotKey, currentOpId, whenIdle }) {
  let schemaChanges = null
  const node = document.createElement('schema-changelog')
  const button = el('button', 'btn btn-sm btn-warning btn-soft hidden', text(t('changelog.badge')))
  button.type = 'button'
  button.addEventListener('click', () => node.open())
  // Fingerprints computed off the critical path: the IndexedDB read is
  // asynchronous, but it can resolve before the first paint — without the
  // idle deferral, the computation would freeze the page before it displays,
  // with no indicator at all. And one idle slot per BATCH, not one for the
  // whole run: deferred whole, a third of a second of fingerprinting lands
  // in one task right where the reader's first click goes (rule 14). The
  // changelog is a decoration: it arrives whenever it arrives.
  const fingerprints = () =>
    new Promise((resolve) => {
      const run = fingerprintRun(model)
      const step = () => {
        const next = run.next()
        if (next.done) resolve(next.value)
        else whenIdle(step)
      }
      whenIdle(step)
    })
  readSchemaSnapshot(snapshotKey).then(async (previous) => {
    const currentSnapshot = {
      url: snapshotKey,
      format: FINGERPRINT_FORMAT,
      savedAt: Date.now(),
      version: model.info.version,
      operations: await fingerprints(),
    }
    // Snapshot written under another FINGERPRINT_FORMAT: not comparable —
    // replaced without flagging, like a first load. A live invariant, not a
    // migration: every change to how fingerprints are computed bumps that
    // number, and diffing across the bump would report phantom changes.
    if (!previous || previous.format !== FINGERPRINT_FORMAT) {
      writeSchemaSnapshot(currentSnapshot)
      return
    }
    const diff = diffOperations(previous.operations, currentSnapshot.operations)
    if (diff.empty && previous.version === currentSnapshot.version) return
    node.diff = {
      ...diff,
      oldVersion: previous.version,
      newVersion: currentSnapshot.version,
      since: previous.savedAt,
    }
    node.onFirstOpen = () => writeSchemaSnapshot(currentSnapshot)
    button.classList.remove('hidden')
    // In-situ marking: the modal stays the summary, these badges say
    // where to look. They live for the session (like the button), even
    // after the snapshot is replaced — otherwise they'd disappear before
    // the relevant endpoints have been browsed.
    schemaChanges = diff.byOp
    nav.changes = schemaChanges
    // The already-displayed operation must re-render to carry its badges:
    // `changes` is a silent setter, `operation` is what triggers the render.
    const opId = currentOpId()
    if (opId && byId.has(opId)) {
      doc.changes = schemaChanges[opId] ?? null
      doc.operation = byId.get(opId)
    }
  })
  return { node, button, changesFor: (opId) => schemaChanges?.[opId] ?? null }
}

export function createToolbar({
  model,
  nav,
  doc,
  byId,
  snapshotKey,
  currentOpId,
  whenIdle,
  historyStore,
  scenarioStore,
  envStore,
  requestCredentials,
  themes,
  themeDefault,
  languages,
  languageDefault,
  diagnostics,
  auditEnabled,
  schemaSource,
  overlayWarnings = [],
  importBaseUrls,
  build,
}) {
  const changelog = createChangelog({
    model,
    nav,
    doc,
    byId,
    snapshotKey,
    currentOpId,
    whenIdle,
  })

  const historyList = document.createElement('request-history-list')
  historyList.history = historyStore
  historyList.envStore = envStore
  historyList.model = model
  historyList.requestCredentials = requestCredentials
  // Labels collapsed below sm: the header already carries 5 tools + the hamburger.
  const historyBtn = el(
    'button',
    'btn btn-sm btn-ghost gap-1.5 max-sm:btn-square',
    historyIcon(),
    el('span', 'hidden sm:inline', text(t('history.open'))),
  )
  historyBtn.setAttribute('aria-label', t('history.open'))
  historyBtn.type = 'button'
  historyBtn.addEventListener('click', () => historyList.open())

  // A single offered theme or language is not a choice: the section is left out
  // rather than rendered as one dead option, and the menu closes its own rule
  // over the gap.
  let themeSwitcher = null
  if (themes.length > 1) {
    themeSwitcher = document.createElement('theme-switcher')
    // The choice, not the applied data-theme: under 'system' the two differ, and
    // the check mark must land on System.
    themeSwitcher.themes = {
      available: themes,
      current: resolveThemeChoice({ available: themes, fallback: themeDefault }),
    }
  }

  let langSwitcher = null
  if (languages.length > 1) {
    langSwitcher = document.createElement('lang-switcher')
    // The choice again, not the loaded language: 'browser' is a choice of its own
    // and the check mark must land on it rather than on what it resolved to.
    langSwitcher.languages = {
      available: languages,
      current: resolveLanguageChoice({ available: languages, fallback: languageDefault }),
    }
  }

  // Maintenance drawer: deliberately the least prominent thing the bar can
  // reach — an item at the bottom of the preferences menu, never a control of
  // its own. Nothing here belongs to reading the doc, and a discoverable
  // "erase everything" would be a hazard.
  const settingsPanel = document.createElement('settings-panel')
  settingsPanel.stores = { history: historyStore, scenarios: scenarioStore }
  settingsPanel.diagnostics = diagnostics
  // The overlay editor's dry run needs the document its targets address, which
  // no derived value can stand in for.
  settingsPanel.schemaSource = schemaSource
  for (const warning of overlayWarnings) {
    console.warn('[api-doc] overlay:', warning.code, warning.target ?? warning.url ?? '')
  }
  settingsPanel.audit = auditEnabled

  // "Schema patched locally" (docs/user-overlay.md decision 3): permanent while
  // a user overlay is applied, and labelled at every breakpoint unlike the
  // tools around it. The failure mode this feature creates is forgetting that
  // what you are reading diverges from what the API published — a badge you
  // have to go looking for would be that same forgetting, one click away.
  let userOverlayBtn = null
  if (diagnostics?.overlays?.user) {
    userOverlayBtn = el('button', 'btn btn-sm btn-warning btn-soft', text(t('userOverlay.badge')))
    userOverlayBtn.type = 'button'
    userOverlayBtn.dataset.userOverlayBadge = ''
    userOverlayBtn.addEventListener('click', () => settingsPanel.open({ focus: 'user-overlay' }))
  }

  // Request import (cURL / Postman / HAR): a tool, not a view — square icon in
  // the toolbar, like the settings drawer. It hands back an operation id and a
  // pre-filled request; the routing is the one the scenario steps use.
  const importDialog = document.createElement('import-dialog')
  importDialog.model = model
  importDialog.baseUrls = importBaseUrls
  const importBtn = iconButton('btn btn-sm btn-ghost btn-square', IMPORT_SVG, t('import.open'))
  importBtn.addEventListener('click', () => importDialog.open())

  const aboutDialog = document.createElement('about-dialog')
  aboutDialog.build = build

  const menu = appMenu({
    themeSwitcher,
    langSwitcher,
    onSettings: () => settingsPanel.open(),
    onAbout: () => aboutDialog.open(),
  })

  return {
    changelog: changelog.node,
    changelogBtn: changelog.button,
    changesFor: changelog.changesFor,
    historyList,
    historyBtn,
    menu,
    settingsPanel,
    userOverlayBtn,
    importDialog,
    importBtn,
    aboutDialog,
  }
}
