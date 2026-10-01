import { placeOf } from '../locate.js'
import { inVersion, OBJECTS, objectLabel, PATTERNED } from '../openapi-objects.js'
import { pointer } from '../pointer.js'
import { isAbsoluteUri, isEmail, isUriReference } from '../uri.js'

// A field the specification types as a URL, a URI or an email address, holding
// something that cannot be one: `See our website`, `https://example.com/terms
// of use`, `support at example.com`. Every such field "MUST be in the form of"
// one (Info `termsOfService`, Contact `url` and `email`, License `url`,
// External Documentation `url`, the OAuth and OpenID Connect URLs, an
// Example's `externalValue`, `jsonSchemaDialect`, an XML `namespace` — which
// must be absolute). Validators reject the document; this documentation leaves
// out a link it cannot parse, and other tools print a dead one.
//
// Junk only: a relative reference is fine wherever the spec asks for a URL or
// a URI ("Relative References in URIs"). `$self` is `self-uri`'s, a server URL
// `server-variables`'; a value of another kind `field-value-kind`'s. One check
// per bad value.
export const uriForm = {
  id: 'uri-form',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema' || type === 'Reference' || PATTERNED.has(type)) continue
      for (const [key, field] of Object.entries(OBJECTS[type])) {
        const value = node[key]
        if (typeof value !== 'string' || !inVersion(field, minor)) continue
        if (type === 'OpenAPI' && key === '$self') continue
        const valid =
          type === 'Contact' && key === 'email'
            ? isEmail(value)
            : !field.url
              ? true
              : type === 'XML' && key === 'namespace'
                ? isAbsoluteUri(value)
                : isUriReference(value)
        if (valid) continue
        const at = `${dataPath}${pointer(key)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { field: key, object: objectLabel(type), value },
        })
      }
    }
  },
}
