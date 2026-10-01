import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A server URL variable with no valid value (OAS 3.x, Server and Server
// Variable Objects): a `{name}` with no `variables` entry — nothing to
// substitute, in any tool — a `default` outside its own `enum`, an `enum` with
// nothing in it (3.1+: MUST and MUST NOT, where 3.0 only says SHOULD). Code
// generators refuse such a server or emit a base URL that cannot work; this
// documentation's base URL keeps the literal braces, and every request the
// try-it builds on it goes nowhere.
//
// Every Server Object the document holds: root, Path Item, Operation, a
// Link's `server`. A variable declared but unused costs nothing and is not
// reported; an undeclared one is reported once, however often the URL uses
// it. Whether the URL is a URL template at all is `server-url-form`'s.
const TEMPLATE = /\{([^{}]+)\}/g

export const serverVariables = {
  id: 'server-variables',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
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
      const names = new Set([...node.url.matchAll(TEMPLATE)].map(([, name]) => name))
      for (const name of names) {
        if (!Object.hasOwn(variables, name)) report(`${dataPath}/url`, name)
      }
      if (minor < 1) continue
      for (const [name, variable] of Object.entries(variables)) {
        if (!variable || typeof variable !== 'object' || !Array.isArray(variable.enum)) continue
        const at = `${dataPath}${pointer('variables', name)}`
        if (!variable.enum.length) report(`${at}/enum`, name)
        else if (typeof variable.default === 'string' && !variable.enum.includes(variable.default))
          report(`${at}/default`, name)
      }
    }
  },
}
