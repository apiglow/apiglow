import { publishedArazzo, toArazzo } from '../export/arazzo.js'
import { encodeScenarioLink, SHARE_URL_MAX } from '../export/scenario-share.js'
import { t } from '../i18n/index.js'
import { slugify } from '../openapi/model.js'
import { opHash, scenarioImportHash } from '../router.js'
import { activeAssertions } from '../scenarios/evaluate.js'
import {
  encodeScenarioFile,
  needsInteractive,
  scenarioVariables,
  stepReferences,
} from '../scenarios/model.js'
import { pointerToPath } from '../scenarios/pointer.js'
import { summarize } from '../scenarios/runner.js'
import { suggestSources } from '../scenarios/suggest.js'
import { announce } from './a11y.js'
import { writeClipboard } from './copy-button.js'
import { ciPanel } from './ci-panel.js'
import { downloadText } from './download.js'
import { el, keepPlace, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import {
  DOTS_SVG,
  DUPLICATE_SVG,
  EXPORT_TRAY_SVG,
  IMPORT_TRAY_SVG,
  OPEN_EXTERNAL_SVG,
  PLAY_STEP_SVG,
  PLAY_SVG,
  REFRESH_SVG,
  TRASH_SVG,
} from './icons.js'
import { markdownBlock } from './markdown.js'
import { methodBadgeClass } from './method-colors.js'
import { stepReportBlock } from './scenario-report.js'
import { stepChainEditor } from './scenario-step-editor.js'

// Icons for the scenario action bar. Decorative: each button keeps its
// label, the icon only gives the bar a relief that five aligned labels
// didn't have.
const ICON = {
  run: PLAY_SVG,
  step: PLAY_STEP_SVG,
  export: EXPORT_TRAY_SVG,
  import: IMPORT_TRAY_SVG,
  duplicate: DUPLICATE_SVG,
  delete: TRASH_SVG,
  open: OPEN_EXTERNAL_SVG,
  update: REFRESH_SVG,
}

function icon(name) {
  const span = el('span', 'shrink-0')
  span.innerHTML = ICON[name]
  span.setAttribute('aria-hidden', 'true')
  return span
}

// View of a scenario (docs/scenarios.md §5.2): header, prerequisites, step
// timeline, run report. Editing a step has no editor of its own — it
// goes through the real try-it ("open" then "update from the try-it").
class ApiScenarioView extends HTMLElement {
  #ops = new Map()
  #schemaUrl = ''
  #source = null
  #scenario = null
  // Provided by the shell: { update, remove, duplicate, openStep,
  // recaptureStep, run, persist, openHistory, env, manageEnv, proxyAvailable,
  // notify }.
  #actions = null
  // Report of the run in progress or of the last run: in-memory state, never
  // persisted (§4) — history keeps the durable trace. Empty Map = no run.
  #report = new Map()
  #summary = null
  #running = false
  #proxyOn = false
  // Last known response for each step (§5.4): the one from the in-memory run,
  // otherwise history. This is the material for click-to-extract.
  #responses = new Map()
  #responsesFor = null
  // Expanded chaining editors, by step id: the view fully re-renders on
  // every write, opening one must not close it under the user's fingers.
  #openEditors = new Set()
  // Same reason, one notch finer: tab and status chosen WITHIN an editor.
  // Without this, clicking a schema key would land on the response tab.
  #editorUi = new Map()
  // What the source document says and this app cannot run (docs/scenarios.md
  // §3): named on the page rather than only in the console, because a declared
  // scenario has no importer's toast to carry it — nobody is watching at boot.
  #warnings = []
  // `features.ci`, handed down by the shell (rule 10): the CI hand-off is a
  // surface an installation may not want to offer at all.
  #ci = true
  // The CI panel's own state (open, runner, platform): every write re-renders
  // the whole view, and a run landing its results must not close the panel
  // under the reader's fingers nor send them back to the first runner.
  #ciState = {}
  // The published recipe, memoized on the scenario it describes. A run
  // re-renders the whole view once per step result, and rebuilding an Arazzo
  // document — a walk over every step plus a map over every operation — is
  // work whose inputs did not move. A write replaces the scenario object,
  // which is what invalidates this.
  #recipe = { scenario: null, source: null, document: null }
  // Step to highlight on the next display — set by the shell right after
  // a capture, consumed once.
  #focusStepId = null
  // The rail's position: the step a capture just
  // landed on, or — during and after a run — the last step that produced a
  // result. Purely presentational; the run itself never reads it.
  #activeStepId = null

  // Landing after "add to a scenario": the step just created is the only
  // one expanded, and we're brought to it. Without this, capture handed
  // back control to a silent timeline, where nothing pointed to the added
  // step anymore.
  set focusStep(stepId) {
    this.#focusStepId = stepId ?? null
  }

  set context({ model, schemaUrl = '', ci = true, actions }) {
    this.#ops = new Map([...model.operations, ...(model.webhooks ?? [])].map((op) => [op.id, op]))
    this.#schemaUrl = schemaUrl
    this.#ci = ci
    this.#actions = actions ?? null
  }

  // { kind: 'config', scenario, warnings, arazzo, url } | { kind: 'local',
  // scenario } | { kind: 'import', scenario } — preview before import, nothing
  // is stored. `arazzo` is the authored document when the entry declared one,
  // and `url` the address it was declared at: the CI panel publishes that file
  // rather than a recipe made from our reading of it.
  // A config scenario arrives resolved: the shell's loader owns the fetch, the
  // format sniffing and the ids, because one entry can declare several
  // scenarios (docs/scenarios.md §3).
  set source(source) {
    this.#source = source
    this.#warnings = source?.warnings ?? []
    if (this.isConnected) this.#show(source.scenario)
  }

  connectedCallback() {
    // Wider than the docs (max-w-3xl): an extraction row carries a name,
    // a source, a pointer and two checkboxes — at 768 px it wrapped to the
    // next line, and a five-step scenario became unreadable.
    this.classList.add('block', 'max-w-5xl')
    if (this.#source) this.#show(this.#source.scenario)
  }

  #show(scenario) {
    // Different scenario: the previous one's report no longer has anything to describe.
    if (scenario.id !== this.#scenario?.id) {
      this.#report.clear()
      this.#summary = null
      this.#responses = new Map()
      this.#openEditors = new Set()
      this.#editorUi = new Map()
    }
    // "The others collapsed": highlighting replaces the open state,
    // it doesn't add to it.
    const focused = this.#focusStepId
    this.#focusStepId = null
    if (focused && scenario.steps.some((step) => step.id === focused)) {
      this.#openEditors = new Set([focused])
      this.#activeStepId = focused
    }
    this.#scenario = scenario
    this.#refresh()
    if (focused) this.#revealStep(focused)
    this.#loadResponses(scenario)
  }

  #revealStep(stepId) {
    const row = this.querySelector(`li[data-step-id="${CSS.escape(stepId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  // Deferred history read: once per displayed scenario, and never on
  // the first-render path.
  #loadResponses(scenario) {
    if (!this.#actions?.stepResponses || this.#responsesFor === scenario.id) return
    this.#responsesFor = scenario.id
    this.#actions
      .stepResponses(scenario)
      .then((responses) => {
        if (this.#scenario?.id !== scenario.id || !responses?.size) return
        this.#responses = new Map([...responses, ...this.#responses])
        this.#refresh()
      })
      .catch((err) => console.error('[api-doc] scenario responses read failed:', err))
  }

  // Every write re-renders the whole timeline, and the gesture that writes the
  // most — clicking key after key in a step's response — is made inside a box
  // that scrolls. `keepPlace` gives the reader back the place they clicked
  // from; the view itself keeps naming nothing but what it draws.
  #refresh() {
    keepPlace(this, () => this.replaceChildren(this.#scenarioView(this.#scenario)))
  }

  // Write: the view never mutates the store's object, it proposes a
  // successor. The refresh comes back via the route (store change).
  #commit(mutate) {
    const next = { ...this.#scenario, steps: [...this.#scenario.steps] }
    mutate(next)
    // Held locally before the write, because the write is a round trip through
    // IndexedDB and the next edit starts from `#scenario`. Two edits closer
    // together than that round trip — the name and the pointer of a chaining
    // row are one Tab apart — would otherwise both branch off the same
    // pre-edit scenario, and the first one would be silently dropped. Only the
    // engine's speed decided whether it was, which is how the matrix found it.
    // The store's re-render lands on this same value; a failed write says so
    // with a toast, and the next #show replaces it wholesale.
    this.#scenario = next
    this.#actions?.update(next)
  }

  #scenarioView(scenario) {
    // Import preview: nothing is stored yet, so nothing is editable and
    // nothing runs — a received link must not produce any effect before an
    // explicit action (§8.2).
    const preview = this.#source?.kind === 'import'
    const local = !preview && scenario.source === 'local'
    const wrap = el('div', 'flex flex-col gap-4')
    wrap.append(preview ? this.#importHeader(scenario) : this.#header(scenario, local))
    const degraded = this.#degradedNotice()
    if (degraded) wrap.append(degraded)
    const description = markdownBlock(scenario.description)
    if (description) wrap.append(description)
    const prerequisites = this.#prerequisites(scenario)
    if (prerequisites) wrap.append(prerequisites)
    if (!scenario.steps.length) {
      const empty = el('div', 'alert alert-info', el('span', '', text(t('scenario.noSteps'))))
      empty.setAttribute('role', 'note')
      wrap.append(empty)
      return wrap
    }
    const automation = this.#ciPanel(scenario, preview)
    if (automation) wrap.append(automation)
    const list = el('ol', 'api-step-rail flex flex-col gap-3')
    for (const [index, step] of scenario.steps.entries()) {
      list.append(this.#stepRow(step, index, scenario, local))
    }
    wrap.append(list)
    const summary = this.#summaryBar()
    if (summary) wrap.append(summary)
    return wrap
  }

  #importHeader(scenario) {
    const accept = el('button', 'btn btn-sm btn-primary', text(t('scenario.import.accept')))
    accept.type = 'button'
    accept.dataset.importAccept = ''
    accept.addEventListener('click', () => this.#actions?.acceptImport(scenario))
    const cancel = el('button', 'btn btn-sm btn-ghost', text(t('scenario.import.cancel')))
    cancel.type = 'button'
    cancel.addEventListener('click', () => this.#actions?.cancelImport())
    const alert = el('div', 'alert alert-info', el('span', '', text(t('scenario.import.question'))))
    alert.setAttribute('role', 'note')
    return el(
      'div',
      'flex flex-col gap-2',
      alert,
      el(
        'div',
        'flex flex-wrap items-center gap-3',
        el('h1', 'text-2xl font-bold', text(scenario.name || t('scenario.untitled'))),
        el(
          'span',
          'text-sm text-subtle',
          text(t('scenario.stepCount', { count: scenario.steps.length })),
        ),
      ),
      el('div', 'flex flex-wrap items-center gap-2', accept, cancel),
    )
  }

  #header(scenario, local) {
    // Name editable in place: the write happens on `change` (blur / Enter),
    // not on keystrokes — each commit re-renders the view and would take the focus with it.
    let title
    if (local) {
      title = el('input', 'input input-ghost text-2xl font-bold px-0 w-full max-w-md')
      title.value = scenario.name
      title.setAttribute('aria-label', t('scenario.name'))
      title.addEventListener('change', () =>
        this.#commit((next) => (next.name = title.value.trim())),
      )
    } else {
      title = el('h1', 'text-2xl font-bold', text(scenario.name || t('scenario.untitled')))
    }
    const duplicate = el(
      'button',
      'btn btn-sm btn-outline gap-1.5',
      icon('duplicate'),
      text(t('scenario.duplicate')),
    )
    duplicate.type = 'button'
    duplicate.addEventListener('click', () => this.#actions?.duplicate(scenario))
    let remove = null
    if (local) {
      remove = el(
        'button',
        'btn btn-sm btn-error btn-outline gap-1.5',
        icon('delete'),
        text(t('scenario.delete')),
      )
      remove.type = 'button'
      remove.addEventListener('click', () => {
        if (!window.confirm(t('scenario.deleteConfirm', { name: scenario.name }))) return
        this.#actions?.remove(scenario)
      })
    }
    return el(
      'div',
      'flex flex-col gap-2',
      el(
        'div',
        'flex flex-wrap items-center gap-3',
        title,
        el(
          'span',
          'badge badge-ghost badge-sm',
          text(
            scenario.source === 'config' ? t('scenario.sourceConfig') : t('scenario.sourceLocal'),
          ),
        ),
        this.#warnings.length
          ? el(
              'span',
              'badge badge-warning badge-sm',
              text(t('scenario.degraded.badge', { count: this.#warnings.length })),
            )
          : null,
        el(
          'span',
          'text-sm text-subtle',
          text(t('scenario.stepCount', { count: scenario.steps.length })),
        ),
      ),
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        this.#importButton(scenario),
        this.#runButton(scenario),
        this.#stepButton(scenario),
        this.#exportMenu(scenario),
        duplicate,
        remove,
      ),
      this.#proxyRow(scenario),
    )
  }

  // What the badge promises, spelled out: one line per construct of the source
  // document this app cannot run. The codes are the parsers' own, translated
  // here — the contract the import dialog already follows, the code itself
  // being the fallback so a new one never renders as nothing.
  #degradedNotice() {
    if (!this.#warnings.length) return null
    const box = el(
      'div',
      'alert alert-warning alert-soft flex-col items-start gap-1 text-sm',
      el('span', 'font-bold', text(t('scenario.degraded.title', { count: this.#warnings.length }))),
      el(
        'ul',
        'list-disc ps-4 flex flex-col gap-0.5',
        ...this.#warnings.map((warning) =>
          el('li', '', text(t(`scenario.issue.${warning.code}`, warning))),
        ),
      ),
    )
    box.setAttribute('role', 'note')
    box.dataset.scenarioDegraded = ''
    return box
  }

  // Still-empty scenario: importing a file is one of the two ways to fill
  // it, and the only one starting from this page — hiding it under "Export"
  // (a menu whose name promises the opposite) amounted to not offering it.
  // As soon as there are steps, the menu alone takes over the load: the page
  // no longer has anything of a starting point.
  #importButton(scenario) {
    if (!this.#actions?.importFile || scenario.steps.length) return null
    const btn = el(
      'button',
      'btn btn-sm btn-outline gap-1.5',
      icon('import'),
      text(t('scenario.importFile')),
    )
    btn.type = 'button'
    btn.dataset.scenarioImportButton = ''
    btn.addEventListener('click', () => this.#actions.importFile())
    return btn
  }

  // Sharing and interop (§8): the file is the canonical format — it's the
  // one an author commits in their docs to declare it as config. Import is
  // in the same menu: it's the only place in the app where scenario files
  // are handled, and the nav no longer offers import as long as no
  // scenario exists (§5.1).
  #exportMenu(scenario) {
    const item = (label, onClick, marker = 'scenarioExport') => {
      const btn = el('button', 'text-left', text(label))
      btn.type = 'button'
      btn.dataset[marker] = label
      btn.addEventListener('click', () => {
        menu.close()
        onClick()
      })
      return el('li', '', btn)
    }
    const base = slugify(scenario.name) || 'scenario'
    const summary = el(
      'summary',
      'btn btn-sm btn-outline gap-1.5 font-normal',
      icon('export'),
      text(t('scenario.export')),
    )
    const list = el(
      'ul',
      'dropdown-content menu menu-sm bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-64 p-1',
    )
    // dropdown-start and not -end: `main` is a scroll container, hence
    // a clipping box. On a scenario with no step, "Run all" and
    // "Step by step" don't exist — Export becomes the row's first button,
    // and a right-aligned menu started 140 px to the left of `main`,
    // clipped then covered by the nav column, items unreachable.
    const menu = detailsDropdown('dropdown-start', summary, list)
    list.append(
      item(t('scenario.export.file'), () =>
        downloadText(`${base}.json`, JSON.stringify(encodeScenarioFile(scenario), null, 2)),
      ),
      item(t('scenario.export.link'), () => this.#copyShareLink(scenario)),
      // The same document the CI panel hands over (docs/scenario-handoff.md
      // §4), because the two write the same file name on the same page: an
      // authored Arazzo file is downloaded as it stands. `toArazzo` is the
      // fallback for what has no published recipe — a scenario of the reader's
      // own, where the menu still owes them a file.
      item(t('scenario.export.arazzo'), () =>
        downloadText(
          `${base}.arazzo.json`,
          JSON.stringify(
            this.#publishedRecipe(scenario) ??
              toArazzo(scenario, { ops: [...this.#ops.values()], sourceUrl: this.#schemaUrl }),
            null,
            2,
          ),
        ),
      ),
    )
    if (this.#actions?.importFile) {
      // Separated: the first three items export THIS scenario, this one
      // brings another one in. The direction of flow isn't the same.
      list.append(
        el('li', 'pointer-events-none', el('div', 'divider my-0')),
        item(t('scenario.importFile'), () => this.#actions.importFile(), 'scenarioImport'),
      )
    }
    menu.details.dataset.scenarioExportMenu = ''
    return menu.details
  }

  async #copyShareLink(scenario) {
    const url = new URL(window.location.href)
    url.hash = scenarioImportHash(encodeScenarioLink(scenario))
    if (!(await writeClipboard(url.href))) {
      this.#actions?.notify?.('error', t('scenario.export.linkError'))
      return
    }
    // The link is copied anyway: it's up to the recipient to decide. But
    // beyond this size, a messaging app will silently truncate it.
    if (url.href.length > SHARE_URL_MAX) {
      this.#actions?.notify?.('error', t('scenario.export.linkTooLong'))
      return
    }
    this.#actions?.notify?.('success', t('scenario.export.linkCopied'))
  }

  #runButton(scenario) {
    if (!this.#actions?.run || !scenario.steps.length) return null
    const btn = el(
      'button',
      'btn btn-sm btn-primary gap-1.5',
      this.#running ? el('span', 'loading loading-spinner loading-xs') : icon('run'),
      text(this.#running ? t('scenario.running') : t('scenario.runAll')),
    )
    btn.type = 'button'
    // Not disabled while running, unlike every other control here: this is the
    // button the keyboard is standing on when the run starts, and a disabled
    // button cannot hold focus — the reader would be dropped on <body> and lose
    // the scenario at the exact moment it starts reporting. `keepPlace` carries
    // focus across the refresh instead, onto a button that now says "Running…",
    // and the guard below is what `disabled` was there to buy.
    btn.dataset.keepFocus = 'scenario-run'
    btn.addEventListener('click', () => {
      if (!this.#running) this.#run(scenario)
    })
    return btn
  }

  // Step-by-step (§5.3): the run starts here but is driven from the try-it —
  // the view hands control to the controller and gets the report back on return.
  #stepButton(scenario) {
    if (!this.#actions?.runStepByStep || !scenario.steps.length) return null
    const btn = el(
      'button',
      'btn btn-sm btn-outline btn-primary gap-1.5',
      icon('step'),
      text(t('scenario.runStepByStep')),
    )
    btn.type = 'button'
    btn.disabled = this.#running
    btn.addEventListener('click', () => {
      this.beginRun()
      // No proxy setting to pass along: in step-by-step it's the panel
      // that sends, with its own.
      this.#actions.runStepByStep(scenario)
    })
    return btn
  }

  // --- report driven from the outside (auto run AND step-by-step) ---------------

  beginRun() {
    this.#report.clear()
    this.#summary = null
    this.#running = true
    this.#activeStepId = null
    announce(t('scenario.running'))
    this.#refresh()
  }

  pushStepResult(result) {
    this.#report.set(result.stepId, result)
    this.#activeStepId = result.stepId
    // The response we just got is the best possible material for the
    // chaining editor: it takes precedence over the one from history.
    if (result.result?.response) this.#responses.set(result.stepId, result.result.response)
    this.#refresh()
  }

  // The summary is read back from the report: the view doesn't need the
  // results handed back to it a second time, it has already filed them per step.
  endRun() {
    this.#running = false
    this.#summary = summarize([...this.#report.values()])
    // The summary bar is rebuilt by `#refresh`, text already inside: a live
    // region that appears with its content is not a mutation and stays
    // silent. The announcement is what actually reaches the user.
    announce(
      t('scenario.summary', {
        ok: this.#summary.counts.ok,
        total: this.#summary.total,
        ms: this.#summary.durationMs,
      }),
    )
    this.#refresh()
  }

  // The CORS proxy is only offered if it's configured — same settings as the
  // try-it (§6), decided before launch since there's no panel here.
  //
  // A single button's setting ("Run all" — step-by-step sends from the
  // panel, with its own), touched once for a whole API: it sits below the
  // row, on the right and small, rather than holding the same rank as the
  // actions. With no step, it no longer drives anything: it disappears.
  #proxyRow(scenario) {
    if (!this.#actions?.proxyAvailable || !scenario.steps.length) return null
    const toggle = el('input', 'toggle toggle-xs')
    toggle.type = 'checkbox'
    toggle.checked = this.#proxyOn
    toggle.disabled = this.#running
    toggle.addEventListener('change', () => {
      this.#proxyOn = toggle.checked
    })
    const label = el(
      'label',
      'label text-xs gap-2 cursor-pointer text-subtle',
      toggle,
      text(t('tryit.proxy')),
    )
    label.title = t('scenario.proxyHint')
    return el('div', 'flex justify-end', label)
  }

  // Prerequisites (§5.2): variables referenced by the steps that no earlier
  // extraction produces. This is the answer to "why is this going to fail" BEFORE
  // running.
  #prerequisites(scenario) {
    const { required } = scenarioVariables(scenario)
    if (!required.length) return null
    const env = this.#actions?.env?.() ?? null
    const variables = env?.variables ?? {}
    const missing = required.filter((name) => !variables[name]?.value)
    const chips = required.map((name) => {
      const provided = !!variables[name]?.value
      return el(
        'span',
        `badge badge-sm font-mono ${provided ? 'badge-success badge-outline' : 'badge-error'}`,
        text(`{{${name}}}`),
      )
    })
    const box = el(
      'div',
      'rounded-box border border-base-300 p-3 flex flex-col gap-2',
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        el('span', 'text-label uppercase text-subtle', text(t('scenario.prerequisites'))),
        env?.name ? el('span', 'badge badge-ghost badge-sm', text(env.name)) : null,
      ),
      el('div', 'flex flex-wrap gap-1.5', ...chips),
    )
    if (missing.length) {
      const hint = el(
        'span',
        'text-sm',
        text(t('scenario.varMissing', { names: missing.join(', ') })),
      )
      const manage = this.#actions?.manageEnv
        ? (() => {
            const btn = el('button', 'btn btn-xs btn-outline', text(t('env.manage')))
            btn.type = 'button'
            btn.addEventListener('click', () => this.#actions.manageEnv())
            return btn
          })()
        : null
      box.append(el('div', 'flex flex-wrap items-center gap-2', hint, manage))
    }
    return box
  }

  // The CI hand-off (docs/scenario-handoff.md §4): what this page hands to a
  // scheduler, which a front-end product cannot be. The document is the
  // authored one when a `scenarios[]` entry declared an Arazzo file — published
  // as it stands, never regenerated — and `toArazzo`'s otherwise; an install
  // whose schema is not published has no recipe a runner could fetch, and
  // `ciPanel` renders nothing rather than a job that fails on its first run.
  //
  // Nothing on an import preview: it is a proposal, and offering to automate a
  // scenario that is not stored yet would answer a question nobody asked (§8.2).
  // Nothing either when `features.ci` is off — a host for whom a pipeline is
  // not the reader's business, and the one thing that switch removes.
  #publishedRecipe(scenario) {
    if (this.#recipe.scenario !== scenario || this.#recipe.source !== this.#source) {
      this.#recipe = {
        scenario,
        source: this.#source,
        document: publishedArazzo(
          { arazzo: this.#source?.arazzo ?? null, scenario },
          { ops: [...this.#ops.values()], specUrl: this.#schemaUrl },
        ),
      }
    }
    return this.#recipe.document
  }

  #ciPanel(scenario, preview) {
    if (preview || !this.#ci) return null
    const declared = this.#source?.arazzo ?? null
    return ciPanel({
      document: this.#publishedRecipe(scenario),
      name: scenario.name,
      scenarioId: scenario.id,
      // The single-source case (§4): an Arazzo document declared by `url` is
      // already served by the host, so the job fetches the author's own file
      // rather than a copy committed beside it. Absolute, because a CI runner
      // resolves nothing against this page.
      url: declared && this.#source?.url ? new URL(this.#source.url, location.href).href : '',
      authored: !!declared,
      state: this.#ciState,
      onState: (patch) => Object.assign(this.#ciState, patch),
    })
  }

  #stepRow(step, index, scenario, local) {
    const op = this.#ops.get(step.opId)
    const result = this.#report.get(step.id) ?? null
    // The rail marker: the step number, wearing the verdict color once a run
    // has one (CSS keyed on data-step-status — the classes stay static).
    const marker = el('span', 'api-step-marker', text(String(index + 1)))
    marker.dataset.stepMarker = ''
    const head = el(
      'div',
      'flex flex-wrap items-center gap-2',
      el('span', methodBadgeClass(op?.method, 'badge-sm'), text(op?.method ?? '?')),
    )
    if (op) {
      // Real link: the step is read in its operation's docs.
      const link = el('a', 'link link-hover font-mono text-sm break-all', text(op.path))
      link.href = opHash(op.id)
      head.append(
        link,
        op.summary ? el('span', 'text-sm text-subtle truncate', text(op.summary)) : null,
      )
    } else {
      // The schema evolved out from under the scenario: stated here rather than at run time.
      head.append(
        el('code', 'font-mono text-sm break-all text-subtle', text(step.opId)),
        el('span', 'badge badge-error badge-sm', text(t('scenario.opMissing'))),
      )
    }
    head.append(el('span', 'grow'), ...this.#stepActions(step, index, scenario, local))

    // Step not reached: grayed out, as in the report described by the SPEC.
    const dimmed = result?.status === 'skipped' ? ' text-faint' : ''
    const row = el(
      'li',
      `relative border border-base-300 rounded-box p-3 flex flex-col gap-2${dimmed}`,
      marker,
      head,
    )
    row.dataset.stepId = step.id
    if (result) row.dataset.stepStatus = result.status
    if (step.id === this.#activeStepId) row.dataset.stepActive = ''
    const anchor = requestAnchor(op, step)
    if (anchor) row.append(anchor)
    const note = markdownBlock(step.note)
    if (note) row.append(el('div', 'text-sm', note))
    const chips = [
      ...this.#usesChips(step, index, scenario, local),
      ...step.extract.map((extract) =>
        el(
          'span',
          'badge badge-ghost badge-sm font-mono',
          text(`{{${extract.name}}} ← ${sourceLabel(extract)}`),
        ),
      ),
      ...expectChips(step.expect),
      ...(needsInteractive(step.request)
        ? [el('span', 'badge badge-warning badge-sm', text(t('scenario.needsInteractive')))]
        : []),
    ]
    if (chips.length) row.append(el('div', 'flex flex-wrap gap-1.5', ...chips))
    if (local) row.append(this.#chainEditor(step, index))
    if (result) row.append(stepReportBlock(result, { openHistory: this.#historyOpener(scenario) }))
    return row
  }

  // "View in history" frames on the SCENARIO, not on the step's endpoint:
  // what we're going to look for there is the flow — the calls of the other
  // steps around this one, and those of previous runs to compare. The
  // endpoint filter drowned that under twenty free-form tries of the same path.
  // The entry for the clicked step stays expanded and is brought on screen.
  #historyOpener(scenario) {
    const open = this.#actions?.openHistory
    if (!open) return null
    return ({ stepId }) => open({ scenarioId: scenario.id, stepId })
  }

  // What the step CONSUMES, and where it comes from. A step used to display only its
  // extractions: a correctly chained scenario therefore showed nothing of the
  // chaining on the consumer side, and the "Prerequisites" box, for its part, only lists what
  // is missing — chaining well amounted to seeing nothing.
  #usesChips(step, index, scenario, local) {
    const names = [...stepReferences(step)]
    if (!names.length) return []
    // A variable is provided by the LAST earlier step that produces it:
    // that's the one whose value will be in scope at send time.
    const producers = new Map()
    scenario.steps.slice(0, index).forEach((previous, i) => {
      for (const extract of previous.extract ?? []) producers.set(extract.name, i + 1)
    })
    const envVariables = this.#actions?.env?.()?.variables ?? {}
    return names.map((name) => {
      const from = producers.get(name)
      const inEnv = !from && !!envVariables[name]?.value
      // Green = a link in the chain, gray = environment value (correct
      // but not chaining), red = nobody provides it.
      if (!from && !inEnv) return this.#unknownVarChip(name, index, scenario, local)
      const source = from
        ? t('scenario.uses.fromStep', { index: from })
        : t('scenario.uses.fromEnv')
      const classes = from
        ? 'badge badge-sm font-mono badge-success badge-outline'
        : 'badge badge-sm font-mono badge-ghost'
      const chip = el('span', classes, text(`{{${name}}} ⇠ ${source}`))
      chip.dataset.usesVariable = name
      return chip
    })
  }

  // The gap, and what to fill it with (§5.4). Extraction is better designed from
  // the CONSUMER: that's where we know what's missing. Candidates come out
  // of already-observed responses, failing that from declared schemas — so as early as
  // capture, without having sent anything.
  #unknownVarChip(name, index, scenario, local) {
    const label = `{{${name}}} ⇠ ${t('scenario.uses.unknown')}`
    const classes = 'badge badge-sm font-mono badge-error badge-outline'
    const suggestions = local
      ? suggestSources(name, {
          steps: scenario.steps.slice(0, index),
          opFor: (step) => this.#ops.get(step.opId) ?? null,
          responseFor: (step) => this.#responses.get(step.id) ?? null,
        })
      : []
    if (!suggestions.length) {
      const chip = el('span', classes, text(label))
      chip.dataset.usesVariable = name
      return chip
    }
    const summary = el('summary', `${classes} cursor-pointer list-none`, text(label))
    summary.dataset.usesVariable = name
    summary.title = t('scenario.uses.suggestTitle', { name })
    const list = el(
      'ul',
      'dropdown-content menu menu-sm bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-80 p-1',
    )
    // dropdown-start: chips live at the full width of a timeline already
    // constrained by `main`, a right-aligned menu would be clipped there.
    const dropdown = detailsDropdown('dropdown-start', summary, list)
    list.append(
      el('li', 'menu-title px-2 py-1 text-xs', text(t('scenario.uses.suggestTitle', { name }))),
      ...suggestions.map((suggestion) => {
        const btn = el(
          'button',
          'flex items-center gap-2 text-left',
          el('span', 'badge badge-ghost badge-xs shrink-0', text(String(suggestion.stepIndex + 1))),
          el('span', 'font-mono text-xs truncate', text(pathLabel(suggestion.pointer))),
          el('span', 'grow'),
          // The type distinguishes between two similarly-named pointers far better than
          // the step number does: `/id` integer isn't `/id` string.
          suggestion.preview
            ? el('span', 'font-mono text-xs text-faint shrink-0', text(suggestion.preview))
            : null,
          el(
            'span',
            'text-xs text-faint shrink-0',
            text(suggestion.observed ? t('scenario.uses.observed') : t('scenario.uses.declared')),
          ),
        )
        btn.type = 'button'
        btn.dataset.suggestPointer = suggestion.pointer
        btn.addEventListener('click', () => {
          dropdown.close()
          this.#applySuggestion(name, suggestion)
        })
        return el('li', 'max-w-full', btn)
      }),
    )
    return dropdown.details
  }

  // The extraction is written into the step THAT PRODUCES the value, under the
  // name the consuming step expects — that's all that was missing for the
  // chain to close.
  #applySuggestion(name, { stepIndex, pointer, source }) {
    this.#commit((next) => {
      const target = { ...next.steps[stepIndex] }
      const extract = [...(target.extract ?? [])]
      const row = { name, source, pointer, persist: false, sensitive: false }
      // A second click fixes the pointer instead of adding a duplicate that the
      // run would resolve in an arbitrary order.
      const existing = extract.findIndex((line) => line.name === name)
      if (existing >= 0) extract[existing] = { ...extract[existing], ...row }
      else extract.push(row)
      target.extract = extract
      next.steps[stepIndex] = target
    })
    this.#actions?.notify?.('success', t('scenario.uses.chained', { name, index: stepIndex + 1 }))
  }

  // Chaining and checks (§5.4): reserved for local scenarios — a
  // scenario provided by the docs isn't edited in place, it's duplicated.
  #chainEditor(step, index) {
    const editor = stepChainEditor(step, {
      response: this.#responses.get(step.id) ?? null,
      op: this.#ops.get(step.opId) ?? null,
      open: this.#openEditors.has(step.id),
      ui: this.#editorState(step.id),
      update: (mutate) =>
        this.#commit((next) => {
          const copy = { ...next.steps[index] }
          mutate(copy)
          next.steps[index] = copy
        }),
    })
    editor.addEventListener('toggle', () => {
      if (editor.open) this.#openEditors.add(step.id)
      else this.#openEditors.delete(step.id)
    })
    return editor
  }

  // The stored object IS the one the editor reads and mutates: a snapshot copied at
  // construction time would make `state` stale from the first tab change onward,
  // and the status selector would no longer refresh anything.
  #editorState(stepId) {
    const state = this.#editorUi.get(stepId) ?? {}
    this.#editorUi.set(stepId, state)
    return { state, patch: (values) => Object.assign(state, values) }
  }

  #summaryBar() {
    if (!this.#summary) return null
    const { counts, total, durationMs, persist } = this.#summary
    const bar = el(
      'div',
      `alert ${this.#summary.ok ? 'alert-success' : 'alert-error'} flex flex-wrap items-center gap-3`,
      el('span', '', text(t('scenario.summary', { ok: counts.ok, total, ms: durationMs }))),
    )
    bar.setAttribute('role', 'status')
    if (persist.length && this.#actions?.persist) {
      const btn = el('button', 'btn btn-sm', text(t('scenario.persist', { count: persist.length })))
      btn.type = 'button'
      btn.addEventListener('click', async () => {
        btn.disabled = true
        await this.#actions.persist(persist)
        // Written once: the button disappears and the prerequisites are re-read
        // against the up-to-date environment.
        this.#summary = { ...this.#summary, persist: [] }
        this.#refresh()
      })
      bar.append(btn)
    }
    return bar
  }

  #stepActions(step, index, scenario, local) {
    if (!local) return []
    const move = (delta) => {
      const btn = el('button', 'btn btn-ghost btn-xs btn-square', text(delta < 0 ? '↑' : '↓'))
      btn.type = 'button'
      btn.disabled = delta < 0 ? index === 0 : index === scenario.steps.length - 1
      btn.setAttribute('aria-label', t(delta < 0 ? 'scenario.moveUp' : 'scenario.moveDown'))
      btn.addEventListener('click', () =>
        this.#commit((next) => {
          const [moved] = next.steps.splice(index, 1)
          next.steps.splice(index + delta, 0, moved)
        }),
      )
      return btn
    }
    const item = (label, onClick, classes = '') => {
      const btn = el('button', classes, text(label))
      btn.type = 'button'
      btn.addEventListener('click', () => {
        menu.close()
        onClick()
      })
      return el('li', '', btn)
    }
    const summary = el('summary', 'btn btn-ghost btn-xs btn-square')
    summary.innerHTML = DOTS_SVG
    summary.setAttribute('aria-label', t('scenario.stepMenu'))
    const list = el(
      'ul',
      'dropdown-content menu menu-sm bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-64 p-1',
    )
    const menu = detailsDropdown('dropdown-end', summary, list)
    list.append(
      item(
        t('scenario.deleteStep'),
        () => this.#commit((next) => next.steps.splice(index, 1)),
        'text-error',
      ),
    )
    // Round trip to the try-it: the two gestures of step editing, done
    // ten times per scenario. Under the ⋮ menu they cost two clicks each;
    // here they're in the row — the outgoing one spelled out, the rest as
    // icons whose label stays as a tooltip.
    return [
      this.#openStepButton(step, scenario),
      this.#updateStepButton(step, index),
      move(-1),
      move(1),
      menu.details,
    ]
  }

  // Written out, unlike its neighbours: an icon for "send this step to the
  // panel" reads as decoration, and it's the gesture the whole editing loop
  // starts with — so it wears the words and the primary color.
  #openStepButton(step, scenario) {
    const btn = el('button', 'btn btn-xs btn-primary', text(t('scenario.openInTryIt')))
    btn.type = 'button'
    btn.dataset.stepAction = 'open'
    btn.addEventListener('click', () => this.#actions?.openStep(step, scenario))
    return btn
  }

  #updateStepButton(step, index) {
    return iconAction('update', t('scenario.updateFromTryIt'), () => this.#recapture(step, index))
  }

  // Recapture: the panel must be on the same operation, otherwise we'd
  // record the request of another endpoint without saying so.
  #recapture(step, index) {
    const request = this.#actions?.recaptureStep(step)
    if (!request) {
      this.#actions?.notify?.('error', t('scenario.recaptureNeedsPanel'))
      return
    }
    this.#commit((next) => {
      next.steps[index] = { ...next.steps[index], request }
    })
    this.#actions?.notify?.('success', t('scenario.stepUpdated'))
  }

  // Auto run: the report fills in step by step, in place on the timeline.
  async #run(scenario) {
    this.beginRun()
    try {
      await this.#actions.run(scenario, {
        proxy: this.#proxyOn,
        onStep: (result) => this.pushStepResult(result),
      })
    } catch (err) {
      console.error('[api-doc] scenario run failed:', err)
      this.#actions?.notify?.('error', t('scenario.runError'))
    }
    this.endRun()
  }
}

// The step's request line, the row's visual anchor: what this step will SEND — method, path with the captured values in
// place, query string — with `{{var}}` templates left visible, since the
// chaining is exactly what the reader is here to follow. Headers and body
// stay out on purpose: a captured Authorization header has no business on a
// reading surface, and the body already has the try-it round trip.
function requestAnchor(op, step) {
  if (!op) return null
  const request = step.request ?? {}
  // An array or map value is a legal parameter (style/explode serializes it
  // at send time); here it only has to read.
  const asText = (value) =>
    Array.isArray(value)
      ? value.join(',')
      : value && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
  const path = op.path.replace(/\{([^{}]+)\}/g, (match, name) => {
    const value = request.path?.[name]
    return value === undefined || value === '' ? match : asText(value)
  })
  const query = Object.entries(request.query ?? {})
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([name, value]) => `${name}=${asText(value)}`)
  if (request.queryString) query.push(request.queryString)
  const line = `${(op.method ?? '').toUpperCase()} ${path}${query.length ? `?${query.join('&')}` : ''}`
  const anchor = el('div', 'api-code-panel px-3 py-2 text-xs break-all', text(line))
  anchor.dataset.stepRequest = ''
  return anchor
}

// The pointer as it reads (§5.4): dotted notation, and a word rather
// than a bare separator when the extraction takes the whole body.
function pathLabel(pointer) {
  return pointerToPath(pointer) || t('scenario.chain.wholeBody')
}

// A header extraction doesn't designate a path in the body but a header
// name: nothing to translate.
function sourceLabel(extract) {
  return extract.source === 'header' ? extract.pointer : pathLabel(extract.pointer)
}

function iconAction(name, label, onClick) {
  const btn = el('button', 'btn btn-ghost btn-xs btn-square', icon(name))
  btn.type = 'button'
  btn.title = label
  btn.setAttribute('aria-label', label)
  btn.dataset.stepAction = name
  btn.addEventListener('click', onClick)
  return btn
}

function expectChips(expect) {
  if (!expect) return []
  const chips = []
  if (expect.status !== undefined) {
    chips.push(el('span', 'badge badge-outline badge-sm font-mono', text(String(expect.status))))
  }
  for (const assertion of activeAssertions(expect)) {
    // A query is shown verbatim: `pathLabel` translates a JSON pointer into
    // the editor's dotted notation, and running an RFC 9535 expression through
    // it would display something that is neither language.
    if (assertion.op === 'matches') {
      chips.push(el('span', 'badge badge-outline badge-sm font-mono', text(`${assertion.query} ?`)))
      continue
    }
    const path = pathLabel(assertion.pointer)
    const label =
      assertion.op === 'equals'
        ? `${path} = ${assertion.value}`
        : assertion.op === 'regex'
          ? `${path} ~ /${assertion.value}/`
          : `${path} ?`
    chips.push(el('span', 'badge badge-outline badge-sm font-mono', text(label)))
  }
  return chips
}

if (!customElements.get('api-scenario-view'))
  customElements.define('api-scenario-view', ApiScenarioView)
