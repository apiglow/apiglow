import { carriedSchemes } from '../../export/mcp.js'
import { listOf } from '../../openapi/model.js'
import { effectiveSecurity } from '../security.js'
import { toolOperations } from '../tool-inputs.js'

// An operation the MCP server this documentation exports cannot call as
// written. The export wires an off-the-shelf bridge (`src/export/mcp.js`), and
// a bridge talks to the API with plain HTTP requests whose only configurable
// part is a set of headers:
//
// - a cookie parameter is never sent — neither `@ivotoby/openapi-mcp-server`
//   nor `@tyk-technologies/api-to-mcp` sends cookies, so the call goes out
//   without the value the API expects;
// - a credential the config does not hold — an `apiKey` in a query or a
//   cookie, `mutualTLS`, an `http` scheme with no scheme name, a deprecated
//   scheme, or a second scheme sent in a header an earlier one already fills
//   (`basic` then `bearer`, both `Authorization`: the config keeps the first) —
//   is not sent: the call goes out without it.
//
// Which schemes the config holds is the export's own answer
// (`carriedSchemes`), asked of the same normalized schemes, so this rule and
// the generated config cannot disagree. The security that applies is the
// operation's, else the document's; it is satisfied when one alternative has
// every scheme held — an empty alternative (`{}`, anonymous access) counts. A
// scheme named but not declared gives no verdict: that is
// `security-scheme-declared`'s.
//
// One check per tool operation; `names` lists the cookie parameters and the
// schemes the export cannot carry.
export const bridgeDegradation = {
  id: 'bridge-degradation',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const schemes = listOf(ctx.model.securitySchemes)
    const declared = new Set(schemes.map((scheme) => scheme.name))
    const carried = carriedSchemes(schemes)
    for (const entry of toolOperations(ctx)) {
      const names = []
      for (const { param } of entry.parameters) {
        if (param.in === 'cookie' && typeof param.name === 'string') names.push(param.name)
      }
      const { alternatives } = effectiveSecurity(ctx, entry)
      names.push(...unreachableSchemes(alternatives, declared, carried))
      check(!names.length, {
        op: entry,
        params: { names: [...new Set(names)].join(', ') },
      })
    }
  },
}

// The schemes the config does not hold, when no alternative of the requirement
// list can be met with the ones it does; none when one can.
function unreachableSchemes(alternatives, declared, carried) {
  const lacking = new Set()
  for (const alternative of alternatives) {
    const missing = Object.keys(alternative).filter(
      (name) => declared.has(name) && !carried.has(name),
    )
    if (!missing.length) return []
    for (const name of missing) lacking.add(name)
  }
  return [...lacking]
}
