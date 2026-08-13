// XML rendering of a normalized schema — what `sample.js` does for JSON, for
// the documents whose bodies and responses are XML.
//
// Same discipline as `sample.js`: pure, deterministic (no clock, no
// randomness), bounded in depth (rule 7), and every scalar leaf comes from
// `sampleValue` so a `date-time` looks the same in both syntaxes. The shape,
// on the other hand, is the XML Object's business: `name`, `namespace`,
// `prefix` and the 3.2 `nodeType` decide what is an element, what is an
// attribute, and what is bare text (`model.js` normalizes 3.0's `attribute` /
// `wrapped` into it — rule 6, no version branch here).
//
// Deliberately structural: a declared `example` on an object or an array is
// not converted into XML. A media-type example is already the body the
// document wants sent, and it is used verbatim upstream (`prefillBody`);
// re-serializing a JSON example against XML metadata would invent a document
// nobody wrote.

import { defaultVariant } from './model.js'
import { sampleValue } from './sample.js'

// Same budgets as sample.js, and for the same reasons: MAX_DEPTH bounds the
// structure a reader can take in, HARD_DEPTH is the safety net.
const MAX_DEPTH = 2
const HARD_DEPTH = 12
const MAX_ITEMS = 2
const INDENT = '  '

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

// Media types whose body is XML: the two registered spellings and the `+xml`
// structured suffix (`application/vnd.acme+xml`).
const XML_MEDIA_RE = /^(application|text)\/xml$|\+xml$/i

export function isXmlMedia(mediaType) {
  return XML_MEDIA_RE.test(
    String(mediaType ?? '')
      .split(';')[0]
      .trim(),
  )
}

/**
 * @param {object} schema - normalized node (`model.js`)
 * @returns {string} an XML document, or '' when the schema describes nothing
 */
export function xmlSample(schema, { forResponse = false, declaration = true } = {}) {
  if (!schema || schema.kind === 'never') return ''
  const body = element(rootName(schema), schema, { depth: 0, forResponse })
  if (!body) return ''
  return declaration ? `${XML_DECLARATION}\n${body}` : body
}

// The root element has no property name to borrow: the XML Object's `name`,
// failing that the component name the `$ref` left behind, failing that a
// neutral wrapper. Never the type — `<object>` names nothing.
function rootName(schema) {
  return schema.xml?.name ?? schema.schemaName ?? 'root'
}

// One element and everything under it. Returns '' when there is nothing to
// show (a cycle, the depth budget) — the caller then omits the element rather
// than emitting an empty one that would read as "declared empty".
function element(name, schema, ctx, indent = '') {
  if (!schema || schema.circular || ctx.depth > HARD_DEPTH) return ''
  const tag = qualifyName(name, schema)

  // A composite stands for one of its variants: the discriminated one when
  // there is a discriminator, the first otherwise — the same choice sample.js
  // makes, so the JSON and XML views of a body never disagree on which variant
  // they show. The composite's own XML metadata (name, namespace) still wins:
  // it is what named the element.
  if (schema.kind === 'composite') {
    const chosen = defaultVariant(schema)
    const variant = schema.composite.variants[chosen?.index ?? 0]
    if (!variant || variant.circular) return ''
    const merged = { ...variant, xml: schema.xml ?? variant.xml }
    // The discriminator property is what tells the server which variant this
    // is: it belongs in the element, exactly as it belongs in a JSON body.
    if (chosen && merged.kind === 'object') {
      merged.properties = withDiscriminator(merged, schema.discriminator.propertyName, chosen.key)
    }
    return element(name, merged, ctx, indent)
  }

  if (schema.kind === 'array') return arrayElement(name, schema, ctx, indent)

  if (schema.kind === 'object') {
    if (ctx.depth > MAX_DEPTH) return ''
    const attributes = []
    const children = []
    for (const prop of schema.properties ?? []) {
      const sub = prop.schema
      if (!sub) continue
      // readOnly belongs to responses, writeOnly to requests — the same split
      // sample.js makes, and for the same reason.
      if (ctx.forResponse ? sub.writeOnly : sub.readOnly) continue
      const propName = sub.xml?.name ?? prop.name
      if (sub.xml?.nodeType === 'attribute') {
        const value = leafText(sub, ctx)
        if (value !== null) attributes.push(` ${qualifyName(propName, sub)}="${escapeAttr(value)}"`)
        continue
      }
      const child = element(propName, sub, { ...ctx, depth: ctx.depth + 1 }, indent + INDENT)
      if (child) children.push(child)
    }
    const open = `${indent}<${tag}${namespaceAttrs(schema)}${attributes.join('')}`
    if (!children.length) return `${open} />`
    return `${open}>\n${children.join('\n')}\n${indent}</${tag}>`
  }

  // Scalars, `any`, and composites: one element carrying its text. A composite
  // resolves through sample.js, which already picks the discriminated variant.
  const value = leafText(schema, ctx)
  if (value === null) return ''
  const nodeType = schema.xml?.nodeType
  // 3.2 `none`: the value contributes no markup of its own. At a leaf that
  // means bare text, which is also what `text` and `cdata` mean minus their
  // wrapping.
  if (nodeType === 'none' || nodeType === 'text') return `${indent}${escapeText(value)}`
  if (nodeType === 'cdata') {
    return `${indent}<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
  }
  return `${indent}<${tag}${namespaceAttrs(schema)}>${escapeText(value)}</${tag}>`
}

// The variant's properties, the discriminator one pinned to the mapping key —
// the only string the server dispatches on. Pinned even when the variant
// declares that property itself: what it declares is a type, and a sample of
// that type is not the key.
function withDiscriminator(variant, propertyName, key) {
  const properties = (variant.properties ?? []).filter((p) => p.name !== propertyName)
  return [
    ...properties,
    {
      name: propertyName,
      required: true,
      schema: { kind: 'primitive', type: 'string', enum: [key] },
    },
  ]
}

// An array is either wrapped — its own element around the repeated items — or
// spliced into its parent, the item element repeating in place. 3.0 said
// `wrapped: true`, 3.2 says `nodeType: 'element'`; the model speaks the latter
// and an array that says nothing is unwrapped, which is 3.0's default and the
// shape most documents were written against.
function arrayElement(name, schema, ctx, indent) {
  if (ctx.depth > MAX_DEPTH) return ''
  const items = schema.items ?? schema.contains
  const tupleItems = schema.tupleItems ?? []
  const wrapped = schema.xml?.nodeType === 'element'
  const inner = wrapped ? indent + INDENT : indent
  const itemCtx = { ...ctx, depth: ctx.depth + 1 }
  // A tuple names each position from its own schema; a plain array repeats one
  // element. The item's own XML name wins over the array's — that is the
  // difference between `<tags><tag/></tags>` and `<tags><tags/></tags>`.
  const rows = tupleItems.length
    ? tupleItems.map((item) => element(item?.xml?.name ?? name, item, itemCtx, inner))
    : Array.from({ length: itemCount(schema) }, () =>
        element(items?.xml?.name ?? name, items, itemCtx, inner),
      )
  const children = rows.filter(Boolean)
  const tag = qualifyName(name, schema)
  if (!children.length) return wrapped ? `${indent}<${tag} />` : ''
  if (!wrapped) return children.join('\n')
  return `${indent}<${tag}${namespaceAttrs(schema)}>\n${children.join('\n')}\n${indent}</${tag}>`
}

function itemCount(schema) {
  return Math.min(Math.max(schema.minItems ?? 1, 1), MAX_ITEMS)
}

// Text of a non-structural node, borrowed from the JSON sampler so the two
// syntaxes never show a different value for the same field. `null` = nothing
// to show (a cycle, an object where a scalar was expected).
function leafText(schema, ctx) {
  const value = sampleValue(schema, { forResponse: ctx.forResponse })
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return null
  return String(value)
}

// `prefix:name`, plus the namespace declaration on the element that carries it.
function qualifyName(name, schema) {
  const prefix = schema?.xml?.prefix
  return prefix ? `${prefix}:${name}` : name
}

function namespaceAttrs(schema) {
  const namespace = schema?.xml?.namespace
  if (!namespace) return ''
  const prefix = schema.xml.prefix
  return ` xmlns${prefix ? `:${prefix}` : ''}="${escapeAttr(namespace)}"`
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttr(value) {
  return escapeText(value).replaceAll('"', '&quot;')
}
