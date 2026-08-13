import { t } from '../i18n/index.js'
import { fileBodyLabel } from '../openapi/body-kind.js'
import { coerceValue } from '../openapi/coerce.js'
import { listDelimiter, toValueEntries, toValueList } from '../openapi/params.js'
import { formatSample } from '../openapi/sample.js'
import { TOP_LAYER_SUPPORTED, anchoredList } from './anchored-list.js'
import { el, text } from './dom.js'

// The form half of the schema view: the widgets that let a schema be FILLED
// IN, as opposed to `schema-view.js` which renders it read-only. The
// dependency is one-way — the renderer imports these editors, never the
// reverse — and rule 20 lives on this side: `tryit-edit` is emitted here and
// nowhere in the renderer, which only threads paths and registries through.

// Beyond this, an enum is "long": its chips are collapsed behind a "+N…"
// button (an enum of 50 values would drown the parameter description) and its
// input field becomes a filterable combobox instead of a select.
export const ENUM_COLLAPSE_THRESHOLD = 7

// Composite nesting explored to decide whether a property reduces to a
// single field (rule 7: the descent is bounded, even on a twisted graph).
const MAX_COMPOSITE_DEPTH = 3

// Leaf editable from the doc: non-cyclic primitive, excluding readOnly
// (never sent in a request body). A composite whose variants are all
// primitives (e.g. `oneOf: [number, integer]`) remains ONE value to enter: a
// single field, typed by the union of the variants — otherwise the property
// wasn't editable anywhere in the doc.
// Dictionary whose keys are data (metadata, labels…): no declared property to
// build a form from, but `additionalProperties` says what a value looks like.
// `additionalProperties: false` closes the object — nothing to edit.
export function isFreeFormMap(schema) {
  return (
    schema?.kind === 'object' &&
    !schema.properties?.length &&
    !schema.circular &&
    !schema.readOnly &&
    !!schema.additionalProperties
  )
}

export function isEditableLeaf(schema, depth = 0) {
  if (!schema || schema.circular || schema.readOnly) return false
  if (schema.kind === 'composite') {
    const variants = schema.composite?.variants ?? []
    return (
      depth < MAX_COMPOSITE_DEPTH &&
      variants.length > 0 &&
      variants.every((v) => isEditableLeaf(v, depth + 1))
    )
  }
  return !['object', 'array', 'never'].includes(schema.kind)
}

// Typed value of a primitive field; '' = undefined (the key/element is
// removed). An HTML field only ever returns strings: without this
// conversion, a `{"amount": "20.51"}` would go out where the schema declares
// a number. A non-convertible value (free text, {{var}} template) is left
// as-is and it's the server that decides.
function coerceLeaf(schema) {
  return (raw) => (raw === '' ? undefined : coerceValue(raw, schema))
}

// Bare primitive field (filterable combobox for long enums, select for short
// enums and booleans, input otherwise), without dispatch: shared between the
// simple field, array rows, and path/query parameter fields (try-it and
// doc).
export function leafField(schema, ariaLabel, onChange) {
  let field
  // Same threshold as the chip collapse: a "long" enum is long for both
  // displays. Without the top layer the combobox can be painted under a modal
  // `<dialog>`, and this field is rendered inside one (env manager, settings):
  // the native select stays a correct fallback — it scrolls and supports
  // prefix search.
  if (schema?.enum?.length > ENUM_COLLAPSE_THRESHOLD && TOP_LAYER_SUPPORTED) {
    return comboboxField(schema.enum, ariaLabel, onChange)
  }
  if (schema?.enum?.length || schema?.type === 'boolean') {
    field = el('select', 'select select-sm font-mono w-full block')
    const empty = el('option', '', text('—'))
    empty.value = ''
    field.append(empty)
    const values = schema?.enum ?? [true, false]
    for (const value of values) {
      const option = el('option', '', text(String(value)))
      option.value = String(value)
      field.append(option)
    }
    keepForeignValue(field, values)
  } else {
    field = el('input', 'input input-sm font-mono w-full block api-leaf')
    field.type = 'text'
    // API values: neither dictionary words nor sentences. Left as-is, a
    // phone keyboard capitalizes an id and a spellchecker underlines a uuid.
    field.autocomplete = 'off'
    field.spellcheck = false
    field.setAttribute('autocapitalize', 'none')
    // Numeric field kept `type=text` on purpose: `type=number` refuses
    // a `{{var}}` — the template must be typable everywhere (rule 11).
    // inputmode only changes the touch keyboard.
    if (schema?.type === 'integer' || schema?.type === 'number') field.inputMode = 'decimal'
    // Placeholder always set (a space failing an example): it's
    // `:placeholder-shown` that distinguishes a filled field from an empty one
    // in CSS, and it matches nothing without a placeholder (cf. .api-leaf in
    // app.css). Failing an example, the format is what says the most about
    // the expected shape (a date, a uuid…).
    const example = schema?.examples?.[0] ?? schema?.default ?? formatSample(schema?.format)
    field.placeholder = example === undefined ? ' ' : String(example)
  }
  field.setAttribute('aria-label', ariaLabel)
  field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', onChange)
  return field
}

// A select can only display what it lists: assigning it an unknown value
// silently falls back to "—", and the field then contradicted the state it
// was showing (a `{{var}}` coming from a scenario step, an off-list value
// from a reloaded request). The value is added as an extra option, flagged
// like the combobox flags its own off-list values.
function keepForeignValue(select, values) {
  const known = new Set(['', ...values.map((value) => String(value))])
  const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  let foreign = null
  Object.defineProperty(select, 'value', {
    configurable: true,
    get: () => native.get.call(select),
    set: (next) => {
      const value = next === undefined || next === null ? '' : String(next)
      if (known.has(value)) {
        foreign?.remove()
        foreign = null
        select.removeAttribute('title')
      } else {
        if (!foreign) {
          foreign = el('option', '')
          select.append(foreign)
        }
        foreign.value = value
        foreign.textContent = value
        select.title = t('schema.enumOffList')
      }
      select.classList.toggle('select-warning', foreign !== null)
      native.set.call(select, value)
    },
  })
}

// Editor of a PARAMETER value, in the three shapes `style`/`explode` know
// how to serialize: one row per element for an array, one field per declared
// property for an object, a single leaf otherwise. All three expose the same
// interface — that's what lets the panel and the central doc share one field
// without knowing which of the three they got.
// `structured: false` forces the single field: locations whose panel state
// holds one string per name (headers), and parameters described by `content`
// whose value is a serialized document, not a spread structure.
// `param`: the normalized parameter this field edits, when there is one. The
// field used to receive the schema alone and re-derived the wire form with a
// hardcoded comma — so a `pipeDelimited` or `spaceDelimited` parameter read
// back a value it had itself written, and split it in the wrong place. The
// delimiter is `style`'s, and `params.js` is what already knows it.
export function paramField(schema, ariaLabel, onChange, { structured = true, param = null } = {}) {
  if (structured && schema?.kind === 'array' && isEditableLeaf(schema.items)) {
    return arrayParamField(schema, ariaLabel, onChange, param)
  }
  if (structured && schema?.kind === 'object' && schema.properties?.length) {
    return objectParamField(schema, ariaLabel, onChange, param)
  }
  const field = leafField(schema, ariaLabel, onChange)
  return {
    element: field,
    multi: false,
    getValue: () => field.value,
    setValue: (value) => {
      const next = Array.isArray(value) ? value.join(listDelimiter(param)) : (value ?? '')
      if (field.value !== next) field.value = next
    },
    varInputs: () => [{ input: field, getValue: () => field.value }],
    focus: () => field.focus(),
  }
}

// One field per declared property. The map it produces is what `deepObject`
// (or `form`) spreads over the query; a free-form object has no form to
// build and stays a single field (cf. `isObjectValue`).
function objectParamField(schema, ariaLabel, onChange, param = null) {
  const fields = []
  const card = el('div', 'card card-border border-base-300 bg-base-100 p-2 flex flex-col gap-1')
  for (const prop of schema.properties) {
    if (prop.schema?.readOnly) continue
    const input = leafField(prop.schema, `${ariaLabel} ${prop.name}`, onChange)
    input.classList.add('grow')
    fields.push({ name: prop.name, input })
    card.append(
      el(
        'label',
        'flex items-center gap-2',
        el(
          'code',
          'font-mono text-xs text-subtle w-24 shrink-0 truncate',
          text(prop.name),
          prop.required ? el('span', 'text-error', text('*')) : null,
        ),
        input,
      ),
    )
  }
  const values = () =>
    Object.fromEntries(
      fields
        .filter(({ input }) => input.value !== '')
        .map(({ name, input }) => [name, input.value]),
    )
  return {
    element: card,
    multi: true,
    getValue: values,
    setValue: (value) => {
      // A string still arrives from a hand-written scenario step: read back
      // as the flat key/value/key/value form, on the parameter's own delimiter.
      const next =
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : Object.fromEntries(toValueEntries(param, value))
      for (const { name, input } of fields) {
        const item = next[name] === undefined || next[name] === null ? '' : String(next[name])
        if (input.value !== item) input.value = item
      }
    },
    varInputs: () => fields.map(({ input }) => ({ input, getValue: () => input.value })),
    focus: () => fields[0]?.input.focus(),
  }
}

function arrayParamField(schema, ariaLabel, onChange, param = null) {
  const rows = []
  const rowsBox = el('div', 'flex flex-col gap-1')
  const box = el('div', 'flex flex-col gap-1', rowsBox)
  const addRow = (value = '') => {
    const input = leafField(schema.items, ariaLabel, onChange)
    input.classList.add('grow')
    input.value = value
    const remove = el('button', 'btn btn-ghost btn-xs px-1 shrink-0', text('✕'))
    remove.type = 'button'
    remove.title = t('doc.removeItem')
    remove.setAttribute('aria-label', t('doc.removeItem'))
    const row = el('div', 'flex items-center gap-1', input, remove)
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(input), 1)
      row.remove()
      // A field with zero row can no longer be typed into: emptying the last
      // one is what "remove everything" means here.
      if (!rows.length) addRow()
      onChange()
    })
    rows.push(input)
    rowsBox.append(row)
    return input
  }
  const add = el(
    'button',
    'btn btn-soft btn-primary btn-xs self-start',
    text(`+ ${t('doc.addItem')}`),
  )
  add.type = 'button'
  add.addEventListener('click', () => addRow().focus())
  box.append(add)
  addRow()

  const values = () => rows.map((input) => input.value).filter((value) => value !== '')
  return {
    element: box,
    multi: true,
    getValue: values,
    // Rebuilt wholesale, and only on a real difference: the row count is
    // part of the value, and rewriting the rows under an ongoing input
    // would move the caret.
    setValue: (value) => {
      // A string still arrives from a hand-written scenario step, and it is
      // read back on the delimiter the parameter's own `style` declares.
      const next = (
        Array.isArray(value) ? value.map((item) => String(item ?? '')) : toValueList(param, value)
      ).filter((item) => item !== '')
      if (JSON.stringify(next) === JSON.stringify(values())) return
      rows.length = 0
      rowsBox.replaceChildren()
      for (const item of next) addRow(item)
      if (!rows.length) addRow()
    },
    varInputs: () => rows.map((input) => ({ input, getValue: () => input.value })),
    focus: () => rows[0]?.focus(),
  }
}

let comboboxSeq = 0

// Filterable combobox for long enums. The rendered field is a real <input>:
// callers read `.value`, write to it without an event (doc↔panel sync), and
// test `tagName` — a composite widget would break all of that. The list's
// lifecycle and placement live in `anchored-list.js`.
function comboboxField(values, ariaLabel, onChange) {
  const options = values.map((value) => String(value))
  const id = `api-combobox-${++comboboxSeq}`
  const field = el('input', 'input input-sm font-mono w-full block api-leaf')
  field.type = 'text'
  field.autocomplete = 'off'
  field.placeholder = t('schema.enumFilter', { n: options.length })
  field.setAttribute('aria-label', ariaLabel)
  field.setAttribute('role', 'combobox')
  field.setAttribute('aria-autocomplete', 'list')
  field.setAttribute('aria-expanded', 'false')
  field.setAttribute('aria-controls', id)

  const popover = anchoredList()
  const list = popover.list
  list.id = id

  let shown = []
  let active = -1
  const isOpen = () => popover.isOpen()

  // The field accepts free text (that's what allows {{variable}}, which a
  // select forbade): a value outside the enum is therefore not blocking, just
  // flagged. Templates are exempt — their real value only exists at send
  // time, after the environment is applied — and the faulty case (missing
  // variable) is already handled by the panel, which blocks and marks the
  // field `input-error`. The two markings therefore exclude each other by
  // construction.
  const validate = () => {
    const value = field.value.trim()
    const offList = value !== '' && !value.includes('{{') && !options.includes(value)
    field.classList.toggle('input-warning', offList)
    if (offList) field.title = t('schema.enumOffList')
    else field.removeAttribute('title')
  }
  // Both directions of the doc↔panel sync write `.value` without emitting an
  // event: we intercept the native accessor, the only common pass-through point.
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  Object.defineProperty(field, 'value', {
    configurable: true,
    get: () => nativeValue.get.call(field),
    set: (next) => {
      nativeValue.set.call(field, next)
      validate()
    },
  })

  const render = () => {
    const query = field.value.trim().toLowerCase()
    // Value already exact: show everything again, otherwise the list would
    // shrink to the current value and no other one could be chosen.
    shown =
      !query || options.some((option) => option.toLowerCase() === query)
        ? options
        : options.filter((option) => option.toLowerCase().includes(query))
    // On open (active < 0), it's the current value that's active, not the
    // first option: Enter must not change the value by surprise.
    if (active < 0) active = shown.length ? Math.max(shown.indexOf(field.value), 0) : -1
    else active = shown.length ? Math.min(active, shown.length - 1) : -1
    list.replaceChildren(
      ...shown.map((option, index) => {
        const item = el('button', 'font-mono text-xs', text(option))
        item.type = 'button'
        item.id = `${id}-${index}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', String(option === field.value))
        if (index === active) item.classList.add('menu-active')
        // Without this the focus leaves the field on mousedown and the list
        // closes before the click reaches the option.
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => pick(option))
        return el('li', '', item)
      }),
    )
    list.append(
      shown.length
        ? el('li', 'menu-title text-xs', text(`${shown.length} / ${options.length}`))
        : el('li', 'menu-disabled', el('span', 'text-xs', text(t('schema.enumNoMatch')))),
    )
    if (active >= 0) field.setAttribute('aria-activedescendant', `${id}-${active}`)
    else field.removeAttribute('aria-activedescendant')
  }

  const open = () => {
    if (isOpen()) return
    render()
    popover.open(field, close)
    list.children[active]?.scrollIntoView({ block: 'nearest' })
    field.setAttribute('aria-expanded', 'true')
  }

  const close = () => {
    if (!isOpen()) return
    popover.close()
    active = -1
    field.setAttribute('aria-expanded', 'false')
    field.removeAttribute('aria-activedescendant')
  }

  const pick = (option) => {
    field.value = option
    close()
    field.focus()
    // Same path as manual input; not trusted, so it doesn't reopen the list.
    field.dispatchEvent(new Event('input'))
  }

  field.addEventListener('input', (event) => {
    validate()
    onChange()
    // A programmatic write (doc↔panel sync, click on an enum chip) must not
    // unroll the list — only a real keystroke opens it.
    if (!event.isTrusted) return
    active = 0
    if (isOpen()) render()
    else open()
  })
  field.addEventListener('click', open)
  field.addEventListener('focusout', () => close())
  field.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen()) return open()
      if (!shown.length) return
      active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
      render()
      list.children[active]?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' && isOpen() && active >= 0) {
      event.preventDefault()
      pick(shown[active])
    } else if (event.key === 'Escape' && isOpen()) {
      // Without stopPropagation, Escape would also close the panel or the
      // dropdown hosting the field.
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close()
    }
  })

  return field
}

// Max depth of "collect" editors (array content): beyond this, the panel's
// JSON remains the only editor.
const MAX_EDIT_DEPTH = 3

// Editor that BUILDS the complete typed value of a subtree: primitive,
// object (recursive field map), or array (add/remove rows).
// Used for arrays and their elements — an array's content must go back out
// as a block, a path with indices would shift on every removal. onChange
// notifies on every input; getValue() is undefined when the subtree is empty
// (the element/key is then omitted).
function collectEditor(schema, onChange, depth, label) {
  if (!schema || schema.circular || schema.readOnly || depth > MAX_EDIT_DEPTH) return null

  // setValue: filled PROGRAMMATICALLY from the panel's state (reloading a
  // history request, shared link, input in the snippet's JSON). It never
  // emits — that would be a round trip with the source.
  if (isEditableLeaf(schema)) {
    const field = leafField(schema, t('doc.tryItField', { name: label }), onChange)
    return {
      element: field,
      getValue: () => coerceLeaf(schema)(field.value),
      setValue: (value) => {
        field.value = value === undefined || value === null ? '' : String(value)
      },
    }
  }

  // Free-form map (`additionalProperties` with no declared property): the
  // keys are data too, so they are typed alongside their value — same
  // add/remove rows as an array, with a key field in front.
  if (schema.kind === 'object' && !schema.properties?.length && schema.additionalProperties) {
    const valueSchema =
      typeof schema.additionalProperties === 'object'
        ? schema.additionalProperties
        : { kind: 'any' }
    if (!collectEditor(valueSchema, () => {}, depth + 1, label)) return null
    const rows = []
    const rowsBox = el('div', 'flex flex-col gap-2')
    const box = el('div', 'flex flex-col gap-2 grow', rowsBox)
    const addRow = (name = '') => {
      const key = el('input', 'input input-sm font-mono w-32 shrink-0')
      key.type = 'text'
      key.value = name
      key.placeholder = t('schema.mapKey')
      key.setAttribute('aria-label', `${label} ${t('schema.mapKey')}`)
      key.addEventListener('input', onChange)
      const child = collectEditor(valueSchema, onChange, depth + 1, label)
      child.element.classList.add('grow')
      const remove = el('button', 'btn btn-ghost btn-xs px-1 shrink-0', text('✕'))
      remove.type = 'button'
      remove.title = t('doc.removeItem')
      remove.setAttribute('aria-label', t('doc.removeItem'))
      const row = { key, child }
      const rowEl = el('div', 'flex items-start gap-1', key, child.element, remove)
      remove.addEventListener('click', () => {
        rows.splice(rows.indexOf(row), 1)
        rowEl.remove()
        onChange()
      })
      rows.push(row)
      rowsBox.append(rowEl)
      return row
    }
    const add = el(
      'button',
      'btn btn-soft btn-primary btn-xs self-start',
      text(`+ ${t('schema.addKey')}`),
    )
    add.type = 'button'
    add.addEventListener('click', () => addRow().key.focus())
    box.append(add)
    return {
      element: box,
      getValue: () => {
        const obj = {}
        for (const { key, child } of rows) {
          const value = child.getValue()
          if (key.value !== '' && value !== undefined) obj[key.value] = value
        }
        return Object.keys(obj).length ? obj : undefined
      },
      setValue: (value) => {
        rows.length = 0
        rowsBox.replaceChildren()
        for (const [name, item] of Object.entries(value ?? {})) addRow(name).child.setValue(item)
      },
    }
  }

  if (schema.kind === 'object') {
    const children = []
    const card = el(
      'div',
      'card card-border border-base-300 bg-base-100 grow p-2 flex flex-col gap-1',
    )
    for (const prop of schema.properties ?? []) {
      const child = collectEditor(prop.schema, onChange, depth + 1, `${label}.${prop.name}`)
      if (!child) continue
      children.push({ name: prop.name, child })
      card.append(
        el(
          'label',
          'flex items-start gap-2',
          el(
            'code',
            'font-mono text-xs text-subtle w-24 shrink-0 truncate pt-1.5',
            text(prop.name),
          ),
          child.element,
        ),
      )
    }
    if (!children.length) return null
    return {
      element: card,
      getValue: () => {
        const obj = {}
        for (const { name, child } of children) {
          const value = child.getValue()
          if (value !== undefined) obj[name] = value
        }
        return Object.keys(obj).length ? obj : undefined
      },
      setValue: (value) => {
        for (const { name, child } of children) child.setValue(value?.[name])
      },
    }
  }

  // 3.1 tuple (`prefixItems`): each position has its own schema, and the
  // length is part of the type — fixed slots, no add/remove. An open tuple
  // (trailing `items`) keeps its extra elements in the raw JSON body only.
  if (schema.kind === 'array' && schema.tupleItems?.length) {
    const slots = schema.tupleItems.map((item, index) =>
      collectEditor(item, onChange, depth + 1, `${label}[${index}]`),
    )
    if (slots.some((slot) => !slot)) return null
    const box = el('div', 'flex flex-col gap-2 grow')
    slots.forEach((slot, index) => {
      slot.element.classList.add('grow')
      box.append(
        el(
          'div',
          'flex items-start gap-2',
          el('span', 'font-mono text-xs text-subtle pt-1.5 w-4 shrink-0', text(String(index))),
          slot.element,
        ),
      )
    })
    return {
      element: box,
      // A partially filled tuple keeps its positions: dropping an empty slot
      // would shift every following element onto the wrong type.
      getValue: () => {
        const values = slots.map((slot) => slot.getValue())
        return values.some((value) => value !== undefined)
          ? values.map((value) => value ?? null)
          : undefined
      },
      setValue: (value) => {
        slots.forEach((slot, index) => {
          slot.setValue(Array.isArray(value) ? value[index] : undefined)
        })
      },
    }
  }

  if (schema.kind === 'array') {
    // Probe: if the elements aren't editable, no widget at all.
    if (!collectEditor(schema.items, () => {}, depth + 1, label)) return null
    const rows = []
    const rowsBox = el('div', 'flex flex-col gap-2')
    const box = el('div', 'flex flex-col gap-2 grow', rowsBox)
    const addRow = () => {
      const child = collectEditor(schema.items, onChange, depth + 1, label)
      child.element.classList.add('grow')
      const remove = el('button', 'btn btn-ghost btn-xs px-1 shrink-0', text('✕'))
      remove.type = 'button'
      remove.title = t('doc.removeItem')
      const rowEl = el('div', 'flex items-start gap-1', child.element, remove)
      remove.addEventListener('click', () => {
        rows.splice(rows.indexOf(child), 1)
        rowEl.remove()
        onChange()
      })
      rows.push(child)
      rowsBox.append(rowEl)
      return child
    }
    const add = el(
      'button',
      'btn btn-soft btn-primary btn-xs self-start',
      text(`+ ${t('doc.addItem')}`),
    )
    add.type = 'button'
    add.addEventListener('click', () => addRow())
    box.append(add)
    return {
      element: box,
      getValue: () => {
        const values = rows.map((row) => row.getValue()).filter((v) => v !== undefined)
        return values.length ? values : undefined
      },
      // Rows are rebuilt from scratch: their count is part of the value, and
      // no index ever flows through the paths (cf. comment above).
      setValue: (value) => {
        rows.length = 0
        rowsBox.replaceChildren()
        for (const item of Array.isArray(value) ? value : []) addRow().setValue(item)
      },
    }
  }

  return null // composite with structured variants, never…
}

// Editor that EMITS: any input sends back the subtree's full value at the
// given path via tryit-edit. Placed on property rows (leaves and arrays) —
// sub-objects, meanwhile, recompose row by row via path.
// setLeaf (leaves only): fills the field programmatically and emits — used
// by the clickable enum chips on the same row.
export function dispatchEditor(schema, path, registry = null) {
  let editor = null
  const emit = () => {
    editor.element.dispatchEvent(
      new CustomEvent('tryit-edit', {
        bubbles: true,
        detail: { kind: 'body', path, value: editor.getValue() },
      }),
    )
  }
  editor = collectEditor(schema, emit, 0, path.join('.'))
  if (!editor) return null
  const box = el('div', `mt-2 ${isEditableLeaf(schema) ? 'max-w-60' : 'max-w-md'}`, editor.element)
  // Indexed by serialized path (not joined with '.'): a property name
  // containing a dot can't be confused with a nested path.
  if (registry) registry[JSON.stringify(path)] = { element: box, setValue: editor.setValue }
  const leaf = isEditableLeaf(schema) ? editor.element : null
  return {
    element: box,
    // The bare field, for the callers that have to write to it AND change it
    // (the discriminator mirror disables it).
    leaf,
    setLeaf: leaf
      ? (value) => {
          leaf.value = String(value)
          emit()
        }
      : null,
  }
}

// Picker for a `format: binary` position — a multipart part (`path` = its
// property name) or a whole binary body (`path` = []). It emits the File
// object itself rather than a value: both views live in the same page and
// share the very same one, and nothing anywhere serializes it.
//
// An `<input type="file">` cannot be assigned programmatically (the browser
// forbids it, and rightly), so the reverse direction only updates the label:
// a file picked in the try-it panel is NAMED here, not re-selected.
export function fileEditor(path, registry = null) {
  const input = el('input', 'file-input file-input-sm w-full')
  input.type = 'file'
  input.setAttribute('aria-label', t('tryit.bodyFilePick'))
  const chip = el('div', 'text-xs font-mono text-subtle break-all mt-1')
  input.addEventListener('change', () => {
    input.dispatchEvent(
      new CustomEvent('tryit-edit', {
        bubbles: true,
        detail: {
          kind: 'body-file',
          // null = the body itself, not one of its parts.
          name: path.length ? path[path.length - 1] : null,
          file: input.files[0] ?? null,
        },
      }),
    )
  })
  const box = el('div', 'mt-2 max-w-md', input, chip)
  if (registry) {
    registry[JSON.stringify(path)] = {
      element: box,
      setValue: (file) => {
        chip.textContent = file ? fileBodyLabel(file) : ''
      },
    }
  }
  return { element: box, leaf: null, setLeaf: null }
}
