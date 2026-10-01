import { placeOf } from '../locate.js'
import { isUriReference } from '../uri.js'

// A server URL that is no URL template (OAS 3.x, Server Object `url`): text
// that is no URL once its `{…}` variables are set aside — spaces, characters a
// URL never holds unescaped, a stray or empty brace (3.2 writes the
// `server-url-template` grammar down, earlier versions ask for "a URL") — or,
// from 3.2, a variable used twice (MUST NOT). Code generators refuse such a
// server or emit a base URL that cannot work; this documentation's base URL
// keeps the literal text, and every request the try-it builds on it goes
// nowhere.
//
// Every Server Object the document holds: root, Path Item, Operation, a
// Link's `server`. One check per malformed URL, none otherwise. The
// variables' own values are `server-variables`'.
const TEMPLATE = /\{([^{}]+)\}/g

export const serverUrlForm = {
  id: 'server-url-form',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Server' || typeof node.url !== 'string') continue
      const names = [...node.url.matchAll(TEMPLATE)].map(([, name]) => name)
      const repeated = ctx.version.minor >= 2 && new Set(names).size < names.length
      if (isUriReference(node.url.replace(TEMPLATE, 'x')) && !repeated) continue
      const at = `${dataPath}/url`
      check(false, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: { url: node.url },
      })
    }
  },
}
