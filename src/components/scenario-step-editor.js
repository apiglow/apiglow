import { t } from '../i18n/index.js'
import { parseJsonBody } from '../scenarios/evaluate.js'
import {
  chainableResponses,
  preferredResponse,
  responseLeaves,
  schemaLeaves,
  variableNameFor,
} from '../scenarios/inspect.js'
import { normalizeExpect } from '../scenarios/model.js'
import { pathToPointer, pointerToPath, resolvePointer } from '../scenarios/pointer.js'
import { linkTabPanel, wireTablist } from './a11y.js'
import { el, text } from './dom.js'
import { statusColorClass } from './method-colors.js'

// Step chaining editor (docs/scenarios.md §5.4) — the signature gesture:
// a response's keys are displayed clickable, a click creates the extraction (or
// the assertion) pre-filled. Two sources of keys, same gesture:
//   • the last known response — real values, real keys;
//   • the operation's declared SCHEMA — available before any send, and which
//     also shows the optional fields absent from the observed body.
// Manual pointer entry remains there for what neither of the two shows.
//
// `update(mutate)` receives a copy of the step to mutate; the view commits.
// `ui` carries the chosen tab and status: the view re-renders on every
// write, and a click on a schema key must not send the user back
// to the response tab.

const INDENT_PX = 12

export function stepChainEditor(
  step,
  { response = null, op = null, update, open = false, ui = null },
) {
  const body = el('div', 'flex flex-col gap-3 pt-2')
  const summary = el(
    'summary',
    'cursor-pointer text-xs font-bold uppercase text-subtle select-none',
    text(t('scenario.chain.title')),
  )
  const details = el('details', 'border-t border-base-200 pt-2', summary, body)
  details.dataset.stepEditor = ''

  const addExtract = (pointer, { source = 'body' } = {}) =>
    update((next) => {
      next.extract = [
        ...next.extract,
        {
          name: uniqueName(next.extract, variableNameFor(pointer)),
          source,
          pointer,
          persist: false,
          sensitive: false,
        },
      ]
    })

  // Without an observed value, the assertion can only be an "exists": an
  // example value pulled from the schema would produce a "= "string"" that
  // nobody wanted and that nothing flags. `null` IS an observed value: it's
  // written as "null", the way the loose comparator will read it (`String(null)`) —
  // folding it onto '' would produce an assertion no response satisfies.
  const addAssertion = (pointer, value) =>
    update((next) => {
      const expect = next.expect ?? { status: undefined, assertions: [] }
      const assertion =
        value === undefined
          ? { pointer, op: 'exists' }
          : { pointer, op: 'equals', value: String(value) }
      next.expect = { ...expect, assertions: [...(expect.assertions ?? []), assertion] }
    })

  // The content is only built once the block is opened: the timeline
  // re-renders on every write, and a response's clickable tree (up to 150
  // lines, parsed body) must not be built only to be thrown away without
  // having been looked at.
  const fill = () => {
    if (body.childElementCount) return
    body.append(
      sourcesBlock(step, { response, op, ui, addExtract, addAssertion }),
      extractBlock(step, { update, addExtract }),
      expectBlock(step, { update }),
    )
  }
  details.addEventListener('toggle', () => details.open && fill())
  if (open) {
    details.open = true
    fill()
  }
  return details
}

// --- clickable keys: observed response and declared schema --------------------

function sourcesBlock(step, { response, op, ui, addExtract, addAssertion }) {
  const box = el('div', 'flex flex-col gap-1')
  box.dataset.chainSources = ''
  const declared = chainableResponses(op)
  const panes = []
  if (response)
    panes.push({
      key: 'response',
      pane: responsePane(response, {
        addExtract,
        addAssertion,
        place: `chain:${step.id}:response`,
      }),
    })
  if (declared.length)
    panes.push({
      key: 'schema',
      pane: schemaPane(step, declared, {
        ui,
        addExtract,
        addAssertion,
        place: `chain:${step.id}:schema`,
      }),
    })
  if (!panes.length) {
    box.append(el('p', 'text-xs text-subtle', text(t('scenario.chain.noResponse'))))
    return box
  }
  // A single tab isn't something to choose: the bar only appears if there
  // really are two possible readings of the same step.
  if (panes.length > 1) {
    const wanted = panes.findIndex((entry) => entry.key === ui?.state?.tab)
    const tabs = el('div', 'tabs tabs-box tabs-xs self-start')
    tabs.setAttribute('role', 'tablist')
    const select = (index) => {
      panes.forEach((entry, i) => {
        entry.pane.classList.toggle('hidden', i !== index)
        entry.tab.classList.toggle('tab-active', i === index)
      })
      activate(index)
      ui?.patch({ tab: panes[index].key })
    }
    for (const entry of panes) {
      entry.tab = el('button', 'tab', text(t(`scenario.chain.tab.${entry.key}`)))
      entry.tab.type = 'button'
      entry.tab.dataset.chainTab = entry.key
      tabs.append(entry.tab)
      // One pane per tab here (both are in the DOM, one hidden), so each pair
      // is linked on its own rather than through a single shared panel.
      linkTabPanel([entry.tab], entry.pane)
    }
    const activate = wireTablist(
      tabs,
      panes.map((entry) => entry.tab),
      select,
    )
    box.append(tabs)
    for (const entry of panes) box.append(entry.pane)
    select(wanted < 0 ? 0 : wanted)
    return box
  }
  for (const entry of panes) box.append(entry.pane)
  return box
}

function responsePane(response, { addExtract, addAssertion, place }) {
  const parsed = parseJsonBody(response)
  const box = el(
    'div',
    'flex flex-col gap-1',
    el(
      'div',
      'flex flex-wrap items-center gap-2 text-xs',
      el('span', 'font-bold uppercase text-subtle', text(t('scenario.chain.responseTitle'))),
      response.status
        ? el(
            'span',
            `font-mono font-bold ${statusColorClass(response.status)}`,
            text(String(response.status)),
          )
        : null,
      el(
        'span',
        'text-subtle',
        text(parsed.ok ? t('scenario.chain.responseHint') : t('scenario.chain.notJson')),
      ),
    ),
  )
  box.dataset.chainPane = 'response'
  if (!parsed.ok) return box
  const { rows, truncated } = responseLeaves(parsed.value)
  if (!rows.length) {
    box.append(el('p', 'text-xs text-subtle', text(t('scenario.chain.emptyBody'))))
    return box
  }
  box.append(
    leafList(rows, {
      onExtract: (row) => addExtract(row.pointer),
      // Read by the resolver that will evaluate it at run time: the preview and the verdict
      // can't tell two different stories.
      onAssert: (row) => addAssertion(row.pointer, resolvePointer(parsed.value, row.pointer).value),
      assertTitle: (key) => t('scenario.chain.assertHere', { key }),
      place,
    }),
  )
  if (truncated) box.append(el('p', 'text-xs text-subtle', text(t('scenario.chain.truncated'))))
  return box
}

function schemaPane(step, responses, { ui, addExtract, addAssertion, place }) {
  const box = el('div', 'flex flex-col gap-1')
  box.dataset.chainPane = 'schema'
  const body = el('div', 'flex flex-col gap-1')

  // The chosen status does NOT write `expect.status`: a 404's schema is
  // consulted to understand an error much more often than to decide that
  // the step must fail.
  const pick = () => {
    const wanted = ui?.state?.schemaStatus
    return (
      responses.find((r) => r.status === wanted) ??
      preferredResponse(responses, step.expect?.status)
    )
  }

  const header = el(
    'div',
    'flex flex-wrap items-center gap-2 text-xs',
    el('span', 'font-bold uppercase text-subtle', text(t('scenario.chain.schemaTitle'))),
  )
  if (responses.length > 1) {
    const select = el('select', 'select select-xs w-auto font-mono')
    for (const response of responses) {
      const option = el('option', '', text(response.status))
      option.value = response.status
      option.selected = response.status === pick()?.status
      select.append(option)
    }
    select.setAttribute('aria-label', t('scenario.chain.schemaStatus'))
    select.dataset.chainSchemaStatus = ''
    select.addEventListener('change', () => {
      ui?.patch({ schemaStatus: select.value })
      render()
    })
    header.append(select)
  } else {
    header.append(el('span', 'font-mono text-subtle', text(responses[0].status)))
  }
  header.append(el('span', 'text-subtle', text(t('scenario.chain.schemaHint'))))
  box.append(header, body)

  const render = () => {
    const response = pick()
    const parts = []
    if (response?.headers.length) {
      parts.push(
        el('span', 'text-xs font-bold uppercase text-subtle', text(t('scenario.chain.headers'))),
        leafList(
          response.headers.map((header) => ({
            pointer: header.name,
            label: header.name,
            depth: 0,
            container: false,
            preview: header.preview,
            required: header.required,
          })),
          {
            onExtract: (row) => addExtract(row.pointer, { source: 'header' }),
            // Assertions only evaluate the body (evaluate.js): offering
            // a ✓ on a header would promise a check that wouldn't
            // happen.
            onAssert: null,
            place: `${place}:headers`,
          },
        ),
      )
    }
    // Multiple media types: the first declared, as everywhere else
    // (normalizeContent). Offering a choice here would make a third
    // selector for a case almost no spec runs into.
    const schema = response?.contents[0]?.schema ?? null
    const { rows, truncated } = schemaLeaves(schema)
    if (rows.length) {
      parts.push(
        leafList(rows, {
          onExtract: (row) => addExtract(row.pointer),
          onAssert: (row) => addAssertion(row.pointer),
          assertTitle: (key) => t('scenario.chain.assertExists', { key }),
          place,
        }),
      )
      if (truncated) parts.push(el('p', 'text-xs text-subtle', text(t('scenario.chain.truncated'))))
    } else if (!response?.headers.length) {
      parts.push(el('p', 'text-xs text-subtle', text(t('scenario.chain.emptyBody'))))
    }
    body.replaceChildren(...parts)
  }
  render()
  return box
}

// One row = one clickable pointer, whatever its origin. A null `onAssert`
// removes the check (headers), a `dynamic` row carries no action at all: no
// pointer exists for a key that will only be known at run time.
//
// Two things the first version got wrong, both reported from use:
//   • the assertion was a lone `✓` at icon size, at the end of a long line —
//     nobody found it. Both gestures are now a fixed pair of buttons opening
//     every row, at the same x whatever the depth: nothing to hunt for, and a
//     series of extractions is clicked straight down a single column;
//   • the eye lost the line between the key and an action flung to the right
//     edge. The pair now precedes the key it acts on, and the row is a band
//     that lights up under the pointer and under keyboard focus.
// The key itself stays clickable — the one-click shortcut for the frequent
// gesture, extraction.
function leafList(rows, { onExtract, onAssert, assertTitle = () => '', place }) {
  // `overflow-auto`, not `-y`: on a narrow panel a deep row stops fitting, and
  // the list is what scrolls — never the page.
  const list = el('div', 'rounded-box bg-base-200/50 p-1 max-h-72 overflow-auto flex flex-col')
  // Clicking a row rewrites the step, and the whole view re-renders in answer:
  // without a place to come back to, every extraction would drop the reader at
  // the top of the list — exactly where the deep key they were working through
  // is not (`keepPlace`).
  list.dataset.keepScroll = place
  for (const row of rows) {
    const extractTitle = t('scenario.chain.extractHere', { key: row.label })
    let key
    if (row.dynamic) {
      key = el('span', 'font-mono text-xs text-faint', text(row.label))
    } else {
      // Colored, not just underlined on hover: it's the central gesture of
      // chaining, it must look clickable at first glance.
      key = el(
        'button',
        'link link-primary link-hover font-mono text-xs shrink-0 text-start',
        text(row.label),
      )
      key.type = 'button'
      key.title = extractTitle
      key.dataset.keepFocus = `${place}:key:${row.pointer}`
      key.addEventListener('click', () => onExtract(row))
    }
    // The schema says what can be missing; an observed response, for its part,
    // doesn't tell us anything about that (`required` absent = no marker).
    const optional =
      row.required === false ? el('span', 'font-mono text-xs text-faint', text('?')) : null
    if (optional) optional.title = t('scenario.chain.optional')

    const extract = actionButton('↳', extractTitle, () => onExtract(row))
    const check = onAssert ? actionButton('✓', assertTitle(row.label), () => onAssert(row)) : null
    const actions = el('div', 'flex shrink-0 gap-1', extract.node, check?.node)
    // An unavailable action is hidden, not greyed: a column of dead buttons is
    // noise on every row it appears in. `visibility: hidden` keeps the slot —
    // which is what holds the keys of the tree on a single vertical line — and
    // takes the control out of reach of the pointer, the keyboard and the
    // accessibility tree in one go.
    const hide = (node) => node.classList.add('invisible')
    if (row.dynamic) {
      // No pointer exists for a key only known at run time: nothing to act on.
      hide(actions)
    } else {
      extract.button.dataset.extractPointer = row.pointer
      // The row the click was aimed at is destroyed by the re-render it
      // triggers: named here, the keyboard comes back to the same button
      // instead of to `<body>` (rule 15).
      extract.button.dataset.keepFocus = `${place}:extract:${row.pointer}`
      if (check && row.container) {
        // An assertion on a container would compare two serialized JSON: not very
        // readable, and never what we actually want to check.
        hide(check.node)
      } else if (check) {
        check.button.dataset.assertPointer = row.pointer
        check.button.dataset.keepFocus = `${place}:assert:${row.pointer}`
      }
    }
    // Only the key and its value are indented: the buttons open the row from a
    // fixed left edge, so depth never moves them.
    const tree = el(
      'div',
      'flex items-center gap-2 min-w-0 grow',
      // The `?` is stuck to the key, without the row's `gap`: "status?" reads
      // as one block, "status ?" looks like a question asked of the value.
      el('span', 'flex items-baseline shrink-0', key, optional),
      // Wrapped rather than truncated: a preview is capped at 60 characters
      // upstream (`inspect.js`), so it costs two lines at worst, and at 320 px
      // an ellipsis left 36 % of an enum on screen — `: "available" | "pen…`,
      // which names neither the values nor how many there are (WCAG 1.4.10,
      // `reflow.spec.js`). Wider than that it never wraps at all.
      el(
        'span',
        'font-mono text-xs text-faint min-w-0 break-all',
        text(row.dynamic ? `: ${t('scenario.chain.dynamicKeys')}` : `: ${row.preview}`),
      ),
    )
    // Depth as inline style: no dynamically built Tailwind class (rule 2).
    tree.style.paddingInlineStart = `${row.depth * INDENT_PX}px`
    const line = el(
      'div',
      // base-100 rather than a darker base: the list sits on base-200, so the
      // hovered row reads as lifted out of it — and it stays a distinct band in
      // dark themes, where base-100 is the darkest of the three.
      'flex items-center gap-2 min-w-0 rounded-field px-1 py-0.5 hover:bg-base-100 focus-within:bg-base-100',
      actions,
      tree,
    )
    list.append(line)
  }
  return list
}

// Icon-only, so the label lives in `aria-label` (the accessible name) and in a
// daisyUI tooltip — and it names the key it applies to, because a column of
// identical "extract" says nothing on its own. Tooltip to the right: it opens
// over the list, which is wide, and never past the top or bottom edge of a box
// that scrolls and would clip it.
//
// The wrapper is daisyUI's own structure (`.tooltip` positions, `:has(:focus-visible)`
// reveals on keyboard focus — neither works with the class on the button itself),
// so the caller gets both: the node to place in the row, and the button to
// address.
function actionButton(glyph, title, onClick) {
  const button = el('button', 'btn btn-xs btn-square font-normal', text(glyph))
  button.type = 'button'
  button.setAttribute('aria-label', title)
  button.addEventListener('click', onClick)
  const node = el('div', 'tooltip tooltip-right', button)
  node.dataset.tip = title
  return { node, button }
}

// --- extractions ------------------------------------------------------------

function extractBlock(step, { update, addExtract }) {
  const box = el(
    'div',
    'flex flex-col gap-1',
    el('span', 'text-xs font-bold uppercase text-subtle', text(t('scenario.chain.extracts'))),
  )
  step.extract.forEach((extract, index) => {
    const commit = (patch) =>
      update((next) => {
        next.extract = next.extract.map((row, i) => (i === index ? { ...row, ...patch(row) } : row))
      })

    const name = field(extract.name, t('scenario.chain.name'), 'w-32', (value) =>
      commit(() => ({ name: value.trim() })),
    )
    // A header is identified by its name, not by a path: it alone is entered
    // and read back raw (§5.4). A query is a third answer to the same question
    // — where and how the value is read — even though the model spells it as
    // the body plus a `query`, so the selector carries it and the model does
    // not gain a third `source`.
    const header = extract.source === 'header'
    const query = typeof extract.query === 'string'
    const target = query
      ? field(extract.query, t('scenario.chain.query'), 'grow min-w-24', (value) =>
          commit(() => ({ query: value })),
        )
      : field(
          header ? extract.pointer : pointerToPath(extract.pointer),
          header ? t('scenario.chain.header') : t('scenario.chain.pointer'),
          'grow min-w-24',
          (value) => commit(() => ({ pointer: header ? value.trim() : pathToPointer(value) })),
        )
    const source = el('select', 'select select-xs w-auto')
    for (const value of ['body', 'header', 'query']) {
      const option = el('option', '', text(t(`scenario.chain.source.${value}`)))
      option.value = value
      option.selected = value === 'query' ? query : !query && extract.source === value
      source.append(option)
    }
    source.setAttribute('aria-label', t('scenario.chain.source'))
    source.addEventListener('change', () =>
      // The two addressing fields are exclusive: switching drops the one that
      // no longer applies rather than leaving a value the model would ignore.
      commit(() =>
        source.value === 'query'
          ? { source: 'body', query: '', pointer: undefined }
          : { source: source.value, query: undefined },
      ),
    )

    const persist = toggle(
      extract.persist,
      t('scenario.chain.persist'),
      t('scenario.chain.persistHelp'),
      (checked) =>
        // Same rule as the model: whatever goes into auth.* is a credential.
        commit((row) => ({
          persist: checked,
          sensitive: row.sensitive || (checked && row.name.startsWith('auth.')),
        })),
    )
    const sensitive = toggle(
      extract.sensitive,
      t('scenario.chain.sensitive'),
      t('scenario.chain.sensitiveHelp'),
      (checked) => commit(() => ({ sensitive: checked })),
    )
    const remove = iconButton(t('scenario.chain.remove'), () =>
      update((next) => (next.extract = next.extract.filter((_, i) => i !== index))),
    )
    const row = el(
      'div',
      'flex flex-wrap items-center gap-1',
      el('span', 'font-mono text-xs text-faint', text('{{')),
      name,
      el('span', 'font-mono text-xs text-faint', text('}} ←')),
      source,
      target,
      persist,
      sensitive,
      remove,
    )
    row.dataset.extractRow = String(index)
    box.append(row)
  })
  const add = el('button', 'btn btn-xs btn-ghost self-start', text(t('scenario.chain.addExtract')))
  add.type = 'button'
  add.dataset.addExtract = ''
  add.addEventListener('click', () => addExtract(''))
  box.append(add)
  return box
}

// --- success criteria -----------------------------------------------------

function expectBlock(step, { update }) {
  const assertions = step.expect?.assertions ?? []
  // A single write gate for the block, and it's the model's normalization
  // that decides the stored shape (status coerced, `expect` cleared when
  // it no longer says anything) — same as when reloading from storage.
  const commit = (mutate) =>
    update((next) => {
      const draft = { status: step.expect?.status, assertions: [...assertions] }
      mutate(draft)
      next.expect = normalizeExpect(draft)
    })
  const status = el('input', 'input input-xs w-24 font-mono')
  status.value = step.expect?.status === undefined ? '' : String(step.expect.status)
  status.placeholder = t('scenario.chain.statusAny')
  status.setAttribute('aria-label', t('scenario.chain.status'))
  status.addEventListener('change', () => commit((draft) => (draft.status = status.value.trim())))

  // Not part of `expect` — it is a step field, and it writes through `update`
  // rather than the block's `commit`. It sits on this row anyway because it
  // decides the same thing the status does: whether the step passed.
  const timeout = el('input', 'input input-xs w-24 font-mono')
  timeout.type = 'number'
  timeout.min = '1'
  timeout.value = step.timeout === undefined ? '' : String(step.timeout)
  timeout.placeholder = t('scenario.chain.timeoutNone')
  timeout.setAttribute('aria-label', t('scenario.chain.timeout'))
  timeout.addEventListener('change', () =>
    update((next) => {
      const raw = timeout.value.trim()
      next.timeout = raw === '' ? undefined : Number(raw)
    }),
  )

  const box = el(
    'div',
    'flex flex-col gap-1',
    el(
      'div',
      'flex flex-wrap items-center gap-2',
      el('span', 'text-xs font-bold uppercase text-subtle', text(t('scenario.chain.expect'))),
      el('span', 'text-xs text-subtle', text(t('scenario.chain.status'))),
      status,
      el('span', 'text-xs text-subtle', text(t('scenario.chain.timeout'))),
      timeout,
    ),
  )
  assertions.forEach((assertion, index) => {
    const patch = (values) =>
      commit((draft) => {
        draft.assertions = draft.assertions.map((row, i) =>
          i === index ? { ...row, ...values(row) } : row,
        )
      })
    // A query and a path are two languages, so they get two fields and only
    // one is ever shown: the ✓ picker fills a path and means nothing for a
    // query, and leaving it there inert would invite it to be typed into.
    const target =
      assertion.op === 'matches'
        ? field(assertion.query ?? '', t('scenario.chain.query'), 'grow min-w-24', (value) =>
            patch(() => ({ query: value })),
          )
        : field(
            pointerToPath(assertion.pointer),
            t('scenario.chain.pointer'),
            'grow min-w-24',
            (value) => patch(() => ({ pointer: pathToPointer(value) })),
          )
    const op = el('select', 'select select-xs w-auto')
    for (const value of ['exists', 'equals', 'regex', 'matches']) {
      const option = el('option', '', text(t(`scenario.chain.op.${value}`)))
      option.value = value
      option.selected = assertion.op === value
      op.append(option)
    }
    op.setAttribute('aria-label', t('scenario.chain.op'))
    op.addEventListener('change', () => patch((row) => ({ op: op.value, value: row.value ?? '' })))
    // Same slot, two meanings: a literal to compare against, or a pattern to
    // match. Only the label separates them, so it is not decoration.
    const value =
      assertion.op === 'equals' || assertion.op === 'regex'
        ? field(
            assertion.value ?? '',
            assertion.op === 'regex' ? t('scenario.chain.pattern') : t('scenario.chain.value'),
            'w-28',
            (raw) => patch(() => ({ value: raw })),
          )
        : null
    const remove = iconButton(t('scenario.chain.remove'), () =>
      commit((draft) => {
        draft.assertions = draft.assertions.filter((_, i) => i !== index)
      }),
    )
    const row = el('div', 'flex flex-wrap items-center gap-1', target, op, value, remove)
    row.dataset.assertionRow = String(index)
    box.append(row)
  })
  const add = el(
    'button',
    'btn btn-xs btn-ghost self-start',
    text(t('scenario.chain.addAssertion')),
  )
  add.type = 'button'
  add.dataset.addAssertion = ''
  add.addEventListener('click', () =>
    commit((draft) => draft.assertions.push({ pointer: '', op: 'exists' })),
  )
  box.append(add)
  return box
}

// --- small controls -------------------------------------------------------

function field(value, label, classes, onChange) {
  const input = el('input', `input input-xs font-mono ${classes}`)
  input.value = value ?? ''
  input.placeholder = label
  input.setAttribute('aria-label', label)
  // Like the scenario name: commit on change (blur/Enter), not on keystroke —
  // every write re-renders the view and would carry off the focus.
  input.addEventListener('change', () => onChange(input.value))
  return input
}

function toggle(checked, label, help, onChange) {
  const input = el('input', 'checkbox checkbox-xs')
  input.type = 'checkbox'
  input.checked = checked === true
  input.addEventListener('change', () => onChange(input.checked))
  const wrap = el('label', 'label text-xs gap-1 cursor-pointer', input, text(label))
  wrap.title = help
  return wrap
}

function iconButton(label, onClick) {
  const btn = el('button', 'btn btn-ghost btn-xs px-1 text-error', text('✕'))
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.addEventListener('click', onClick)
  return btn
}

function uniqueName(extracts, wanted) {
  const taken = new Set(extracts.map((e) => e.name))
  if (!taken.has(wanted)) return wanted
  for (let i = 2; ; i += 1) {
    const candidate = `${wanted}${i}`
    if (!taken.has(candidate)) return candidate
  }
}
