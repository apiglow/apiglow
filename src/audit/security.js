import { listOf } from '../openapi/model.js'

// What the security rules (docs/audit.md §4.8) read of an operation: the
// requirement that applies to it, and where it sends its requests. One reading,
// so that two rules never disagree on whether an operation is secured.

// The operation's own `security`, else the document's. → { alternatives,
// declared, anonymous }: the requirement objects (a malformed entry left out),
// whether any `security` applies at all, and whether one alternative is empty
// (`{}`, or `security: []` on the operation) — access without credentials.
// A list holding only malformed entries (`security: [api_key]`) is neither
// anonymous nor secured: no alternative, and no verdict.
export function effectiveSecurity(ctx, entry) {
  const own = entry.op.security
  const declared = Array.isArray(own) || Array.isArray(ctx.document.security)
  const list = Array.isArray(own) ? own : listOf(ctx.document.security)
  const alternatives = list.filter(
    (alternative) =>
      alternative !== null && typeof alternative === 'object' && !Array.isArray(alternative),
  )
  const anonymous =
    (declared && !list.length) ||
    alternatives.some((alternative) => !Object.keys(alternative).length)
  return { alternatives, declared, anonymous }
}

// The raw security scheme a requirement names, or null when it names none —
// an undeclared scheme is `security-scheme-declared`'s.
export function schemeNamed(ctx, name) {
  const scheme = ctx.document.components?.securitySchemes?.[name]
  return scheme && typeof scheme === 'object' ? scheme : null
}

// The server URLs a request to the operation goes to: its own `servers`, else
// its Path Item's, else the document's — each URL with its variables at their
// defaults, the base this documentation sends to.
export function operationServerUrls(ctx, entry) {
  const servers = [entry.op.servers, entry.pathItem.servers, ctx.document.servers].find(
    (list) => Array.isArray(list) && list.length,
  )
  return listOf(servers)
    .filter((server) => server && typeof server.url === 'string')
    .map(serverDefaultUrl)
}

// A Server Object's URL with each declared variable at its default; an
// undeclared `{name}` stays (`server-variables`').
export function serverDefaultUrl(server) {
  const variables = server.variables && typeof server.variables === 'object' ? server.variables : {}
  return server.url.replace(/\{([^{}]+)\}/g, (match, name) => {
    const value = variables[name]?.default
    return typeof value === 'string' ? value : match
  })
}
