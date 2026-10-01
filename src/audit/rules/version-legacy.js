// Spellings a later version replaced, kept in a document that declares that
// later version (docs/audit.md §4.6). Most are silent failures: a 3.1 reader
// has no `nullable` keyword, so the field simply stops being nullable; a
// boolean `exclusiveMinimum` is a type error where 3.1 expects the bound
// itself; `x-nullable` is a Swagger 2 vendor extension no 3.x reader honours.
// Two are deprecated but still read, hence graded `info`: the Schema Object's
// `example` from 3.1 (3.1.1: "Deprecated: The example field has been
// deprecated in favor of the JSON Schema examples keyword. Use of example is
// discouraged, and later versions of this specification may remove it.") and
// the XML `attribute` / `wrapped` booleans from 3.2 ("Deprecated: Use
// nodeType").
//
// The check is "does this spelling match the declared version", so the very same
// constructs PASS in the version they belong to. `since` is the version that
// replaced the spelling — the older ones therefore differ per construct, which
// is why it travels with each (`x-nullable` never belonged to any 3.x).
// `replacement` is the exact rewrite, built from the schema's own values — an
// `example` too long for the one line a fix is elided as `[...]`, the same
// stand-in the null rewrite uses for a composition's existing branches.
//
// A spelling that only restates the default — `nullable: false`, a `false`
// XML boolean, a boolean bound with no `minimum` / `maximum` beside it — said
// nothing in its own version either: nothing to lose, no check. A 3.0
// `nullable: true` with no `type` is `constraint-type-mismatch`'s.

export const versionLegacy = {
  id: 'version-legacy',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const covers = (since) =>
      ctx.version.major > 3 || (ctx.version.major === 3 && ctx.version.minor >= since)
    const modern = covers(1)
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      for (const found of legacyConstructs(schema, modern)) {
        const { construct, replacement, path, since = 1, severity } = found
        check(!covers(since), {
          op,
          location,
          severity,
          dataPath: `${dataPath}/${path ?? construct}`,
          params: { construct, replacement, declared: ctx.version.raw },
        })
      }
    }
  },
}

function* legacyConstructs(schema, modern) {
  if (schema.nullable === true) {
    yield { construct: 'nullable', replacement: nullRewrite(schema) }
  }
  if (schema['x-nullable'] === true) {
    yield {
      construct: 'x-nullable',
      replacement: modern ? nullRewrite(schema) : 'nullable: true',
      since: 0,
    }
  }
  for (const [bound, partner] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ]) {
    // Only the boolean form is a 3.0 spelling: in 3.1 the same keyword carries
    // the numeric bound, and that one is correct everywhere it appears.
    if (typeof schema[bound] !== 'boolean' || typeof schema[partner] !== 'number') continue
    yield {
      construct: bound,
      replacement: `${schema[bound] ? bound : partner}: ${schema[partner]}`,
    }
  }
  if (schema.example !== undefined) {
    yield {
      construct: 'example',
      replacement: `examples: [${inline(schema.example)}]`,
      severity: 'info',
    }
  }
  // 3.2 folded the two XML booleans into one `nodeType`. They survived 3.1
  // untouched, hence `since: 2`.
  if (schema.xml?.attribute === true) {
    yield {
      construct: 'xml.attribute',
      replacement: "xml.nodeType: 'attribute'",
      path: 'xml/attribute',
      since: 2,
      severity: 'info',
    }
  }
  if (schema.xml?.wrapped === true) {
    yield {
      construct: 'xml.wrapped',
      replacement: "xml.nodeType: 'element'",
      path: 'xml/wrapped',
      since: 2,
      severity: 'info',
    }
  }
}

const INLINE_LIMIT = 200

function inline(value) {
  const text = JSON.stringify(value)
  return text !== undefined && text.length <= INLINE_LIMIT ? text : '...'
}

// The 3.1 spelling of "this, or null": `null` joins the type list; with no
// type, a branch of its own beside the composition the schema already holds.
function nullRewrite(schema) {
  const { type } = schema
  const list = (types) => `type: [${types.map((t) => JSON.stringify(t)).join(', ')}]`
  if (typeof type === 'string') return list([type, 'null'])
  if (Array.isArray(type)) return list(type.includes('null') ? type : [...type, 'null'])
  const keyword = Array.isArray(schema.oneOf) ? 'oneOf' : 'anyOf'
  return Array.isArray(schema[keyword])
    ? `${keyword}: [..., { type: "null" }]`
    : 'anyOf: [{ ... }, { type: "null" }]'
}
