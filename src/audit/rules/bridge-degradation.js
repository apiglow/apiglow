import { credentialHeader } from '../../export/mcp.js'
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
// - a credential with no header form — an `apiKey` in a query or a cookie,
//   `mutualTLS`, an `http` scheme with no scheme name — has no place in the
//   config: the export leaves it out, its card warns that the scheme must be
//   configured in the bridge itself, and the generated config sends the call
//   without it.
//
// "Header form" is the export's own verdict (`credentialHeader`), asked of
// the normalized scheme, so this rule and the generated config cannot
// disagree. The security that applies is the operation's, else the
// document's; it is satisfied when one alternative has every scheme in a
// header form — an empty alternative (`{}`, anonymous access) counts. A scheme
// named but not declared gives no verdict: that is
// `security-scheme-declared`'s.
//
// One check per tool operation; `names` lists the cookie parameters and the
// schemes the export cannot carry.
export const bridgeDegradation = {
  id: 'bridge-degradation',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const schemes = new Map(
      listOf(ctx.model.securitySchemes).map((scheme) => [scheme.name, scheme]),
    )
    for (const entry of toolOperations(ctx)) {
      const names = []
      for (const { param } of entry.parameters) {
        if (param.in === 'cookie' && typeof param.name === 'string') names.push(param.name)
      }
      const { alternatives, anonymous } = effectiveSecurity(ctx, entry)
      if (!anonymous) names.push(...unreachableSchemes(alternatives, schemes))
      check(!names.length, {
        op: entry,
        params: { names: [...new Set(names)].join(', ') },
      })
    }
  },
}

// The schemes no header carries, when no alternative of the requirement list
// can be met through headers alone; none when one can.
function unreachableSchemes(alternatives, schemes) {
  const lacking = new Set()
  for (const alternative of alternatives) {
    const missing = Object.keys(alternative).filter((name) => {
      const scheme = schemes.get(name)
      // The export also leaves a deprecated scheme out of the config: an
      // operation it alone secures gets no credential either.
      return scheme !== undefined && (scheme.deprecated || !credentialHeader(scheme))
    })
    if (!missing.length) return []
    for (const name of missing) lacking.add(name)
  }
  return [...lacking]
}
