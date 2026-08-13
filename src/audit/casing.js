// Naming conventions for the consistency rules (docs/audit.md §4.4). Nothing
// here prefers a convention: the document's own dominant style is the
// reference, and only the outliers are findings.

// A single lowercase word (`id`, `status`) is valid camelCase, snake_case and
// kebab-case at once: it votes for no convention and can never be an outlier.
export const AMBIGUOUS = 'ambiguous'

// → a style name, AMBIGUOUS, or null when the name follows no convention this
// rule can compare (mixed separators, leading underscore, dots…). Both mean
// "no verdict"; only the style names are counted.
export function nameStyle(name) {
  if (typeof name !== 'string' || !name) return null
  if (/^[a-z][a-z0-9]*$/.test(name)) return AMBIGUOUS
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return 'snake_case'
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(name)) return 'SCREAMING_SNAKE_CASE'
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) return 'kebab-case'
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase'
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase'
  return null
}

// Below this many classified names, "the document's convention" is a guess, and
// flagging the minority of a population of three is noise.
const MIN_POPULATION = 4

export function dominantStyle(styles) {
  const counts = new Map()
  for (const style of styles) {
    if (!style || style === AMBIGUOUS) continue
    counts.set(style, (counts.get(style) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (total < MIN_POPULATION) return null
  // Ties broken alphabetically rather than by insertion order: the report must
  // not depend on which operation the walk happened to reach first.
  let best = null
  for (const [style, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!best || count > best.count) best = { style, count }
  }
  return best.style
}

// One check per DISTINCT name: a parameter named `petId` in twenty operations is
// one naming decision, not twenty. `entries` is [{ name, target }] in document
// order, so the finding lands on the first place the name is declared.
export function checkNaming(check, entries) {
  const targets = new Map()
  for (const { name, target } of entries) if (!targets.has(name)) targets.set(name, target)
  const styles = new Map([...targets.keys()].map((name) => [name, nameStyle(name)]))
  const dominant = dominantStyle(styles.values())
  if (!dominant) return
  for (const [name, target] of targets) {
    const style = styles.get(name)
    if (!style || style === AMBIGUOUS) continue
    check(style === dominant, { ...target, params: { name, style, dominant } })
  }
}
