// Hiding operations (docs/architecture.md): two independent
// sources, both absorbed by normalization — a hidden
// operation doesn't exist in the model, so it's in neither the nav, nor
// the search, nor the exports (llms-full, Markdown), nor the diff.
//
// 1. `x-apiglow-hide: true` in the schema (operation, Path Item or `tags`
//    entry), for whoever controls their spec;
// 2. `openapi.hide` patterns from the host config, for whoever doesn't control it —
//    passed as an option to `normalizeDocument`, never read by the core (rule 10).

export const HIDE_EXTENSION = 'x-apiglow-hide'

// `METHOD /path` — the path must be absolute, which unambiguously
// distinguishes it from an operationId (never parsed as method + space).
const METHOD_PATH_RE = /^([a-z]+)\s+(\/.*)$/i

// → (candidate) => bool, candidate = { id, operationId, method, path, tags }.
// Three pattern forms, `*` allowed everywhere as a wildcard:
//   'tag:Internal'        all endpoints carrying this tag
//   'DELETE /admin/*'     method + path
//   '/admin/*'            path, all methods
//   'resetDatabase'       operationId (or fallback id `{method}-{slug}`)
export function compileHideRules(patterns) {
  const rules = []
  for (const raw of Array.isArray(patterns) ? patterns : []) {
    const pattern = String(raw ?? '').trim()
    if (!pattern) continue

    if (/^tag:/i.test(pattern)) {
      const tag = pattern.slice(4).trim()
      if (tag) rules.push((c) => c.tags.includes(tag))
      continue
    }

    const methodPath = METHOD_PATH_RE.exec(pattern)
    if (methodPath) {
      const method = methodPath[1].toLowerCase()
      const path = globToRegExp(methodPath[2])
      rules.push((c) => c.method === method && path.test(c.path))
      continue
    }

    if (pattern.startsWith('/')) {
      const path = globToRegExp(pattern)
      rules.push((c) => path.test(c.path))
      continue
    }

    const id = globToRegExp(pattern)
    rules.push((c) => id.test(c.id) || (c.operationId !== undefined && id.test(c.operationId)))
  }
  if (!rules.length) return () => false
  return (candidate) => rules.some((rule) => rule(candidate))
}

function globToRegExp(pattern) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}
