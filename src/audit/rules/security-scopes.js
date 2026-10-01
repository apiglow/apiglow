import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A Security Requirement asking a scheme for a scope it does not have. For an
// `oauth2` scheme, the scopes an operation lists are what a client asks the
// authorization server for, and the flows' `scopes` maps are the ones that
// exist: one missing there is a typo or a renamed scope. This documentation's
// try-it preselects the operation's scopes among those the flow declares, so
// it drops this one, and the token it fetches lacks what the call needs. In
// 3.0, a requirement on a scheme other than `oauth2` and `openIdConnect` MUST
// list nothing (3.1 allows role names there).
//
// `openIdConnect` scopes are declared in the provider's discovery document,
// out of reach here; a scheme that is not declared is
// `security-scheme-declared`'s, a list that is not a list `field-value-kind`'s.
// One check per scope that should not be there.

export const securityScopes = {
  id: 'security-scopes',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const schemes = ctx.document.components?.securitySchemes
    if (!schemes || typeof schemes !== 'object') return
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'SecurityRequirement') continue
      for (const [name, scopes] of Object.entries(node)) {
        const scheme = Object.hasOwn(schemes, name) ? schemes[name] : undefined
        if (!scheme || typeof scheme !== 'object' || !Array.isArray(scopes)) continue
        const declared = declaredScopes(scheme, ctx.version.minor)
        if (declared === null) continue
        for (const [index, scope] of scopes.entries()) {
          if (typeof scope !== 'string' || declared.has(scope)) continue
          const at = `${dataPath}${pointer(name, index)}`
          check(false, {
            ...placeOf(ctx.operations, at),
            dataPath: at,
            params: { scope, name, type: String(scheme.type ?? '') },
          })
        }
      }
    }
  },
}

// The scopes a requirement may list for this scheme → a Set, or null when no
// verdict is possible.
function declaredScopes(scheme, minor) {
  if (scheme.type === 'oauth2') {
    const flows = scheme.flows
    if (!flows || typeof flows !== 'object') return null
    const names = new Set()
    for (const flow of Object.values(flows)) {
      if (flow?.scopes && typeof flow.scopes === 'object') {
        for (const scope of Object.keys(flow.scopes)) names.add(scope)
      }
    }
    return names
  }
  if (scheme.type === 'openIdConnect') return null
  return minor >= 1 ? null : new Set()
}
