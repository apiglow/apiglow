import { SEVERITIES } from './constants.js'
import { RULES } from './rules/index.js'

// The audit's rule configuration (docs/audit.md §2.2, §3): which rules run, at
// which severity, and where. The host declares it under `audit` — root and
// `openapi.specs[]` entries alike — and the CLI reads the same key, so the page
// and the pipeline grade one document the same way.
//
//   { "rules": { "<ruleId>": "error" | "warning" | "info" | "off",
//                "<ruleId>": { "severity": "warning", "<option>": <value> } },
//     "overrides": [ { "paths": ["/paths/~1legacy~1*"],
//                      "rules": { "<ruleId>": "off" },
//                      "reason": "frozen legacy API" } ] }
//
// The object form carries the options a rule declares (`rule.options`), next
// to an optional severity — Redocly's shape, the one OpenAPI authors already
// write. Options are document-wide: an override changes severities only, since
// a threshold that moves from one path to the next would grade one document by
// two different yardsticks.
//
// A grade computed under such a configuration is not the default grade, and is
// never presented as one: the report carries the profile it was computed
// under (`auditProfile`).

const RULE_OFF = 'off'
const OVERRIDE_KEYS = new Set(['paths', 'rules', 'reason'])
const SETTINGS = [...SEVERITIES, RULE_OFF]

// The raw `audit` block → { config, errors }. Every entry is checked against
// the registry: a misspelled rule id or severity silently read as "nothing to
// change" would grade a document under a configuration nobody wrote. Errors
// name the entry; the valid part of the block is kept, so the page can still
// apply it while the CLI refuses to run (it treats any error as fatal).
export function readAuditConfig(raw, rules = RULES) {
  const known = new Map(rules.map((rule) => [rule.id, rule]))
  const errors = []
  const config = { rules: {}, options: {}, overrides: [] }
  if (raw == null) return { config, errors }
  if (!isPlainObject(raw)) return { config, errors: ['audit: expected an object'] }

  config.rules = readRules(raw.rules, 'audit.rules', known, errors, config.options)
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
    if (entry.rules === undefined) errors.push(`${at}.rules: missing — an override changes rules`)
    const rules = readRules(entry.rules, `${at}.rules`, known, errors)
    // `reason` is for the next reader of the config — JSON has no comments —
    // and the audit has no use for it beyond checking it is text.
    if (entry.reason !== undefined && typeof entry.reason !== 'string') {
      errors.push(`${at}.reason: expected text`)
    }
    for (const key of Object.keys(entry)) {
      if (!OVERRIDE_KEYS.has(key)) errors.push(`${at}.${key}: unknown key`)
    }
    if (!valid.length || !Object.keys(rules).length) continue
    config.overrides.push({ paths: valid, matchers: valid.map(pointerMatcher), rules })
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'rules' && key !== 'overrides') errors.push(`audit.${key}: unknown key`)
  }
  return { config, errors }
}

// `options` is where the object form's options go — absent, as under an
// override, the object form is refused.
function readRules(raw, at, known, errors, options = null) {
  const rules = {}
  if (raw === undefined) return rules
  if (!isPlainObject(raw)) {
    errors.push(`${at}: expected an object`)
    return rules
  }
  for (const [id, setting] of Object.entries(raw)) {
    const rule = known.get(id)
    if (!rule) errors.push(`${at}: unknown rule "${id}"`)
    else if (isPlainObject(setting) && options) {
      const { severity, ...values } = setting
      if (severity !== undefined && !SETTINGS.includes(severity)) {
        errors.push(`${at}.${id}.severity: "${severity}" is not one of ${SETTINGS.join(', ')}`)
      } else if (severity !== undefined) rules[id] = severity
      const read = readOptions(rule, values, `${at}.${id}`, errors)
      if (Object.keys(read).length) options[id] = read
    } else if (isPlainObject(setting)) {
      errors.push(`${at}.${id}: options are set under audit.rules, for the whole document`)
    } else if (!SETTINGS.includes(setting)) {
      errors.push(`${at}.${id}: "${setting}" is not one of ${SETTINGS.join(', ')}`)
    } else rules[id] = setting
  }
  return rules
}

// A rule's options as declared — `{ name: { default, min, max } }`, integers
// for now, the only kind a rule takes — checked one by one. A wrong value is
// refused rather than clamped: a pipeline graded by a bound nobody wrote is the
// failure this whole reader exists to prevent.
function readOptions(rule, values, at, errors) {
  const read = {}
  for (const [name, value] of Object.entries(values)) {
    const spec = rule.options?.[name]
    if (!spec) {
      const known = Object.keys(rule.options ?? {})
      errors.push(
        `${at}.${name}: unknown option — ${known.length ? `this rule takes ${known.join(', ')}` : 'this rule takes none'}`,
      )
    } else if (!Number.isInteger(value) || value < spec.min || value > (spec.max ?? Infinity)) {
      const range = spec.max === undefined ? `${spec.min} or more` : `${spec.min} to ${spec.max}`
      errors.push(`${at}.${name}: expected an integer, ${range}`)
    } else read[name] = value
  }
  return read
}

// rule → the options its run gets: its declared defaults, under what the
// configuration sets.
export function optionsResolver(config) {
  return (rule) => {
    const defaults = Object.fromEntries(
      Object.entries(rule.options ?? {}).map(([name, spec]) => [name, spec.default]),
    )
    return { ...defaults, ...config?.options?.[rule.id] }
  }
}

// rule → its severity at a given pointer: the check's own (a rule may grade
// its checks differently, `check(…, { severity })` — the rule's severity
// otherwise), then `rules`, then every override whose paths cover the pointer,
// in declaration order — the last word wins, as in a stylesheet. A configured
// severity replaces the check's own: whoever re-grades a rule re-grades all of
// it. Returns null for a rule switched off everywhere, so the engine does not
// even run it.
export function severityResolver(config) {
  return (rule) => {
    const configured = config?.rules?.[rule.id]
    const overrides = (config?.overrides ?? []).filter((entry) => rule.id in entry.rules)
    if (configured === RULE_OFF && !overrides.length) return null
    return (dataPath, own = rule.severity) => {
      let setting = configured ?? own
      for (const entry of overrides) {
        if (entry.matchers.some((matches) => matches(dataPath))) setting = entry.rules[rule.id]
      }
      return setting === RULE_OFF ? null : setting
    }
  }
}

// What the report says about the configuration it was graded under. `custom`
// is the flag a reader needs; the counts tell them how far from the default.
// `rules` holds the severities, `options` the options, each by rule id.
export function auditProfile(config) {
  const rules = config?.rules ?? {}
  const options = config?.options ?? {}
  const overrides = config?.overrides?.length ?? 0
  const reconfigured = new Set([...Object.keys(rules), ...Object.keys(options)]).size
  return { custom: reconfigured > 0 || overrides > 0, rules, options, overrides }
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
