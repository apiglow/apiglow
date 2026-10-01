import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A server URL with a variable that has no valid value (OAS 3.x, Server and
// Server Variable Objects): a `{name}` in the URL with no `variables` entry —
// nothing to substitute, in any tool — a `default` outside its own `enum`
// (MUST exist in it), an `enum` with nothing in it (3.1+, MUST NOT be empty).
// Code generators refuse such a server or emit a base URL that cannot work;
// this documentation's base URL keeps the literal `{name}`, and every request
// the try-it builds on it goes nowhere.
//
// Every Server Object the document holds: root, Path Item, Operation, a
// Link's `server`. A variable declared but unused costs nothing and is not
// reported. One finding per problem.
const TEMPLATE = /\{([^{}]+)\}/g

export const serverVariables = {
  id: 'server-variables',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Server' || typeof node.url !== 'string') continue
      const report = (at, name) =>
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { name, url: node.url },
        })
      const variables =
        node.variables && typeof node.variables === 'object' && !Array.isArray(node.variables)
          ? node.variables
          : {}
      for (const [, name] of node.url.matchAll(TEMPLATE)) {
        if (!Object.hasOwn(variables, name)) report(`${dataPath}/url`, name)
      }
      for (const [name, variable] of Object.entries(variables)) {
        if (!variable || typeof variable !== 'object' || !Array.isArray(variable.enum)) continue
        const at = `${dataPath}${pointer('variables', name)}`
        if (!variable.enum.length) {
          if (ctx.version.minor >= 1) report(`${at}/enum`, name)
        } else if (
          typeof variable.default === 'string' &&
          !variable.enum.includes(variable.default)
        ) {
          report(`${at}/default`, name)
        }
      }
    }
  },
}
