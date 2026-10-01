import { placeOf } from '../locate.js'
import { serverDefaultUrl } from '../security.js'

// A server URL left at the documentation placeholder: a host RFC 2606 reserves
// for examples — `example.com`, `example.net`, `example.org` and their
// subdomains, any name under the `.example` or `.invalid` top-level domains.
// No API answers there. The try-it sends to the operation's own server, else
// to the environment the reader seeded from a root server, else to the first
// root server: from this one, every request goes to a host that is not the
// API, and the reader learns it from a network error.
//
// The URL is read with its variables at their defaults (`serverDefaultUrl`),
// the base this documentation sends to. `.test` and `localhost` are not
// placeholders: RFC 6761 sets them aside for testing and local servers, which
// a document may legitimately point at. A relative URL takes the page's host.
// Every Server the client calls: root, Path Item, Operation; not a Link's
// `server`, nor one inside a webhook or a callback (the API calls those).
// Plain http is `server-https`'s; an undeclared variable, `server-variables`'.
export const serverPlaceholder = {
  id: 'server-placeholder',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Server' || typeof node.url !== 'string') continue
      if (dataPath.endsWith('/server')) continue
      if (dataPath.startsWith('/webhooks/') || dataPath.includes('/callbacks/')) continue
      const url = serverDefaultUrl(node)
      const host = hostOf(url)
      if (host === null) continue
      check(!isReserved(host), {
        ...placeOf(ctx.operations, dataPath),
        dataPath: `${dataPath}/url`,
        params: { url },
      })
    }
  },
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '') || null
  } catch {
    return null
  }
}

const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']
const RESERVED_TLDS = ['example', 'invalid']

function isReserved(host) {
  const labels = host.split('.')
  if (RESERVED_TLDS.includes(labels.at(-1))) return true
  return RESERVED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}
