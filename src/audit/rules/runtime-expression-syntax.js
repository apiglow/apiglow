import { isToken } from '../http-token.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A runtime expression the specification's grammar does not produce (OAS
// "Runtime Expressions" ABNF): `$request.query` with no source after it,
// `$response.headers.Location`, `$request.body/id` without its `#`, a JSON
// pointer with a bare `~`. Callbacks and links are where an API says "the URL
// comes from this field of the request" or "pass this value to that operation";
// a tool evaluating the expression has nothing to evaluate, and a reader is left
// to guess what was meant. This documentation shows the expression as written.
//
// Where expressions are: a Callback's keys, as `{$…}` parts of the URL template
// (or the whole key when it starts with `$`), and a Link's `parameters` values
// and `requestBody` when they are strings — a whole string starting with `$`,
// or `{$…}` parts embedded in one; any other string is a constant. One check
// per malformed expression.

export const runtimeExpressionSyntax = {
  id: 'runtime-expression-syntax',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const report = (expression, dataPath) =>
      check(false, { ...placeOf(ctx.operations, dataPath), dataPath, params: { expression } })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Callback') {
        for (const key of Object.keys(node)) {
          if (key.startsWith('x-')) continue
          for (const expression of expressionsIn(key)) {
            if (!isExpression(expression)) report(expression, `${dataPath}${pointer(key)}`)
          }
        }
      } else if (type === 'Link') {
        const values = []
        if (
          node.parameters &&
          typeof node.parameters === 'object' &&
          !Array.isArray(node.parameters)
        ) {
          for (const [name, value] of Object.entries(node.parameters)) {
            values.push([value, `${dataPath}${pointer('parameters', name)}`])
          }
        }
        if (node.requestBody !== undefined)
          values.push([node.requestBody, `${dataPath}/requestBody`])
        for (const [value, at] of values) {
          if (typeof value !== 'string') continue
          for (const expression of expressionsIn(value)) {
            if (!isExpression(expression)) report(expression, at)
          }
        }
      }
    }
  },
}

// A string → the expressions it holds: itself when it starts with `$`, else the
// `{$…}` parts embedded in it.
function expressionsIn(text) {
  if (text.startsWith('$')) return [text]
  return [...text.matchAll(/\{(\$[^}]*)\}/g)].map((match) => match[1])
}

function isExpression(text) {
  if (text === '$url' || text === '$method' || text === '$statusCode') return true
  const match = /^\$(request|response)\.(.*)$/s.exec(text)
  if (!match) return false
  const source = match[2]
  if (source.startsWith('header.')) return isToken(source.slice('header.'.length))
  // `name = *char`: any JSON string character.
  if (source.startsWith('query.') || source.startsWith('path.')) return true
  if (source === 'body') return true
  if (!source.startsWith('body#')) return false
  return isJsonPointer(source.slice('body#'.length))
}

// RFC 6901: empty, or `/`-separated tokens where `~` only escapes 0 or 1.
function isJsonPointer(text) {
  if (text === '') return true
  if (!text.startsWith('/')) return false
  return !/~(?![01])/.test(text)
}
