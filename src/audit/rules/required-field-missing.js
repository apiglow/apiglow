import { placeOf } from '../locate.js'
import { inVersion, isRequired, OBJECTS, objectLabel, PATTERNED } from '../openapi-objects.js'

// A field the specification makes mandatory, absent: an Info without `version`,
// a Parameter without `in`, a Server Variable without `default`, an apiKey
// scheme without `name`. Validators reject the document; code generators
// either stop or invent a value, and this documentation shows what it can.
//
// Left to the rules that already say more about the same gap: an OAuth flow's
// URLs (`oauth-flow-urls`, which names what the try-it loses) and a Response
// without a description when it has no content either (`response-substance`).
// A field present with no value is `field-without-value`'s. One check per
// missing field, none otherwise.

// Required by the scheme's type rather than by the object.
const BY_SCHEME_TYPE = {
  apiKey: ['name', 'in'],
  http: ['scheme'],
  oauth2: ['flows'],
  openIdConnect: ['openIdConnectUrl'],
}

export const requiredFieldMissing = {
  id: 'required-field-missing',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    const report = (type, dataPath, field) =>
      check(false, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { field, object: objectLabel(type) },
      })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema' || type === 'Reference' || PATTERNED.has(type)) continue
      for (const [key, field] of Object.entries(OBJECTS[type])) {
        if (!isRequired(field, minor) || !inVersion(field, minor) || key in node) continue
        if (type === 'Response' && key === 'description' && !node.content) continue
        report(type, dataPath, key)
      }
      if (type === 'SecurityScheme') {
        for (const key of BY_SCHEME_TYPE[node.type] ?? []) {
          if (!(key in node)) report(type, dataPath, key)
        }
      }
      // 3.1 made `paths` optional, provided the document holds something.
      if (type === 'OpenAPI' && minor >= 1 && !node.paths && !node.components && !node.webhooks) {
        report(type, dataPath, 'paths')
      }
    }
  },
}
