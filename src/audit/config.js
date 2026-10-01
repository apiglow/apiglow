import { SEVERITIES } from './constants.js'
import { RULES } from './rules/index.js'

// The audit's rule configuration (docs/audit.md §2.2, §3): which rules run, at
// which severity, and where. The host declares it under `audit` — root and
// `openapi.specs[]` entries alike — and the CLI reads the same key, so the page
// and the pipeline grade one document the same way.
//
//   { "rules": { "<ruleId>": "error" | "warning" | "info" | "off" },
//     "overrides": [ { "paths": ["/paths/~1legacy~1*"],
//                      "rules": { "<ruleId>": "off" },
//                      "reason": "frozen legacy API" } ] }
//
// A grade computed under such a configuration is not the default grade, and is
// never presented as one: the report carries the profile it was computed
// under (`auditProfile`).

export const RULE_OFF = 'off'
const SETTINGS = [...SEVERITIES, RULE_OFF]

// The raw `audit` block → { config, errors }. Every entry is checked against
// the registry: a misspelled rule id or severity silently read as "nothing to
// change" would grade a document under a configuration nobody wrote. Errors
// name the entry; the valid part of the block is kept, so the page can still
// apply it while the CLI refuses to run (it treats any error as fatal).
export function readAuditConfig(raw, ruleIds = RULES.map((rule) => rule.id)) {
  const known = new Set(ruleIds)
  const errors = []
  const config = { rules: {}, overrides: [] }
  if (raw == null) return { config, errors }
  if (!isPlainObject(raw)) return { config, errors: ['audit: expected an object'] }

  config.rules = readRules(raw.rules, 'audit.rules', known, errors)
  if (raw.overrides !== undefined && !Array.isArray(raw.overrides)) {
    errors.push('audit.overrides: expected a list')
  }
  for (const [index, entry] of (Array.isArray(raw.overrides) ? raw.overrides : []).entries()) {
    const at = `audit.overrides[${index}]`
    if (!isPlainObject(entry)) {
      errors.push(`${at}: expected an object`)
      continue
    }
    const paths = Array.isArray(entry.paths) ? entry.paths : []
    const valid = paths.filter((path) => typeof path === 'string' && path.startsWith('/'))
    if (!paths.length || valid.length !== paths.length) {
      errors.push(`${at}.paths: expected a list of JSON pointers, each starting with "/"`)
    }
    const rules = readRules(entry.rules, `${at}.rules`, known, errors)
    if (!valid.length || !Object.keys(rules).length) continue
    config.overrides.push({
      paths: valid,
      matchers: valid.map(pointerMatcher),
      rules,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    })
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'rules' && key !== 'overrides') errors.push(`audit.${key}: unknown key`)
  }
  return { config, errors }
}

function readRules(raw, at, known, errors) {
  const rules = {}
  if (raw === undefined) return rules
  if (!isPlainObject(raw)) {
    errors.push(`${at}: expected an object`)
    return rules
  }
  for (const [id, setting] of Object.entries(raw)) {
    if (!known.has(id)) errors.push(`${at}: unknown rule "${id}"`)
    else if (!SETTINGS.includes(setting)) {
      errors.push(`${at}.${id}: "${setting}" is not one of ${SETTINGS.join(', ')}`)
    } else rules[id] = setting
  }
  return rules
}

// rule → its severity at a given pointer: the rule's own, then `rules`, then
// every override whose paths cover the pointer, in declaration order — the
// last word wins, as in a stylesheet. Returns null for a rule switched off
// everywhere, so the engine does not even run it.
export function severityResolver(config) {
  return (rule) => {
    const base = config?.rules?.[rule.id] ?? rule.severity
    const overrides = (config?.overrides ?? []).filter((entry) => rule.id in entry.rules)
    if (!overrides.length) return base === RULE_OFF ? null : () => base
    return (dataPath) => {
      let setting = base
      for (const entry of overrides) {
        if (entry.matchers.some((matches) => matches(dataPath))) setting = entry.rules[rule.id]
      }
      return setting === RULE_OFF ? null : setting
    }
  }
}

// What the report says about the configuration it was graded under. `custom`
// is the flag a reader needs; the counts tell them how far from the default.
export function auditProfile(config) {
  const rules = Object.keys(config?.rules ?? {}).length
  const overrides = config?.overrides?.length ?? 0
  return { custom: rules > 0 || overrides > 0, rules: config?.rules ?? {}, overrides }
}

// A JSON pointer pattern → a predicate. `*` matches within one segment, `**`
// as a whole segment matches any number of them. A pattern covers what it
// matches and everything below it: `/paths/~1legacy~1*` reaches every
// operation, parameter and schema of the legacy paths, which is what an author
// writing it means.
function pointerMatcher(pattern) {
  const source = pattern
    .split('/')
    .slice(1)
    .map((segment) =>
      segment === '**' ? '(?:/[^/]*)*' : `/${segment.split('*').map(escapeRegExp).join('[^/]*')}`,
    )
    .join('')
  const regex = new RegExp(`^${source}(?:/.*)?$`)
  return (dataPath) => regex.test(dataPath)
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
