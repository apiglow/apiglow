import { securityRequirements } from '../openapi/auth.js'
import { listOf } from '../openapi/model.js'
import { serverUrl } from '../openapi/servers.js'

// What the security rules (docs/audit.md §4.8) read of an operation: the
// requirement that applies to it, and where it sends its requests. One reading,
// shared with the try-it (`securityRequirements`, `serverUrl`), so that the
// report never judges an operation the page treats otherwise.

// → { alternatives, declared, anonymous } (`securityRequirements`).
export function effectiveSecurity(ctx, entry) {
  return securityRequirements(entry.op.security, ctx.document.security)
}

// The raw security scheme a requirement names, or null when it names none —
// an undeclared scheme is `security-scheme-declared`'s.
export function schemeNamed(ctx, name) {
  const scheme = ctx.document.components?.securitySchemes?.[name]
  return scheme && typeof scheme === 'object' ? scheme : null
}

// The server URLs a request to the operation goes to: its own `servers`, else
// its Path Item's, else the document's.
export function operationServerUrls(ctx, entry) {
  const servers = [entry.op.servers, entry.pathItem.servers, ctx.document.servers].find(
    (list) => Array.isArray(list) && list.length,
  )
  return listOf(servers)
    .filter((server) => server && typeof server.url === 'string')
    .map((server) => serverDefaultUrl(ctx, server))
}

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i

// A raw Server Object's URL as the try-it sends to it: each declared variable
// at its default (`serverUrl`; an undeclared `{name}` stays, `server-variables`'),
// a relative URL resolved against the document's 3.2 `$self`. Without `$self`
// the try-it resolves it against wherever the document was read from, which
// the audit is not told: the URL stays relative. An absolute URL is kept as
// written, so a finding quotes it the way the author spelled it.
export function serverDefaultUrl(ctx, server) {
  const variables = Object.entries(server.variables ?? {}).map(([name, variable]) => ({
    name,
    default: variable?.default,
  }))
  const url = serverUrl({ url: server.url, variables })
  const base = ctx.model.baseUri
  if (!base || ABSOLUTE.test(url)) return url
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}
