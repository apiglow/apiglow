// The audit baseline (docs/audit.md §8.3): the findings a team has seen and
// accepted, committed next to the schema so a CI check fails on what is NEW
// rather than on the whole history of the document. Not an ignore list: every
// finding is still reported, a known one is only marked as such.
//
// A finding's identity is its rule and its JSON pointer — the two things that
// survive an unrelated edit of the document. Messages and locations do not
// (a renamed parameter rewrites both), and neither does a severity a later
// version of a rule may change. Several findings can share one identity (one
// rule firing twice on the same node), so a baseline holds a count, not a set:
// a pointer listed twice covers two occurrences, and a third one is new.

export const BASELINE_FORMAT = 'apiglow-audit-baseline'
const BASELINE_VERSION = 1

// [{ id, report }] → the baseline document. Sorted throughout, so that writing
// it again on an unchanged schema rewrites the file byte for byte and a review
// diff shows only what moved.
export function toBaseline(audits) {
  const specs = {}
  for (const { id, report } of [...audits].sort((a, b) => compare(a.id, b.id))) {
    const rules = {}
    for (const finding of findingsOf(report)) {
      rules[finding.ruleId] ??= []
      rules[finding.ruleId].push(finding.dataPath)
    }
    specs[id] = Object.fromEntries(
      Object.keys(rules)
        .sort(compare)
        .map((ruleId) => [ruleId, rules[ruleId].sort(compare)]),
    )
  }
  return { format: BASELINE_FORMAT, version: BASELINE_VERSION, specs }
}

// A parsed baseline file, checked before anything trusts it: a malformed one
// silently read as empty would fail every finding as new, and one read as
// covering everything would pass a regression. → the `specs` map; throws on a
// document that is not a baseline this version writes.
export function readBaseline(document) {
  if (document?.format !== BASELINE_FORMAT) {
    throw new Error(`not an audit baseline (expected "format": "${BASELINE_FORMAT}")`)
  }
  if (document.version !== BASELINE_VERSION) {
    throw new Error(`unsupported baseline version ${JSON.stringify(document.version)}`)
  }
  const specs = document.specs
  const valid =
    specs &&
    typeof specs === 'object' &&
    Object.values(specs).every(
      (rules) =>
        rules &&
        typeof rules === 'object' &&
        Object.values(rules).every(
          (paths) => Array.isArray(paths) && paths.every((path) => typeof path === 'string'),
        ),
    )
  if (!valid) throw new Error('malformed baseline: "specs" must map spec → rule → [JSON pointer]')
  return specs
}

// One spec's report against that spec's entry of the baseline (absent: nothing
// is known) → the report with every known finding marked `known: true`, the
// findings that are not, in report order, and the entries no finding matched
// — `stale`: [{ ruleId, dataPath }], one per occurrence, in baseline order.
export function applyBaseline(report, known = {}) {
  const remaining = new Map()
  for (const [ruleId, paths] of Object.entries(known)) {
    for (const dataPath of paths) {
      const key = identity(ruleId, dataPath)
      const entry = remaining.get(key) ?? { ruleId, dataPath, left: 0 }
      entry.left++
      remaining.set(key, entry)
    }
  }
  const fresh = []
  const categories = report.categories.map((category) => ({
    ...category,
    findings: category.findings.map((finding) => {
      const entry = remaining.get(identity(finding.ruleId, finding.dataPath))
      if (!entry?.left) {
        fresh.push(finding)
        return finding
      }
      entry.left--
      return { ...finding, known: true }
    }),
  }))
  const stale = [...remaining.values()].flatMap(({ ruleId, dataPath, left }) =>
    Array.from({ length: left }, () => ({ ruleId, dataPath })),
  )
  return { report: { ...report, categories }, fresh, stale }
}

// What is left of a baseline once its stale entries are dropped: the known
// findings of each spec the run audited — never a new one, which only
// `--write-baseline` records. Specs the run did not audit are dropped with it.
export function prunedBaseline(results) {
  return toBaseline(
    results.map(({ id, report }) => ({
      id,
      report: {
        categories: report.categories.map((category) => ({
          findings: category.findings.filter((finding) => finding.known),
        })),
      },
    })),
  )
}

// Every finding gains `fingerprint`: the hash of its baseline identity — spec,
// rule, JSON pointer — plus its occurrence among the findings sharing those
// three, so it keeps its id across runs while the document around it changes.
// Computed on the whole report, before any output leaves findings out: an
// occurrence counted after a filter would hand a finding someone else's id.
// The hash is injected — `node:crypto` in the CLI — to keep this module pure.
export function fingerprinted(id, report, hashOf) {
  const seen = new Map()
  const categories = report.categories.map((category) => ({
    ...category,
    findings: category.findings.map((finding) => {
      const key = [id, finding.ruleId, finding.dataPath].join('\u0000')
      const occurrence = seen.get(key) ?? 0
      seen.set(key, occurrence + 1)
      return { ...finding, fingerprint: hashOf(`${key}\u0000${occurrence}`) }
    }),
  }))
  return { ...report, categories }
}

export function findingsOf(report) {
  return report.categories.flatMap((category) => category.findings)
}

const identity = (ruleId, dataPath) => `${ruleId}\n${dataPath}`

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
