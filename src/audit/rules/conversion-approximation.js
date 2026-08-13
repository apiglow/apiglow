import { operationContents } from '../schema-walk.js'

// What the Swagger 2.0 conversion could not say in OpenAPI 3.0 (`swagger2.js`).
// The converter marks those spots with `x-original-collection-format` instead of
// dropping them silently; this rule is what turns the marker into something the
// reader sees.
//
// One case exists today: a `collectionFormat` 3.0 has no style for — `tsv`
// anywhere, and `ssv`/`pipes`/`multi` in a path or a header, where 3.0 restricts
// the delimited styles to query parameters. The value is then serialized
// comma-separated, which is a documented approximation, not a bug: hence `info`.
//
// The rule only applies to a converted document, and it grades every place a
// marker could sit — so a conversion that lost nothing scores 100 %, and the
// rule is simply absent from the report for a document written in 3.x.

const MARKER = 'x-original-collection-format'

export const conversionApproximation = {
  id: 'conversion-approximation',
  category: 'correctness',
  severity: 'info',
  run(ctx, check) {
    const from = ctx.document['x-converted-from']
    if (typeof from !== 'string' || !from) return
    const report = (target, construct) =>
      check(construct === undefined, { ...target, params: { from, construct: String(construct) } })

    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        report({ op: entry, dataPath }, param[MARKER])
      }
      for (const { content, dataPath } of operationContents(entry)) {
        for (const [property, encoding] of Object.entries(content.encoding ?? {})) {
          if (!encoding || typeof encoding !== 'object') continue
          report({ op: entry, dataPath: `${dataPath}/encoding/${property}` }, encoding[MARKER])
        }
      }
    }
    // A nested Items Object's delimiter, and a response header's, are marked on
    // the schema itself — that is where the conversion had to put them, and
    // `ctx.schemas` already walks both.
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      report({ op, location, dataPath }, schema[MARKER])
    }
  },
}
