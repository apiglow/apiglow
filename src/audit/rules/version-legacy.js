// Spellings a later version replaced, kept in a document that declares that
// later version (docs/audit.md §4.6). All of them are silent failures: a 3.1
// reader has no `nullable` keyword, so the field simply stops being nullable, a
// boolean `exclusiveMinimum` is a type error where 3.1 expects the bound
// itself, and a 3.2 reader has no `attribute`/`wrapped` to tell an XML
// attribute from an element.
//
// The check is "does this spelling match the declared version", so the very same
// constructs PASS in the version they belong to. `since` is the version that
// replaced the spelling — the older ones therefore differ per construct, which
// is why it travels with each.

export const versionLegacy = {
  id: 'version-legacy',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const covers = (since) =>
      ctx.version.major > 3 || (ctx.version.major === 3 && ctx.version.minor >= since)
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      for (const { construct, replacement, path, since = 1 } of legacyConstructs(schema)) {
        check(!covers(since), {
          op,
          location,
          dataPath: `${dataPath}/${path ?? construct}`,
          params: { construct, replacement, declared: ctx.version.raw },
        })
      }
    }
  },
}

function* legacyConstructs(schema) {
  if (schema.nullable !== undefined) {
    yield { construct: 'nullable', replacement: 'type: [..., "null"]' }
  }
  for (const bound of ['exclusiveMinimum', 'exclusiveMaximum']) {
    // Only the boolean form is a 3.0 spelling: in 3.1 the same keyword carries
    // the numeric bound, and that one is correct everywhere it appears.
    if (typeof schema[bound] === 'boolean') {
      yield { construct: bound, replacement: `${bound}: <number>` }
    }
  }
  // 3.2 folded the two XML booleans into one `nodeType`. They survived 3.1
  // untouched, hence `since: 2`.
  if (schema.xml?.attribute !== undefined) {
    yield {
      construct: 'xml.attribute',
      replacement: "xml.nodeType: 'attribute'",
      path: 'xml/attribute',
      since: 2,
    }
  }
  if (schema.xml?.wrapped !== undefined) {
    yield {
      construct: 'xml.wrapped',
      replacement: "xml.nodeType: 'element'",
      path: 'xml/wrapped',
      since: 2,
    }
  }
}
