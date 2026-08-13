// Static maps only: dynamically built classes
// (`badge-${x}`) would be purged by the Tailwind JIT (rule 2 of CLAUDE.md).

// `badge-soft` carried by the map itself, not by the callers: the method
// badge is a marker, not an alert, and must be identical everywhere
// (nav, doc, try-it, history). Callers only set the size.
export const METHOD_BADGE = {
  get: 'badge badge-soft badge-info',
  post: 'badge badge-soft badge-success',
  // PUT and PATCH share yellow: same write gesture on an
  // existing resource, full or partial. Only DELETE, irreversible, keeps red.
  put: 'badge badge-soft badge-warning',
  patch: 'badge badge-soft badge-warning',
  delete: 'badge badge-soft badge-error',
  // QUERY (3.2): reads like GET but with a body — distinct color
  // so it isn't confused. Free-form methods (`additionalOperations`)
  // have no entry: they fall back to the callers' neutral badge.
  query: 'badge badge-soft badge-secondary',
  options: 'badge badge-ghost',
  head: 'badge badge-ghost',
  trace: 'badge badge-ghost',
}

// The full class list of a method badge, size apart. The map above says the
// badge must look identical everywhere; this is what makes that true instead
// of hoping eight literals stay in step. Returns a STRING rather than a node
// because one caller builds HTML, not DOM (the docs-page markdown renderer).
export function methodBadgeClass(method, size = 'badge-xs') {
  return `${METHOD_BADGE[method] ?? 'badge badge-ghost'} ${size} font-mono uppercase shrink-0`
}

// Color class per HTTP status code family ('2' → 2xx…, 'd' → default).
const STATUS_TEXT = {
  1: 'text-info',
  2: 'text-success',
  3: 'text-info',
  4: 'text-warning',
  5: 'text-error',
  default: 'text-subtle',
}

export function statusColorClass(status) {
  return STATUS_TEXT[String(status)[0]] ?? STATUS_TEXT.default
}
