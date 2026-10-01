import { placeOf } from '../locate.js'
import { fieldSpelling, OBJECTS, PATTERNED } from '../openapi-objects.js'
import { pointer } from '../pointer.js'

// Constructs used ahead of the version the document declares (docs/audit.md
// §4.6): 3.1 keywords in a 3.0 document, 3.2 ones in anything older. This app
// reads them all regardless — the model normalizes across the three versions —
// but a validator or a code generator honours the `openapi` field, and rejects
// or drops what that version does not have.
//
// The check is one per occurrence and it passes as soon as the declared version
// covers it, so an honest 3.2 document is scored 100 % on the constructs it
// legitimately uses.
// JSON Schema 2020-12 keywords a 3.0 Schema Object does not have: its subset
// stops at draft-04 plus the OpenAPI adjustments. `not` is deliberately absent
// from the list — 3.0 already carries it, alongside allOf/oneOf/anyOf.
const KEYWORDS_31 = [
  'if',
  'then',
  'else',
  '$defs',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'contentEncoding',
  'contentMediaType',
]

export const versionConstruct = {
  id: 'version-construct',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const declared = ctx.version.raw
    const covers = (since) =>
      ctx.version.major > 3 || (ctx.version.major === 3 && ctx.version.minor >= since)
    const report = (since, construct, target) =>
      check(covers(since), { ...target, params: { construct, since: `3.${since}`, declared } })

    // Every field and enumerated value of an OpenAPI object, from the table the
    // structural rules share (openapi-objects.js): `info.summary`, `$self`,
    // `pathItem.query`, `mediaType.itemSchema`, `in: querystring`…
    // A Reference Object's 3.1 `summary` / `description` are `ref-siblings`'.
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema' || type === 'Reference' || PATTERNED.has(type)) continue
      for (const [key, field] of Object.entries(OBJECTS[type])) {
        if (node[key] === undefined) continue
        const versioned = field.since ? null : field.values?.find((v) => v.value === node[key])
        const since = field.since ?? versioned?.since
        if (!since) continue
        const at = `${dataPath}${pointer(key)}`
        // Where it belongs only matters to a finding: looked up for those alone,
        // a 12 MB document passes tens of thousands of these.
        const target = covers(since)
          ? { dataPath: at }
          : { ...placeOf(ctx.operations, at), dataPath: at }
        report(since, field.since ? fieldSpelling(type, key) : `${key}: ${node[key]}`, target)
      }
    }

    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (Array.isArray(schema.type)) {
        report(1, 'type: [...]', { op, location, dataPath: `${dataPath}/type` })
      }
      if (schema.const !== undefined) {
        report(1, 'const', { op, location, dataPath: `${dataPath}/const` })
      }
      for (const keyword of KEYWORDS_31) {
        if (schema[keyword] === undefined) continue
        report(1, keyword, { op, location, dataPath: `${dataPath}/${keyword}` })
      }
    }
  },
}
