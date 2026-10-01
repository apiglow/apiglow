import { isSupportedOpenapi } from '../../openapi/versions.js'
import { describeValue } from '../value-check.js'

// A file that holds no OpenAPI description this app reads: nothing at all, a
// list, a sentence, a Swagger 1.x document, an OpenAPI 4 or an unknown 3.x.
// Nothing reads it as an API — this documentation refuses to render it, and so
// do validators and code generators.
//
// A mapping with a version it does not know is still graded, with the newest
// rules (3.2, rule 19): this finding says why the grade means little. A mapping
// with no `openapi` field at all is `required-field-missing`'s, and a
// non-string one `field-value-kind`'s — both pass here. Anything that is no
// mapping is the whole report (`file: true`, the only rules the engine runs on
// it). Swagger 2.0 never reaches this rule as such: the loader converts it.
//
// `found` is what the file holds, in a notation no language has to translate:
// `(empty)`, `[…]`, `"hello world"`, `swagger: 1.2`, `openapi: 4.0.0`. One
// check per file.
export const documentOpenapi = {
  id: 'document-openapi',
  category: 'correctness',
  severity: 'error',
  file: true,
  run(ctx, check) {
    const { found, dataPath } = ctx.mapping ? declaredVersion(ctx.source) : held(ctx.content)
    check(found === null, { location: dataPath.slice(1), dataPath, params: { found } })
  },
}

function declaredVersion(document) {
  const { openapi, swagger } = document
  if (typeof openapi === 'string') {
    return isSupportedOpenapi(openapi)
      ? { found: null, dataPath: '/openapi' }
      : { found: `openapi: ${openapi}`, dataPath: '/openapi' }
  }
  if (openapi === undefined && swagger !== undefined && swagger !== null) {
    return { found: `swagger: ${describe(swagger)}`, dataPath: '/swagger' }
  }
  return { found: null, dataPath: '' }
}

function held(content) {
  if (content === undefined || content === null) return { found: '(empty)', dataPath: '' }
  if (Array.isArray(content)) return { found: '[…]', dataPath: '' }
  return { found: describeValue(content), dataPath: '' }
}

const describe = (value) => (typeof value === 'string' ? value : describeValue(value))
