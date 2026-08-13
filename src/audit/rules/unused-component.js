import { pointer } from '../pointer.js'

// Dead components: nothing references them, so they document nothing, but they
// are still shipped to every reader and still have to be maintained. Usually
// the leftovers of a removed endpoint.
//
// Read on the SOURCE document (docs/audit.md §5): once dereferenced, a `$ref`
// is indistinguishable from an inline definition, and this rule would have
// nothing left to observe.
// Every section a `components` object can hold, `pathItems` (3.1+) included:
// the first four were an arbitrary subset, and a dead `requestBodies` entry
// costs a reader exactly as much as a dead schema. Anything not listed here is
// invisible to the rule, so this list follows the spec, not the demo schema.
const SECTIONS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
]

export const unusedComponent = {
  id: 'unused-component',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const refs = collectRefs(ctx.source)
    // A security scheme is never `$ref`'d: it is named in a Security
    // Requirement, which is a plain object keyed by scheme name.
    const schemes = collectSecurityNames(ctx.source)
    for (const section of SECTIONS) {
      const components = ctx.source.components?.[section]
      if (!components || typeof components !== 'object') continue
      for (const name of Object.keys(components)) {
        const used =
          section === 'securitySchemes'
            ? schemes.has(name)
            : refs.has(`#/components/${section}/${name}`)
        check(used, {
          location: `components.${section}.${name}`,
          dataPath: pointer('components', section, name),
          params: { section, name },
        })
      }
    }
  },
}

// Reference counting is direct, not transitive: a component referenced only by
// another unused component is reported as used. Removing the first one makes
// the second show up on the next run, which is the natural order to clean up in.
function collectRefs(source) {
  const refs = new Set()
  walk(source, (node) => {
    if (typeof node.$ref === 'string') refs.add(node.$ref)
  })
  return refs
}

function collectSecurityNames(source) {
  const names = new Set()
  walk(source, (node) => {
    if (!Array.isArray(node.security)) return
    for (const requirement of node.security) {
      if (requirement && typeof requirement === 'object') {
        for (const name of Object.keys(requirement)) names.add(name)
      }
    }
  })
  return names
}

// The source document still has its `$ref`s, so it is a tree — but it is
// external input: identity dedup and a depth budget keep the walk bounded
// whatever it contains (rule 7).
const MAX_DEPTH = 40

function walk(value, visit, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object') return
  if (depth > MAX_DEPTH || seen.has(value)) return
  seen.add(value)
  if (!Array.isArray(value)) visit(value)
  for (const child of Object.values(value)) walk(child, visit, seen, depth + 1)
}
