import { operationContents } from '../schema-walk.js'

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

    if (Object.keys(ctx.document.webhooks ?? {}).length) {
      report(1, 'webhooks', { location: 'webhooks', dataPath: '/webhooks' })
    }
    // `info` gained a one-sentence `summary` in 3.1, and the licence an SPDX
    // `identifier` next to (and exclusive with) its `url`.
    if (ctx.document.info?.summary !== undefined) {
      report(1, 'info.summary', { location: 'info.summary', dataPath: '/info/summary' })
    }
    if (ctx.document.info?.license?.identifier !== undefined) {
      report(1, 'license.identifier', {
        location: 'info.license.identifier',
        dataPath: '/info/license/identifier',
      })
    }
    if (ctx.document.jsonSchemaDialect !== undefined) {
      report(1, 'jsonSchemaDialect', {
        location: 'jsonSchemaDialect',
        dataPath: '/jsonSchemaDialect',
      })
    }
    // 3.2: the document names its own URI, which every relative reference then
    // resolves against. In 3.0/3.1 a `$self` key is nothing at all.
    if (ctx.document.$self !== undefined) {
      report(2, '$self', { location: '$self', dataPath: '/$self' })
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
      // The discriminator object itself is 3.0; only its 3.2 fallback is new.
      if (schema.discriminator?.defaultMapping !== undefined) {
        report(2, 'discriminator.defaultMapping', {
          op,
          location,
          dataPath: `${dataPath}/discriminator/defaultMapping`,
        })
      }
      // The XML Object is 3.0; 3.2 replaced its `attribute`/`wrapped` booleans
      // with one `nodeType`, which older tooling reads as nothing.
      if (schema.xml?.nodeType !== undefined) {
        report(2, 'xml.nodeType', { op, location, dataPath: `${dataPath}/xml/nodeType` })
      }
    }

    for (const entry of ctx.operations) {
      // An operation that does not sit under its own method key came from
      // `additionalOperations` — the 3.2 escape hatch for non-standard methods.
      if (entry.pathItem[entry.method] !== entry.op) {
        report(2, 'additionalOperations', { op: entry })
      } else if (entry.method === 'query') {
        report(2, 'query', { op: entry })
      }
      for (const { param, dataPath } of entry.parameters) {
        if (param.in === 'querystring') report(2, 'in: querystring', { op: entry, dataPath })
      }
      for (const { content, dataPath } of operationContents(entry)) {
        if (content.itemSchema) report(2, 'itemSchema', { op: entry, dataPath })
        // 3.2 positional encodings: the `encoding` map addresses a property by
        // name and cannot say anything about an array-shaped body.
        if (content.prefixEncoding) {
          report(2, 'prefixEncoding', { op: entry, dataPath: `${dataPath}/prefixEncoding` })
        }
        if (content.itemEncoding) {
          report(2, 'itemEncoding', { op: entry, dataPath: `${dataPath}/itemEncoding` })
        }
      }
    }
  },
}
