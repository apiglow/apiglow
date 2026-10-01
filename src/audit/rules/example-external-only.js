import { placeOf } from '../locate.js'

// An Example whose only value lives in another file (`externalValue`), with no
// inline value beside it. This documentation never fetches it — a page that
// retrieves whatever URL a schema names is a request-forgery surface
// (src/openapi/examples.js) — so the doc shows a link ("Declared in an
// external file, not fetched by this page"), and the try-it prefill and the
// response example skip it. Any renderer that does fetch it needs the host to
// answer with CORS headers, and a relative one resolves against a base that
// 3.0 leaves to the implementation.
//
// The fix depends on the version: 3.2 lets a `dataValue` sit beside
// `externalValue` (the data, inline; the file, the exact bytes); before 3.2
// `value` and `externalValue` are mutually exclusive, so the inline `value`
// replaces the link. One check per Example carrying `externalValue`, read on
// the source — a shared one once, at the component. A malformed URL is
// `uri-form`'s; both fields at once in 3.0/3.1, `exclusive-fields`'.
export const exampleExternalOnly = {
  id: 'example-external-only',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Example' || typeof node.externalValue !== 'string') continue
      const inline = ['value', 'dataValue', 'serializedValue'].some(
        (key) => node[key] !== undefined,
      )
      check(inline, { ...placeOf(ctx.operations, dataPath), dataPath: `${dataPath}/externalValue` })
    }
  },
}
