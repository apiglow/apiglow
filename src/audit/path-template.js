// Names of the `{template}` variables of a path, in declaration order.
// Duplicates are kept: `/a/{id}/b/{id}` is a real (and broken) template, and
// collapsing it would hide half the problem from the rules.
const TEMPLATE_RE = /\{([^{}]+)\}/g

export function templateNames(path) {
  return [...String(path).matchAll(TEMPLATE_RE)].map((match) => match[1])
}

// A Paths key that can be appended to a server URL: a leading `/`, no `?` or
// `#`, braces balanced, none empty or nested, each name once. `path-syntax`
// reports the others; the rules matching templates with parameters skip them,
// so a malformed key is reported once.
export function wellFormed(path) {
  if (!path.startsWith('/') || /[?#]/.test(path)) return false
  const names = new Set()
  let open = -1
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] === '{') {
      if (open >= 0) return false
      open = i
    } else if (path[i] === '}') {
      if (open < 0 || i === open + 1) return false
      const name = path.slice(open + 1, i)
      if (names.has(name)) return false
      names.add(name)
      open = -1
    }
  }
  return open < 0
}
