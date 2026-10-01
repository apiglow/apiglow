import { resolvePointer } from '../../scenarios/pointer.js'
import { placeOf } from '../locate.js'

// A `style` the parameter's location or its type does not allow (OAS 3.x,
// Parameter Object, "Style Values"): `matrix` on a query parameter, `form` on a
// header, `deepObject` on an array, `spaceDelimited` on a string. Each style
// is a serialization defined for some locations and some types only; outside
// them nothing says what goes on the wire. Code generators reject the
// parameter or fall back to their default, and this documentation builds the
// URL with a delimiter or a shape the server was never told to expect.
//
// A style no version knows is `field-value-kind`'s; `style: cookie` before 3.2
// is `version-construct`'s. An `in: querystring` parameter takes no style at
// all — its `content` says how the whole query string is written. The type is
// read from the declared `schema`; none declared, no verdict on it. One
// finding per mismatched style, at the parameter's definition.
const BY_LOCATION = {
  path: ['matrix', 'label', 'simple'],
  query: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
  header: ['simple'],
  cookie: ['form', 'cookie'],
  querystring: [],
}

// Styles that only serialize some types. The others take primitives, arrays
// and objects alike.
const BY_TYPE = {
  deepObject: ['object'],
  spaceDelimited: ['array', 'object'],
  pipeDelimited: ['array', 'object'],
}

export const parameterStyleValid = {
  id: 'parameter-style-valid',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Parameter' || typeof node.style !== 'string') continue
      const allowed = BY_LOCATION[node.in]
      if (!allowed) continue
      const at = `${dataPath}/style`
      const target = { ...placeOf(ctx.operations, at), dataPath: at }
      if (!allowed.includes(node.style)) {
        if (knownStyle(node.style)) {
          check(false, {
            ...target,
            params: { name: String(node.name), style: node.style, in: node.in },
          })
        }
        continue
      }
      const types = declaredTypes(resolvePointer(ctx.document, `${dataPath}/schema`).value)
      const wanted = BY_TYPE[node.style]
      if (!wanted || !types.length || types.some((t) => wanted.includes(t))) continue
      check(false, {
        ...target,
        params: { name: String(node.name), style: node.style, in: node.in },
      })
    }
  },
}

function knownStyle(style) {
  return Object.values(BY_LOCATION).some((styles) => styles.includes(style))
}

function declaredTypes(schema) {
  if (!schema || typeof schema !== 'object') return []
  const declared = Array.isArray(schema.type) ? schema.type : [schema.type]
  return declared.filter((t) => typeof t === 'string' && t !== 'null')
}
