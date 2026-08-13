// `jsonSchemaDialect` (3.1+) names the dialect the document's schemas are
// written in. This app reads them all as 2020-12 — newest-wins normalization,
// CLAUDE.md rule 19 — so another dialect is not rejected, it is simply read with
// 2020-12 meaning. That is worth saying once per document, hence `info`: the
// keywords the two dialects share behave identically, and the ones they do not
// share are rare enough that the reader can judge.

const KNOWN_DIALECTS = new Set([
  'https://json-schema.org/draft/2020-12/schema',
  'https://spec.openapis.org/oas/3.1/dialect/base',
  'https://spec.openapis.org/oas/3.2/dialect/base',
])

export const schemaDialect = {
  id: 'schema-dialect',
  category: 'correctness',
  severity: 'info',
  run(ctx, check) {
    const dialect = ctx.document.jsonSchemaDialect
    if (typeof dialect !== 'string' || !dialect) return
    check(KNOWN_DIALECTS.has(dialect.replace(/#$/, '')), {
      location: 'jsonSchemaDialect',
      dataPath: '/jsonSchemaDialect',
      params: { dialect },
    })
  },
}
