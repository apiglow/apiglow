import { isUriReference } from '../uri.js'

// A 3.2 `$self` that is not a URI reference ("This string MUST be in the form
// of a URI reference as defined by RFC3986 Section 4.1"). `$self` is the
// document's own address and the base every relative `$ref` and server URL
// resolves against: this documentation, unable to read it, falls back to the
// URL the file was fetched from — which is exactly what `$self` was declared
// to override, so a mirror or a bundled copy resolves its references against
// the wrong place. In older versions `$self` is `version-construct`'s.
export const selfUri = {
  id: 'self-uri',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const self = ctx.source?.$self
    if (ctx.version.minor < 2 || typeof self !== 'string' || isUriReference(self)) return
    check(false, { location: '$self', dataPath: '/$self', params: { value: self } })
  },
}
