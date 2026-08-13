import { t } from '../i18n/index.js'
import { isFileSchema } from '../openapi/body-kind.js'
import { defaultVariant } from '../openapi/model.js'
import { changeBadge } from './change-badge.js'
import { el, text } from './dom.js'
import { externalDocsLink } from './external-docs.js'
import { markdownInline } from './markdown.js'
import {
  ENUM_COLLAPSE_THRESHOLD,
  dispatchEditor,
  fileEditor,
  isEditableLeaf,
  isFreeFormMap,
} from './schema-editors.js'

// Recursive rendering of a SchemaNode from the internal model. Rule 7: automatic
// expansion bounded by MAX_AUTO_DEPTH; beyond that (and systematically on
// cyclic nodes), an "expand" button relaunches a render with a fresh budget —
// the depth is therefore only bounded by the user's clicks.
const MAX_AUTO_DEPTH = 3

// options.editable: form mode — each leaf property
// (at any depth) gets an input field, arrays get an add/remove widget. Any
// input bubbles up a `tryit-edit` event (bubbles, light DOM) carrying
// options.path (key path from the body root) and a typed value — undefined =
// key removed. Arrays emit their full value: never an index in the paths.
//
// options.editors: optional registry { serialized path → { element,
// setValue } } filled in at render time, through which the caller pushes the
// panel's state back down into the fields (the reverse direction of
// `tryit-edit`).
//
// options.variantPickers: same shape, for the widgets that decide which
// SUBTREE exists rather than what a field holds (discriminated composites).
// They are applied first: switching one rebuilds the editors below it.
//
// options.onEditorsChanged: called after any local remount that creates
// editors (variant switch, "expand"). The mirror contract (rule 20) is that no
// widget here holds a choice the panel does not; a remount therefore has to
// ask for the state again instead of waiting for the next unrelated push.
//
// options.xml: the media type being documented is an XML one. Purely
// presentational, but it is the whole tree's mode rather than a node's, so it
// has to survive every place below where the edit options are deliberately
// dropped — hence `descriptive()` instead of a spread. A subtree that lost it
// would describe an XML body as if it were JSON, silently: those chips are the
// only visible difference between the two.
export function schemaTree(node, depth = 0, options = {}) {
  return renderNode(node, depth, options)
}

const descriptive = (options, extra = {}) => ({ xml: options.xml, ...extra })

function renderNode(node, depth, options = {}) {
  if (!node) return el('div')
  const base = baseNode(node, depth, options)
  // The conditional keywords apply to any kind — a schema carrying only
  // `if`/`then`/`else` stays `any` (normalization infers no type from them), so
  // the panes hang off the node itself rather than off one of the four shapes.
  const panes = keywordPanes(node, depth, options)
  return panes ? el('div', '', base, panes) : base
}

function baseNode(node, depth, options) {
  switch (node.kind) {
    case 'object':
      return objectNode(node, depth, options)
    case 'array':
      return arrayNode(node, depth, options)
    case 'composite':
      return compositeNode(node, depth, options)
    default:
      return primitiveNode(node, options)
  }
}

// Labeled panes for the 2020-12 keywords that carry a whole schema: the
// conditional branches, `not`, and the schemas a property's presence brings in.
// Same lazy expansion as a composite variant — a branch is as deep, and as
// cyclic, as anything else. Deliberately without the edit options: a branch
// describes when the value is valid, it is not a place in the body to type into.
function keywordPanes(node, depth, options = {}) {
  const panes = []
  const pane = (label, schema) =>
    panes.push(
      el(
        'div',
        'mt-2',
        el('div', 'text-xs font-semibold text-subtle', text(`${label} — ${typeLabel(schema)}`)),
        nested(schema, depth + 1, descriptive(options)),
      ),
    )
  for (const branch of ['if', 'then', 'else']) {
    if (node.conditional?.[branch]) pane(t(`schema.${branch}`), node.conditional[branch])
  }
  if (node.not) pane(t('schema.not'), node.not)
  for (const { name, schema } of node.dependentSchemas ?? []) {
    pane(t('schema.dependentSchemas', { name }), schema)
  }
  return panes.length ? el('div', '', ...panes) : null
}

// Keywords that deserve a subtree of their own — what makes an otherwise
// scalar-looking node worth descending into (cf. isComplex).
function hasKeywordPanes(node) {
  return Boolean(node?.conditional || node?.not || node?.dependentSchemas?.length)
}

function objectNode(node, depth, options = {}) {
  const box = el('div', '')
  // Constraints of the object ITSELF (key shape, dependencies, what composition
  // leaves unevaluated): at the root there is no property row to carry them, so
  // they go above the rows they constrain. Deeper, the row that names the
  // property already shows them — printing them twice is what the depth test
  // avoids.
  if (depth === 0) {
    const chips = chipsLine(node, descriptive(options))
    if (chips) box.append(chips)
  }
  // Body whose root is itself a free-form map: widget at the root path [],
  // like a root array.
  if (options.editable && isFreeFormMap(node)) {
    const editor = dispatchEditor(node, options.path ?? [], options.editors)
    if (editor) box.append(editor.element)
  }
  // Parent-side polymorphism: the discriminator sits on the object that
  // declares the shared property, and it is that property's row that must say
  // so. A variant of a composite, meanwhile, inherits the name from above.
  const rowOptions = node.discriminator
    ? { ...options, discriminatorProp: node.discriminator.propertyName }
    : options
  for (const prop of node.properties ?? []) box.append(propertyRow(prop, depth, rowOptions))
  // Keys matched by a pattern: rows of the same table, never editable — there
  // is no name to type a value under, only a shape the name must have.
  for (const { pattern, schema } of node.patternProperties ?? []) {
    box.append(
      propertyRow(
        { name: pattern, required: false, schema, pattern: true },
        depth,
        descriptive(options),
      ),
    )
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    box.append(
      propertyRow(
        { name: t('schema.additionalProps'), required: false, schema: node.additionalProperties },
        depth,
        descriptive(options),
      ),
    )
  }
  if (!box.childElementCount)
    box.append(
      chipsLine(node, descriptive(options)) ??
        el('span', 'text-xs text-faint', text(typeLabel(node))),
    )
  return box
}

function arrayNode(node, depth, options = {}) {
  const box = el('div', '', el('div', 'text-xs font-mono text-subtle', text(typeLabel(node))))
  const chips = chipsLine(node, descriptive(options))
  if (chips) box.append(chips)
  // Body whose root is itself an array: widget at the root path [].
  if (options.editable) {
    const editor = dispatchEditor(node, options.path ?? [], options.editors)
    if (editor) box.append(editor.element)
  }
  // 3.1 tuple (`prefixItems`): each position carries its own schema and the
  // length is part of the type. A tuple declares no `items`, so without this
  // the reference view showed `array<any>` and no subtree at all — documenting
  // strictly less than the try-it form, which has always drawn the slots
  // (rule 19). Positions are named by index, as they are in that form.
  if (node.tupleItems?.length) {
    const positions = el('div', 'mt-2 border-s-2 border-base-300 ps-4')
    for (const [index, item] of node.tupleItems.entries()) {
      positions.append(
        propertyRow({ name: String(index), schema: item }, depth + 1, descriptive(options)),
      )
    }
    box.append(positions)
  }
  // topRows: the items of a root array (array<Pet> response…) are at the same
  // conceptual level as the properties of a root object — same visual
  // prominence, and same change marking. Deliberately without the edit
  // options (descriptive subtree).
  if (isComplex(node.items)) {
    box.append(
      nested(
        node.items,
        depth + 1,
        depth === 0
          ? descriptive(options, { topRows: true, changes: options.changes })
          : descriptive(options),
      ),
    )
  }
  return box
}

function compositeNode(node, depth, options = {}) {
  const { keyword, variants } = node.composite
  const labels = { oneOf: t('schema.oneOf'), anyOf: t('schema.anyOf'), allOf: t('schema.allOf') }
  const keys = discriminatorKeys(node)
  const box = el(
    'div',
    '',
    el(
      'div',
      'flex flex-wrap items-center gap-1',
      el('span', 'badge badge-ghost badge-sm', text(labels[keyword] ?? keyword)),
      node.discriminator
        ? el(
            'span',
            'badge badge-ghost badge-sm font-mono',
            text(`${t('schema.discriminator')}: ${node.discriminator.propertyName}`),
          )
        : null,
    ),
  )
  // The mapping key beats the schema name: it is the value the property will
  // actually carry, and a document that spells them differently (`dog` for
  // `Dog`) means the first.
  const label = (index) => {
    const entry = keys.get(index)
    const name = entry?.key ?? schemaLabel(variants[index]) ?? t('schema.variant', { n: index + 1 })
    return entry?.default ? `${name} (${t('schema.default')})` : name
  }
  const variantOptions = (index) => {
    const next = depth === 0 ? { ...options, topRows: true } : { ...options }
    if (!node.discriminator) return next
    next.discriminatorProp = node.discriminator.propertyName
    // Read-only display never locks a value in: it is the try-it that has to
    // stop the property and the chosen variant from drifting apart.
    if (options.editable) next.discriminatorKey = keys.get(index)?.key
    return next
  }
  if (options.editable && node.discriminator && variants.length > 1) {
    box.append(...variantPicker(node, depth, options, label, variantOptions))
    return box
  }
  variants.forEach((variant, i) => {
    const block = el(
      'div',
      'mt-2',
      el('div', 'text-xs font-semibold text-subtle', text(`${label(i)} — ${typeLabel(variant)}`)),
      // Variants edit the same path: their fields write to the same spot in
      // the body, whichever variant is chosen.
      nested(variant, depth + 1, variantOptions(i)),
    )
    box.append(block)
  })
  return box
}

// variantIndex → its mapping entry, first one wins (two keys pointing at the
// same variant is legal, and the label can only show one).
function discriminatorKeys(node) {
  const keys = new Map()
  for (const entry of node.discriminator?.mapping ?? []) {
    if (entry.variantIndex !== null && !keys.has(entry.variantIndex)) {
      keys.set(entry.variantIndex, entry)
    }
  }
  return keys
}

// Discriminated body in the try-it: the variants are exclusive, so only the
// selected one is on screen. Showing them all — what an undiscriminated
// composite does — would let a Cat's fields and a Dog's fields land in the same
// body, which is exactly what the discriminator exists to prevent.
function variantPicker(node, depth, options, label, variantOptions) {
  const { variants } = node.composite
  const { propertyName } = node.discriminator
  const keys = discriminatorKeys(node)
  const start = defaultVariant(node)?.index ?? 0
  const select = el('select', 'select select-sm w-auto font-mono mt-2')
  variants.forEach((variant, index) => {
    const option = el('option', '', text(`${label(index)} — ${typeLabel(variant)}`))
    option.value = String(index)
    select.append(option)
  })
  select.value = String(start)
  select.setAttribute('aria-label', t('schema.discriminatorPick', { name: propertyName }))

  const slot = el('div', '')
  // Keys the displayed variant registered: on a switch they must leave the
  // registry, or the panel keeps pushing body values into a detached subtree.
  let owned = []
  let shown = start
  const mount = (index) => {
    const before = new Set(Object.keys(options.editors ?? {}))
    const subtree = nested(variants[index], depth + 1, variantOptions(index))
    owned = Object.keys(options.editors ?? {}).filter((key) => !before.has(key))
    slot.replaceChildren(subtree)
    shown = index
  }
  mount(start)

  // A switch always drops the previous variant's keys from the registry. It
  // only rewrites the BODY when the user asked for it: driven from the body
  // (`setValue`), emitting would be an echo — and an echo that erases the very
  // keys we are being told about.
  const switchTo = (index, { emit = false } = {}) => {
    const dropped = owned
    for (const key of dropped) delete options.editors?.[key]
    mount(index)
    if (emit) {
      const send = (path, value) =>
        select.dispatchEvent(
          new CustomEvent('tryit-edit', { bubbles: true, detail: { kind: 'body', path, value } }),
        )
      // The previous variant's fields are gone from the form: their keys have
      // to leave the body too, or a Cat's properties would ride along inside a
      // Dog. undefined = key removed (cf. the tryit-edit contract at the top).
      for (const key of dropped) send(JSON.parse(key), undefined)
      const key = keys.get(index)?.key
      if (key !== undefined) send([...(options.path ?? []), propertyName], key)
    }
    options.onEditorsChanged?.()
  }

  select.addEventListener('change', () => switchTo(Number(select.value), { emit: true }))

  // The picker decides WHICH subtree exists, so it cannot be a doc-local
  // choice: a body arriving from a history reload, a share link or a scenario
  // step has to move it. Left free, the doc showed a Cat's fields under a body
  // saying "dog" — and the dog's own fields were editable nowhere.
  if (options.variantPickers) {
    const indexByKey = new Map()
    for (const [index, entry] of keys) indexByKey.set(entry.key, index)
    options.variantPickers[JSON.stringify(options.path ?? [])] = {
      element: select,
      setValue: (value) => {
        const index = indexByKey.get(value?.[propertyName])
        // An unknown key (half-typed, or a mapping we cannot resolve) leaves
        // the current variant alone: guessing would yank the fields out from
        // under whoever is typing.
        if (index === undefined || index === shown) return
        select.value = String(index)
        switchTo(index)
      },
    }
  }
  return [select, slot]
}

function primitiveNode(node, options = {}) {
  const box = el(
    'div',
    'flex flex-col gap-1',
    el('span', 'text-xs font-mono text-subtle', text(typeLabel(node))),
  )
  const description = markdownInline(node.description)
  if (description) box.append(el('div', 'text-sm', description))
  const chips = chipsLine(node, descriptive(options))
  if (chips) box.append(chips)
  return box
}

function propertyRow(prop, depth, options = {}) {
  const schema = prop.schema
  const isDiscriminator = options.discriminatorProp === prop.name
  // Top-level properties are stacked rows separated by a thin rule — same
  // grammar as the parameter rows, where they used to be cards. Depth keeps
  // the same rule, tighter (base-300: base-200 was invisible on tinted
  // backgrounds).
  const top = depth === 0 || options.topRows === true
  const head = rowHead(
    fieldName(prop.name),
    prop.pattern ? el('span', 'badge badge-ghost badge-xs', text(t('schema.patternKey'))) : null,
    isDiscriminator
      ? el('span', 'badge badge-primary badge-outline badge-xs', text(t('schema.discriminator')))
      : null,
    fieldType(schema),
    prop.required ? requiredMark() : null,
    schema?.deprecated ? deprecatedMark() : null,
    schema?.circular
      ? el('span', 'badge badge-ghost badge-xs', text(`↻ ${t('schema.recursive')}`))
      : null,
    // Local changelog: marking reserved for the top level — that's the
    // granularity of field fingerprints (cf. openapi/diff.js).
    top ? changeBadge(options.changes?.(prop.name)) : null,
  )
  const row = el('div', top ? 'api-schema-row py-row api-row' : 'py-2 api-row', head)
  const description = markdownInline(schema?.description)
  if (description) row.append(el('div', 'text-sm mt-1', description))
  const childPath = [...(options.path ?? []), prop.name]
  // The editor is built before the chips: clickable enum values fill its
  // field (setLeaf), but it displays after them.
  let editor = null
  if (options.editable && options.fileEditors && isFileSchema(schema)) {
    // A file part: a picker, not a text field. Typing bytes is not a thing.
    // Gated on the registry, which only a multipart body provides: the same
    // `format: binary` inside a JSON body describes a base64 string, and
    // that one does type.
    editor = fileEditor(childPath, options.fileEditors)
  } else if (
    options.editable &&
    (isEditableLeaf(schema) || schema?.kind === 'array' || isFreeFormMap(schema))
  ) {
    editor = dispatchEditor(schema, childPath, options.editors)
  }
  // Mirror of the variant selector above, not a field of its own: typing into
  // it could only desynchronize the body from the shape it declares.
  if (isDiscriminator && editor?.leaf && options.discriminatorKey !== undefined) {
    editor.leaf.value = options.discriminatorKey
    editor.leaf.disabled = true
    editor.leaf.title = t('schema.discriminatorLocked')
  }
  const chips = chipsLine(
    schema,
    descriptive(options, { onEnumPick: editor?.setLeaf ?? undefined }),
  )
  if (chips) row.append(chips)
  if (editor) row.append(editor.element)
  if (isComplex(schema)) {
    // Sub-objects remain editable at depth (extended path); the subtree of an
    // array or of a free-form map, on the other hand, is purely descriptive —
    // their widget above emits the full value. topRows never propagates:
    // prominence is reserved for the top level.
    let childOptions =
      schema?.kind === 'array' || isFreeFormMap(schema)
        ? descriptive(options)
        : options.editable
          ? { ...options, path: childPath }
          : options
    if (childOptions.topRows) childOptions = { ...childOptions, topRows: false }
    // `changes` is indexed by top-level property name: letting it flow down
    // would mark a same-named sub-property.
    if (childOptions.changes) childOptions = { ...childOptions, changes: null }
    // Same reason for the discriminator: it names a property of THIS object,
    // and a sub-object is free to carry one of the same name.
    if (childOptions.discriminatorProp !== undefined) {
      childOptions = { ...childOptions, discriminatorProp: undefined, discriminatorKey: undefined }
    }
    row.append(nested(schema, depth + 1, childOptions))
  }
  return row
}

// Indented subtree: auto-expanded as long as the depth budget allows it,
// otherwise (or if the node is cyclic) behind a button. The options
// (edit + path) follow along, including after manual expansion.
function nested(schema, depth, options = {}) {
  const box = el('div', 'mt-2 border-s-2 border-base-300 ps-4')
  if (depth < MAX_AUTO_DEPTH && !schema.circular) {
    box.append(renderNode(schema, depth, options))
  } else {
    // Chevron + subtree type: "Expand — array<Pet>" says what's about to
    // open, where a bare "Expand" blended into the background.
    const btn = el(
      'button',
      'btn btn-xs btn-soft gap-1.5 font-normal',
      el('span', 'text-subtle', text('▸')),
      text(`${t('schema.expand')} — ${typeLabel(schema)}`),
    )
    btn.type = 'button'
    btn.addEventListener('click', () => {
      box.replaceChildren(renderNode(schema, 0, options))
      // The subtree just registered brand-new editors, empty. Without this
      // they stay empty until some unrelated input triggers the next state
      // push — the body has values, the freshly opened fields show none.
      options.onEditorsChanged?.()
    })
    box.append(btn)
  }
  return box
}

// Complex = deserves a subtree. Cycles are cut off by the `circular` flag
// (set by normalization on any re-entered node), which also bounds this
// recursion on pure array cycles.
function isComplex(schema) {
  if (!schema) return false
  if (schema.circular) return true
  if (hasKeywordPanes(schema)) return true
  return (
    schema.kind === 'object' ||
    schema.kind === 'composite' ||
    // A tuple is worth descending into whatever its positions hold: they are
    // its type. Tested before `items`, which a `prefixItems`-only array does
    // not have — that absence is why the whole subtree used to be skipped.
    (schema.kind === 'array' && (schema.tupleItems?.length > 0 || isComplex(schema.items)))
  )
}

// Proper name of a schema: its `title` if it has one, otherwise the name of
// the component it comes from (`#/components/schemas/Pet` → "Pet"). An anyOf
// of $ref would otherwise have nothing to display, and "Variant 1" says
// nothing about the content.
function schemaLabel(node) {
  return node?.title ?? node?.schemaName ?? null
}

// Type label deliberately non-recursive (a single level for arrays): safe
// against cycles.
export function typeLabel(node) {
  if (!node) return ''
  if (node.kind === 'composite') return node.composite.keyword
  if (node.kind === 'never') return 'never'
  let base = node.types ? node.types.join(' | ') : (node.type ?? 'any')
  const positionLabel = (item) =>
    schemaLabel(item) ?? (item?.kind === 'composite' ? item.composite.keyword : item?.type) ?? 'any'
  if (node.kind === 'array') {
    // A tuple's positions ARE its type: `array<any>` was not a shorter way of
    // saying it, it was a different claim. Still one level deep, so still
    // cycle-safe.
    base = node.tupleItems?.length
      ? `tuple[${node.tupleItems.map(positionLabel).join(', ')}]`
      : `array<${positionLabel(node.items)}>`
  }
  if (node.format) base += ` (${node.format})`
  if (node.nullable) base += ' | null'
  return base
}

// Atoms of the stacked-row grammar (docs/architecture.md §5.2), shared by the
// two builders that speak it — schema properties here, parameters in
// api-endpoint-doc.js. They looked alike enough to drift silently: the same
// restyle has to reach both, and only one of the two is under the mirror
// suite's eye.
export function rowHead(...children) {
  return el('div', 'flex flex-wrap items-baseline gap-x-2 gap-y-1', ...children)
}

export function fieldName(name) {
  return el('code', 'font-mono text-sm font-semibold', text(name))
}

export function fieldType(schema) {
  return el('span', 'text-xs font-mono text-subtle', text(typeLabel(schema)))
}

// Plain tinted text, no badge: the info should read without shouting — a list
// of required properties would otherwise be speckled with red.
export function requiredMark() {
  return el('span', 'text-label uppercase text-error', text(t('doc.required')))
}

export function deprecatedMark() {
  return el('span', 'badge badge-ghost badge-xs line-through', text(t('doc.deprecated')))
}

// Displayable constraints (enum, bounds, pattern, default…) as chips.
// onEnumPick: makes enum values clickable — a click fills the try-it field
// on the same row (the other chips remain informational).
const XML_NODE_LABEL = {
  attribute: 'schema.xmlAttribute',
  text: 'schema.xmlText',
  cdata: 'schema.xmlCdata',
  none: 'schema.xmlNone',
}

// What an XML Object adds to the default reading of a node, as one short
// string: `<prefix:name>` and, when the node is not a plain element, what it is
// instead.
function xmlChip(node) {
  const xml = node.xml
  if (!xml) return ''
  const name = xml.name ? `<${xml.prefix ? `${xml.prefix}:` : ''}${xml.name}>` : ''
  // `element` is the default node type everywhere except on an array, where it
  // is the whole point: the items sit inside a wrapper instead of repeating.
  const label =
    xml.nodeType === 'element'
      ? node.kind === 'array'
        ? 'schema.xmlWrapped'
        : null
      : XML_NODE_LABEL[xml.nodeType]
  return [name, label ? t(label) : '', xml.namespace].filter(Boolean).join(' ')
}

export function chipsLine(node, { onEnumPick, xml = false } = {}) {
  if (!node) return null
  const chips = []
  const chip = (label, mono = true) =>
    chips.push(el('span', `badge badge-ghost badge-sm ${mono ? 'font-mono' : ''}`, text(label)))

  if (node.enum) {
    const hidden = []
    for (const [index, value] of node.enum.entries()) {
      let element
      if (onEnumPick) {
        element = el(
          'button',
          'badge badge-ghost badge-sm font-mono cursor-pointer transition-colors hover:bg-primary/10 hover:border-primary/40 hover:text-primary',
          text(JSON.stringify(value)),
        )
        element.type = 'button'
        element.title = t('doc.enumPick')
        element.addEventListener('click', () => onEnumPick(value))
      } else {
        element = el('span', 'badge badge-ghost badge-sm font-mono', text(JSON.stringify(value)))
      }
      if (node.enum.length > ENUM_COLLAPSE_THRESHOLD && index >= ENUM_COLLAPSE_THRESHOLD) {
        element.classList.add('hidden')
        hidden.push(element)
      }
      chips.push(element)
    }
    if (hidden.length) {
      // Placed after the hidden chips: collapsed, it naturally follows the
      // last visible chip; expanded, it ends the list. No node is moved on
      // toggle.
      const more = t('schema.enumShowMore', { n: hidden.length })
      const toggle = el(
        'button',
        'badge badge-outline badge-sm cursor-pointer transition-colors hover:bg-base-200',
        text(more),
      )
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true'
        for (const element of hidden) element.classList.toggle('hidden', expanded)
        toggle.setAttribute('aria-expanded', String(!expanded))
        toggle.textContent = expanded ? more : t('schema.enumShowLess')
      })
      chips.push(toggle)
    }
  }
  if (node.default !== undefined)
    chip(`${t('schema.default')}: ${JSON.stringify(node.default)}`, false)
  if (node.minimum !== undefined) chip(`≥ ${node.minimum}`)
  if (node.exclusiveMinimum !== undefined) chip(`> ${node.exclusiveMinimum}`)
  if (node.maximum !== undefined) chip(`≤ ${node.maximum}`)
  if (node.exclusiveMaximum !== undefined) chip(`< ${node.exclusiveMaximum}`)
  if (node.multipleOf !== undefined) chip(`× ${node.multipleOf}`)
  if (node.minLength !== undefined || node.maxLength !== undefined) {
    chip(`${t('schema.length')} ${node.minLength ?? 0}–${node.maxLength ?? '∞'}`, false)
  }
  if (node.pattern) chip(`/${node.pattern}/`)
  if (node.minItems !== undefined || node.maxItems !== undefined) {
    chip(`${t('schema.items')} ${node.minItems ?? 0}–${node.maxItems ?? '∞'}`, false)
  }
  if (node.uniqueItems) chip(t('schema.unique'), false)
  if (node.contains) {
    const bounds =
      node.minContains !== undefined || node.maxContains !== undefined
        ? ` ${node.minContains ?? 0}–${node.maxContains ?? '∞'}`
        : ''
    chip(`${t('schema.contains')} ${typeLabel(node.contains)}${bounds}`, false)
  }
  if (node.readOnly) chip(t('schema.readOnly'), false)
  if (node.writeOnly) chip(t('schema.writeOnly'), false)
  if (node.additionalProperties === false) chip(t('schema.noAdditionalProps'), false)
  if (node.propertyNames) {
    // A key constraint is almost always a pattern; anything else is described
    // by its type, the pane treatment being reserved for what applies to the
    // value itself.
    const shape = node.propertyNames.pattern
      ? `/${node.propertyNames.pattern}/`
      : typeLabel(node.propertyNames)
    chip(`${t('schema.propertyNames')}: ${shape}`, false)
  }
  for (const [name, names] of Object.entries(node.dependentRequired ?? {})) {
    chip(`${t('schema.dependentRequired')}: ${name} → ${names.join(', ')}`, false)
  }
  // What composition leaves unaccounted for: closed (`false`) is the case worth
  // shouting about, a schema form only needs its type named.
  if (node.unevaluatedProperties === false) chip(t('schema.noUnevaluatedProps'), false)
  else if (typeof node.unevaluatedProperties === 'object')
    chip(`${t('schema.unevaluatedProps')}: ${typeLabel(node.unevaluatedProperties)}`, false)
  if (node.unevaluatedItems === false) chip(t('schema.noUnevaluatedItems'), false)
  else if (typeof node.unevaluatedItems === 'object')
    chip(`${t('schema.unevaluatedItems')}: ${typeLabel(node.unevaluatedItems)}`, false)
  // Parent-side polymorphism: the object declares which of its properties
  // names the subtype, and the subtypes were found by reverse index. A
  // composite says it in its own header instead, next to the oneOf badge.
  if (node.discriminator && node.kind !== 'composite') {
    const targets = node.discriminator.mapping.map((entry) => entry.key).join(', ')
    chip(`${t('schema.discriminator')}: ${node.discriminator.propertyName} → ${targets}`, false)
  }
  // The one chip that is a link: a schema can point at the page explaining what
  // it models, and that page is worth more than any constraint listed here.
  const externalDocs = externalDocsLink(
    node.externalDocs,
    'badge badge-ghost badge-sm gap-1 transition-colors hover:border-primary/40 hover:text-primary',
  )
  if (externalDocs) chips.push(externalDocs)
  if (node.contentEncoding) chip(`${t('schema.contentEncoding')}: ${node.contentEncoding}`, false)
  if (node.contentMediaType)
    chip(`${t('schema.contentMediaType')}: ${node.contentMediaType}`, false)
  // XML shape, when the schema says the value is not simply an element of its
  // own name: a different tag, a namespace, or a node that is an attribute or
  // bare text. `nodeType: 'element'` alone is the default and says nothing.
  // Only under an XML media type: the same schema serves the JSON and the XML
  // variant of a body, and `<pet>` or "wrapped" describe nothing a JSON reader
  // will ever send.
  const xmlShape = xml ? xmlChip(node) : ''
  if (xmlShape) chip(`${t('schema.xml')} ${xmlShape}`, false)

  if (!chips.length) return null
  return el('div', 'flex flex-wrap gap-1 mt-1', ...chips)
}
