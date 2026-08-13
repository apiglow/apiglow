// Names of the `{template}` variables of a path, in declaration order.
// Duplicates are kept: `/a/{id}/b/{id}` is a real (and broken) template, and
// collapsing it would hide half the problem from the rules.
const TEMPLATE_RE = /\{([^{}]+)\}/g

export function templateNames(path) {
  return [...String(path).matchAll(TEMPLATE_RE)].map((match) => match[1])
}
