// The try-it panel's response area: the runs bar, the schema example
// mockup, the real response and the network-failure view — everything
// below the send button.
//
// It is deliberately OUTSIDE the doc↔panel mirror (rule 20): nothing here
// is an editable surface, so none of it belongs to `currentValues()` /
// `#applyTryItValues()`. What it does own is the state of what is being
// looked at (which run, which view, the draft set aside) — hence a
// controller with its own bindings rather than free functions. The panel
// keeps every write to that state going through this object; the three
// methods `resetForOp` / `forgetLastRendered` / `clearDraft` exist because
// the panel's own lifecycle (operation change, re-render, send) is what
// invalidates each piece.
//
// Everything it needs from the panel arrives as a callback: `op`, `state`
// and the response container are replaced on every render, and a captured
// value would go stale on the first operation change.

import { envBadgeClass } from '../../env/colors.js'
import { t } from '../../i18n/index.js'
import { displayableExample } from '../../openapi/examples.js'
import { sampleValue } from '../../openapi/sample.js'
import { isXmlMedia, xmlSample } from '../../openapi/sample-xml.js'
import { linkTabPanel, scrollBlock, wireTablist } from '../a11y.js'
import { el, text } from '../dom.js'
import { detailsDropdown } from '../dropdown.js'
import { CARET_SVG, HISTORY_SVG, RESTORE_SVG } from '../icons.js'
import { insightStrip } from '../insight-strip.js'
import { highlightSource, prettyJson } from '../markdown.js'
import { statusColorClass } from '../method-colors.js'
import {
  STATUS_DOT,
  STATUS_PILL,
  alertBox,
  copyIconButton,
  headersView,
  panelToggleButton,
  responseBody,
  runTime,
} from './view-bits.js'

// Number of past calls offered in the response panel's run selector.
// Beyond that, the (filterable) history popup takes over.
const RUN_LIMIT = 20

// Failure verdict → its two strings, static map (rule 2 spirit: the keys are
// written out, so the i18n reachability check sees them). `cors` has three
// readings — the plain one, the one that names the configured-but-off proxy,
// and the one for a call that failed *through* the proxy (§3.1).
const DIAGNOSIS = {
  offline: { label: 'tryit.diag.offline', hint: 'tryit.diag.offlineHint' },
  'mixed-content': { label: 'tryit.diag.mixedContent', hint: 'tryit.diag.mixedContentHint' },
  cors: { label: 'tryit.diag.cors', hint: 'tryit.diag.corsHint' },
  corsProxyOff: { label: 'tryit.diag.cors', hint: 'tryit.diag.corsHintProxyOff' },
  corsProxied: { label: 'tryit.diag.corsProxied', hint: 'tryit.diag.corsProxiedHint' },
  unreachable: { label: 'tryit.diag.unreachable', hint: 'tryit.diag.unreachableHint' },
}

export function createResponseView({
  host,
  op,
  history,
  envStore,
  proxyUrl,
  proxyOn,
  container,
  onOpenHistory,
  snapshotDraft,
  loadEntry,
  restoreDraft,
  // The panel's send pipeline, for the insight strip's two actions: they are
  // ordinary sends of a request built from the stored entry (§4.2).
  sendStored,
}) {
  // Past calls of the endpoint, capped at RUN_LIMIT.
  let runs = []

  // Timestamp of the run shown in the response panel (null = schema
  // example). Serves as the current selection: a freshly sent entry
  // doesn't yet have an IndexedDB id at render time, the timestamp
  // identifies it.
  let shownRunStamp = null

  // Last actual render (HTTP response or network failure), replayable:
  // switching to the example must not be a one-way trip. Reset on panel
  // render, so on every operation change.
  let lastRendered = null

  // Example mockup badges, controllable from the central doc. When the
  // mockup isn't shown, the map points to detached DOM: sync calls become
  // visual no-ops — harmless.
  let exampleControls = null

  // Status badge of a fresh response, waiting for the send box to finish
  // animating: two concurrent animations on the same title bar read as
  // flickering, not as an arrival.
  let pendingFlash = null

  // Draft set aside by viewing an archived call, restorable as long as
  // nothing has been sent nor the operation changed. A single set-aside:
  // chaining through runs must not replace the draft with a previous run.
  let draft = null

  // The bar's content is rebuilt outside the render cycle, on every
  // history write, so its node outlives the view it was built into.
  let runSlot = null

  // All views of the response area (example, real response, network
  // failure) are topped by the runs bar. It is ABOVE the mockup and never
  // inside: the mockup box is overflow-hidden and would crop the list.
  function setResponseView(node) {
    // Any new view invalidates the badge waiting for its glow: the glow
    // must not land on a badge the user is no longer looking at.
    pendingFlash = null
    container().replaceChildren(...[buildRunSlot(), node].filter(Boolean))
  }

  function buildRunSlot() {
    runSlot = el('span', 'inline-flex')
    fillRunSlot()
    return el('div', 'flex justify-end', runSlot)
  }

  function fillRunSlot() {
    const slot = runSlot
    if (!slot) return
    if (!runs.length) {
      slot.replaceChildren()
      return
    }
    const icon = el('span', 'inline-flex')
    icon.innerHTML = HISTORY_SVG
    const caret = el('span', 'inline-flex')
    caret.innerHTML = CARET_SVG
    // Solid button (not ghost): sitting on the app background between two
    // mockups, a dimmed version went unnoticed.
    const summary = el(
      'summary',
      'btn btn-xs gap-1',
      icon,
      text(t('tryit.runs', { n: runs.length })),
      caret,
    )
    summary.title = t('tryit.runsTitle')
    const menu = el(
      'ul',
      'dropdown-content menu menu-xs z-10 w-72 max-h-72 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 text-base-content shadow-lg',
    )
    const { details, close } = detailsDropdown('dropdown-end', summary, menu)
    details.dataset.runSelector = ''
    const fillMenu = () => {
      menu.replaceChildren(...runs.map((run, i) => el('li', '', runItem(run, close, i === 0))))
      const openHistory = onOpenHistory()
      if (!openHistory) return
      const all = el(
        'button',
        'rounded-none border-t border-base-200 text-subtle',
        text(t('tryit.runsAll')),
      )
      all.type = 'button'
      all.addEventListener('click', () => {
        close()
        openHistory(op().id)
      })
      menu.append(el('li', '', all))
    }
    // Labels are relative ("3 min ago"): they'd go stale between two
    // history writes, so they're regenerated on every open.
    details.addEventListener('toggle', () => {
      if (details.open) fillMenu()
    })
    fillMenu()
    slot.replaceChildren(details)
  }

  function runItem(run, close, latest) {
    const failed = !run.response
    const btn = el(
      'button',
      'flex items-center gap-2',
      latest ? el('span', 'badge badge-primary badge-xs', text(t('tryit.runLatest'))) : null,
      el('span', 'text-[11px] text-subtle', text(runTime(run.timestamp))),
      el(
        'span',
        `font-mono text-[11px] font-bold ${failed ? 'text-error' : statusColorClass(run.response.status)}`,
        text(failed ? t('history.filter.error') : String(run.response.status)),
      ),
      failed ? null : el('span', 'text-[11px] text-faint', text(`${run.durationMs} ms`)),
      run.envName
        ? el(
            'span',
            `badge badge-xs ms-auto max-w-24 truncate ${envBadgeClass(envStore().colorOfName(run.envName))}`,
            text(run.envName),
          )
        : null,
    )
    btn.type = 'button'
    btn.title = new Date(run.timestamp).toLocaleString()
    if (run.timestamp === shownRunStamp) btn.classList.add('menu-active')
    btn.addEventListener('click', () => {
      close()
      showRun(run)
    })
    return btn
  }

  // Viewing an archived call: nothing goes back out on the network, the
  // stored response is rendered in the usual mockup (pretty / raw /
  // headers) AND the request is reloaded into the form — otherwise the
  // editor and the snippet would describe one request while the response
  // shows another.
  function showRun(run) {
    // Same snapshot as the step-by-step: without this, viewing an archive
    // would lose the raw query string and the media type being prepared.
    draft ??= snapshotDraft()
    loadEntry(run)
    renderRun(run)
  }

  function renderRun(run) {
    if (run.response) renderResponse(run, { archived: true })
    else renderNetworkError(run, run.request?.url ?? '', { archived: true })
  }

  // Archived views banner: say where what's being read comes from
  // (nothing was resent, and the form is no longer the current draft).
  function archivedLabel(entry) {
    return entry.envName ? `${t('tryit.runArchived')} · ${entry.envName}` : t('tryit.runArchived')
  }

  // Only way out of an archived view: it stands out from the status
  // badges surrounding it (accent, like the send-meter's return) instead
  // of blending into them.
  function restoreDraftButton(className) {
    const icon = el('span', 'shrink-0')
    icon.innerHTML = RESTORE_SVG
    icon.setAttribute('aria-hidden', 'true')
    const btn = el('button', `${className} gap-1`, icon, text(t('tryit.runRestore')))
    btn.type = 'button'
    btn.addEventListener('click', () => {
      // Cleared BEFORE the render: the view that follows must no longer
      // offer to restore a draft that was just put back into the fields.
      const set = draft
      draft = null
      restoreDraft(set)
    })
    return btn
  }

  // Failure before any HTTP response: facts first (raw browser error,
  // targeted request, duration), interpretation (possible causes) after,
  // in a separate alert — never one without the other.
  function renderNetworkError(entry, requestedUrl, { archived = false } = {}) {
    lastRendered = { entry, requestedUrl, archived }
    shownRunStamp = entry.timestamp
    const facts = el(
      'div',
      'flex flex-col gap-1',
      el('span', 'font-bold', text(t('tryit.networkFail'))),
      el('code', 'font-mono break-all', text(entry.error)),
      el(
        'code',
        'font-mono break-all text-quiet',
        text(`${entry.method.toUpperCase()} ${requestedUrl} — ${entry.durationMs} ms`),
      ),
    )
    const factsBox = el('div', 'alert alert-error text-xs py-2 items-start', facts)
    factsBox.setAttribute('role', 'alert')
    // A verdict supersedes the generic "possible causes" help — that text is
    // exactly the question it answers — and with it the standalone proxy hint,
    // which the `cors` reading says better (§3.2). Without one (an entry
    // predating the diagnosis), the panel reads as it always did.
    const verdict = diagnosisBox(entry.diagnosis)
    const messages = [factsBox, verdict ?? alertBox('alert-info', t('tryit.networkFailHelp'))]
    if (!verdict && proxyUrl() && !proxyOn()) {
      messages.push(alertBox('alert-info', t('tryit.corsProxyHint')))
    }
    // Unreachable API: this is precisely where the schema-derived example
    // helps — offered prominently rather than hidden in a header.
    if (op().responses?.length) {
      const btn = el('button', 'btn btn-sm btn-outline self-start', text(t('tryit.showExample')))
      btn.type = 'button'
      btn.addEventListener('click', () => renderExample())
      messages.push(btn)
    }
    // Archived failure: without this banner, the alert would read as a
    // failure that just occurred.
    if (archived) {
      messages.unshift(
        el(
          'div',
          'flex flex-wrap items-center gap-2',
          el('span', 'badge badge-ghost badge-sm', text(archivedLabel(entry))),
          draft ? restoreDraftButton('btn btn-xs btn-accent') : null,
        ),
      )
    }
    setResponseView(el('div', 'flex flex-col gap-2', ...messages))
  }

  // The verdict of the failure, stored at send time and re-read as-is: an
  // archived entry is never re-probed (decision 3). It says "most likely" and
  // means it — a probe proves reachability, never a cause.
  function diagnosisBox(diagnosis) {
    const keys = diagnosisKeys(diagnosis)
    if (!keys) return null
    const box = el(
      'div',
      'alert alert-info text-xs py-2 items-start',
      el(
        'div',
        'flex flex-col gap-1',
        el('span', 'font-bold', text(t(keys.label))),
        el('span', '', text(t(keys.hint))),
        el('span', 'text-quiet', text(t('tryit.diag.note'))),
      ),
    )
    box.setAttribute('role', 'alert')
    return box
  }

  function diagnosisKeys(diagnosis) {
    if (!diagnosis) return null
    const { verdict, proxied } = diagnosis
    if (verdict !== 'cors') return DIAGNOSIS[verdict]
    if (proxied) return DIAGNOSIS.corsProxied
    return proxyUrl() && !proxyOn() ? DIAGNOSIS.corsProxyOff : DIAGNOSIS.cors
  }

  function renderLastRendered() {
    const { entry, requestedUrl, archived } = lastRendered
    if (entry.response) renderResponse(entry, { archived })
    else renderNetworkError(entry, requestedUrl, { archived })
  }

  // Response example mockup: status switcher, schema's
  // declared example (otherwise derived value). Shown when the operation
  // loads, replaced by the real response after sending — both views
  // remain reachable from one another.
  function renderExample() {
    const responses = op().responses ?? []
    exampleControls = null
    shownRunStamp = null
    // Nothing to show from the schema: the area is reduced to the runs
    // bar, itself empty if the endpoint has never been called.
    if (!responses.length) {
      setResponseView(null)
      return
    }
    const header = el(
      'div',
      'flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-white/10',
      el('span', 'text-label uppercase text-white/60', text(t('tryit.response'))),
      el('span', 'text-[11px] text-white/60 italic', text(t('doc.example'))),
      // Return to the real response when there is one: the toggle must be
      // symmetrical, otherwise showing the example loses the send's result.
      lastRendered ? panelToggleButton(t('tryit.showActual'), () => renderLastRendered()) : null,
    )
    const pills = el('div', 'flex items-center gap-1')
    const panel = el('div')

    let shownText = ''
    const renderOne = (response) => {
      const mt =
        response.contents?.find((c) => /json/i.test(c.mediaType ?? '')) ?? response.contents?.[0]
      let value
      const xml = mt ? isXmlMedia(mt.mediaType) : false
      if (mt) {
        const declared = displayableExample(mt.examples)
        // Sequential media type (3.2): the useful example is ONE element of the stream.
        value = declared
          ? declared.value
          : xml
            ? // An XML response is illustrated in XML: a JSON rendering of the
              // same schema shows the fields but not the document.
              xmlSample(mt.itemSchema ?? mt.schema, { forResponse: true }) || undefined
            : sampleValue(mt.itemSchema ?? mt.schema, { forResponse: true })
      }
      if (mt && value !== undefined) {
        shownText = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        const code = el(
          'code',
          `hljs ${xml ? 'language-xml' : 'language-json'} text-xs whitespace-pre`,
        )
        if (typeof value === 'string' && !xml) code.textContent = value
        else code.innerHTML = highlightSource(shownText, xml ? 'xml' : 'json')
        panel.replaceChildren(
          scrollBlock(
            el('pre', 'p-3 text-xs overflow-x-auto max-h-80 overflow-y-auto', code),
            t('a11y.scrollable.code'),
          ),
        )
      } else {
        shownText = ''
        panel.replaceChildren(
          el('p', 'p-3 text-xs text-white/50', text(response.description ?? '')),
        )
      }
    }

    // Which chip is selected is said by its tint and by `aria-pressed`, never
    // by dimming it: an unselected chip is still a status code someone has to
    // read, and an opacity that de-emphasizes it also drops it under the AA
    // contrast floor (§12). The colors it swaps between are whole literals
    // from the static maps (rule 2).
    const colorOf = new Map()
    const activatePill = (response, pill) => {
      for (const sibling of pills.children) {
        sibling.classList.remove(...colorOf.get(sibling).split(' '))
        sibling.classList.add(...STATUS_PILL.muted.split(' '))
        sibling.setAttribute('aria-pressed', 'false')
      }
      pill.classList.remove(...STATUS_PILL.muted.split(' '))
      pill.classList.add(...colorOf.get(pill).split(' '))
      pill.setAttribute('aria-pressed', 'true')
      renderOne(response)
    }
    const controls = new Map()
    responses.forEach((response, i) => {
      const family = String(response.status)[0]
      const pillColor = STATUS_PILL[family] ?? STATUS_PILL.default
      const pill = el(
        'button',
        // Explicit cursor-pointer: Tailwind v4's preflight leaves <button>
        // at cursor:default, nothing indicated these badges were commands.
        `cursor-pointer inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-mono font-bold ${i === 0 ? pillColor : STATUS_PILL.muted}`,
        el('span', `size-1.5 rounded-full shrink-0 ${STATUS_DOT[family] ?? STATUS_DOT.default}`),
        text(String(response.status)),
      )
      pill.type = 'button'
      pill.title = response.description || String(response.status)
      colorOf.set(pill, pillColor)
      pill.setAttribute('aria-pressed', String(i === 0))
      pill.addEventListener('click', () => {
        activatePill(response, pill)
        // Sync with the central doc's status tabs (wired by the shell) —
        // programmatic selection, on the other hand, doesn't emit.
        host.dispatchEvent(
          new CustomEvent('tryit-response-status', {
            bubbles: true,
            detail: { status: String(response.status) },
          }),
        )
      })
      controls.set(String(response.status), () => activatePill(response, pill))
      pills.append(pill)
    })
    exampleControls = controls
    // Badges and copy in the same group: on a narrow panel they wrap
    // together, instead of leaving the copy alone at the bottom.
    header.append(
      el(
        'div',
        'ms-auto flex items-center gap-1',
        pills,
        copyIconButton(() => shownText),
      ),
    )
    renderOne(responses[0])
    setResponseView(el('div', 'api-code-panel overflow-hidden mt-1', header, panel))
  }

  // Response in a dark mockup: header bar (status badge,
  // duration, view switcher) then highlighted JSON body.
  // `fresh`: the response just arrived over the network. Viewing an
  // archive or returning from the example pass through here without
  // notifying anything — the glow announces an event, not a view change.
  function renderResponse(entry, { archived = false, fresh = false } = {}) {
    lastRendered = { entry, requestedUrl: null, archived }
    shownRunStamp = entry.timestamp
    const { response, durationMs } = entry
    const pill = STATUS_PILL[String(response.status)[0]] ?? STATUS_PILL.default
    // The glow is in `currentColor`: the badge already carries the
    // status's color, a glow class per code family would be a
    // dynamically-built class (rule 2).
    const statusPill = el(
      'span',
      `rounded-full px-2 py-0.5 text-[11px] font-mono font-bold ${pill}`,
      text(`${response.status} ${response.statusText ?? ''}`.trim()),
    )
    const header = el(
      'div',
      'flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-white/10',
      el('span', 'text-label uppercase text-white/60', text(t('tryit.response'))),
      statusPill,
      el('span', 'text-[11px] text-white/50', text(t('tryit.duration', { ms: durationMs }))),
      entry.truncatedResponse
        ? el('span', 'text-[11px] text-white/50', text(t('history.truncated')))
        : null,
      op().responses?.length
        ? panelToggleButton(t('tryit.showExample'), () => renderExample())
        : null,
    )
    if (archived) {
      // Native append() would convert a null to the text "null": we filter.
      header.append(
        ...[
          el(
            'span',
            'rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70',
            text(archivedLabel(entry)),
          ),
          draft ? restoreDraftButton('btn btn-xs btn-accent border-0 shadow-md') : null,
        ].filter(Boolean),
      )
    }

    const panel = el('div')
    const views = {
      pretty: () => {
        const pretty = prettyJson(response.body)
        return responseBody(pretty ?? response.body, pretty !== null)
      },
      raw: () => responseBody(response.body, false),
      headers: () => headersView(response.headers),
    }
    const tabDefs = [
      ['pretty', t('tryit.pretty')],
      ['raw', t('tryit.raw')],
      ['headers', t('tryit.respHeaders')],
    ]
    const tabsBox = el('div', 'flex items-center gap-1')
    tabsBox.setAttribute('role', 'tablist')
    // Fixed colors (not btn-ghost alone): the buttons' text would follow
    // the active theme and become unreadable on the navy background in
    // light theme.
    let currentView = 'pretty'
    const tabs = tabDefs.map(([, label]) => {
      const tab = el(
        'button',
        'btn btn-ghost btn-xs text-white/70 hover:text-white hover:bg-white/10 border-0',
        text(label),
      )
      tab.type = 'button'
      tabsBox.append(tab)
      return tab
    })
    const show = (index) => {
      for (const sibling of tabs) {
        sibling.classList.remove('bg-white/15', 'text-white')
        sibling.classList.add('text-white/70')
      }
      tabs[index].classList.add('bg-white/15', 'text-white')
      tabs[index].classList.remove('text-white/70')
      activate(index)
      currentView = tabDefs[index][0]
      panel.replaceChildren(views[currentView]())
    }
    const activate = wireTablist(tabsBox, tabs, show)
    linkTabPanel(tabs, panel)
    // Copies what the active tab DISPLAYS (pretty/raw body, or headers as
    // name: value) — the full exchange remains available via the Debug
    // export right below.
    const visibleText = () => {
      if (currentView === 'headers') {
        return (response.headers ?? []).map(([name, value]) => `${name}: ${value}`).join('\n')
      }
      if (currentView === 'raw') return response.body ?? ''
      return prettyJson(response.body) ?? response.body ?? ''
    }
    header.append(
      el('div', 'ms-auto flex items-center gap-1', tabsBox, copyIconButton(visibleText)),
    )
    show(0)

    // Under the header bar, above the body (§4.3). Absent entirely when the
    // response carries none of the recognized headers, which is the ordinary
    // case: a plain API's panel looks exactly as it did before the feature.
    const strip = insightStrip(entry, {
      surface: 'panel',
      // An archived run's deadlines are spent: they read as the clock time they
      // pointed at, not as a countdown to a past instant.
      live: !archived,
      send: sendStored,
    })
    setResponseView(el('div', 'api-code-panel overflow-hidden mt-1', header, strip, panel))
    // After `setResponseView`, which precisely purges the pending badge.
    // The glow is applied later, when the send box has finished animating.
    if (fresh) pendingFlash = statusPill
  }

  return {
    renderExample,
    renderResponse,
    renderNetworkError,

    // What the panel must say out loud when a send fails. The verdict is part
    // of the outcome, not a decoration on it: a screen reader user otherwise
    // hears that the request failed and never the one sentence explaining it.
    // The view owns the wording — it is the same reading its alert renders.
    networkFailAnnouncement(entry) {
      const keys = diagnosisKeys(entry.diagnosis)
      return keys ? `${t('tryit.networkFail')} ${t(keys.label)}` : t('tryit.networkFail')
    },

    // Example mockup badge driven from the central doc.
    showExample(status) {
      exampleControls?.get(String(status))?.()
    },

    flashFreshStatus() {
      pendingFlash?.classList.add('api-status-flash')
      pendingFlash = null
    },

    async refreshRuns() {
      const store = history()
      if (!store || !op()) return
      // Panel off-screen (route without operation, scenario auto run in
      // progress): re-reading the whole history on every write would show
      // nothing. The render happens again anyway when returning to the
      // operation (#resetFromOp).
      if (!host.isConnected || host.classList.contains('hidden')) return
      const opId = op().id
      let entries
      try {
        entries = await store.list()
      } catch (err) {
        console.error('[api-doc] history read failed:', err)
        return
      }
      // The operation may have changed during the IndexedDB read.
      if (op()?.id !== opId) return
      // Filter by spec: in unscoped multi-spec, `list()` mixes specs and two
      // of them may carry the same opId.
      const specId = store.specId
      runs = entries
        .filter((e) => e.opId === opId && (specId == null || e.specId === specId))
        .slice(0, RUN_LIMIT)
      // Safety net: if the response area doesn't have a bar yet (slot never
      // rendered, or left detached by a view replaced since), rebuild it —
      // otherwise the runs would stay unreachable until the next full render.
      if (runSlot?.isConnected) fillRunSlot()
      else renderExample()
    },

    // New operation: no runs of it read yet, and the draft set aside for
    // the previous one has nowhere to go back to.
    resetForOp() {
      draft = null
      runs = []
    },

    // Panel re-render: the previous operation's replayable response has no
    // business in the new one's example ↔ response toggle.
    forgetLastRendered() {
      lastRendered = null
    },

    // A send makes the form's content the new reference: the draft set
    // aside by viewing an archived call no longer makes sense.
    clearDraft() {
      draft = null
    },
  }
}
