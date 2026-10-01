import { pointer } from '../pointer.js'

// A `pattern` — or a `patternProperties` key — that is no regular expression:
// an unclosed group, a dangling quantifier, an unbalanced bracket. JSON Schema
// asks for an ECMA-262 regular expression; a validator compiling it fails,
// often on the whole schema rather than on the one field, and a code generator
// copies it into a validation annotation that throws at runtime. This
// documentation only shows it as written, so nothing here reveals it is broken.
//
// Invalid both with and without the `u` flag: a pattern either reading accepts
// is left alone. One check per broken pattern, none otherwise.
export const patternValid = {
  id: 'pattern-valid',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (typeof schema.pattern === 'string' && !compiles(schema.pattern)) {
        check(false, {
          op,
          location,
          dataPath: `${dataPath}/pattern`,
          params: { pattern: schema.pattern },
        })
      }
      const keys = schema.patternProperties
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) continue
      for (const pattern of Object.keys(keys)) {
        if (compiles(pattern)) continue
        check(false, {
          op,
          location,
          dataPath: `${dataPath}${pointer('patternProperties', pattern)}`,
          params: { pattern },
        })
      }
    }
  },
}

function compiles(pattern) {
  for (const flags of ['u', '']) {
    try {
      new RegExp(pattern, flags)
      return true
    } catch {
      // the other reading may accept it
    }
  }
  return false
}
