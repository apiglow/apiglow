// The English catalog is one file in the sources (src/i18n/en.json) and two
// slices in the build: the rule texts of the schema audit ship with the audit
// (dist/audit.js), everything else with the app (dist/app.js) —
// docs/architecture.md §14.8. Each bundle keeps only its slice, so neither
// carries the other's strings; in dev nothing is sliced, and the audit's
// strings merely arrive twice.
import { fileURLToPath } from 'node:url'

const CATALOG = fileURLToPath(new URL('../src/i18n/en.json', import.meta.url))
export const AUDIT_STRING = (key) => key.startsWith('audit.rule.')

export function catalogSlice(keep) {
  return {
    name: 'catalog-slice',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (id.split('?')[0] !== CATALOG) return null
      const entries = Object.entries(JSON.parse(code)).filter(([key]) => keep(key))
      return { code: JSON.stringify(Object.fromEntries(entries)), map: null }
    },
  }
}
