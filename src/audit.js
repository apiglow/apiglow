// The schema audit as the page loads it: on the first visit to #/audit, as a
// file of its own next to app.js (docs/architecture.md §14.8). Engine, rules,
// and the English texts of the rules — the part of the catalog only the audit
// reads, which the main bundle leaves out (vite.config.js).
import en from './i18n/en.json' with { type: 'json' }

export { readAuditConfig } from './audit/config.js'
export { auditRun } from './audit/engine.js'

export const strings = Object.fromEntries(
  Object.entries(en).filter(([key]) => key.startsWith('audit.rule.')),
)
