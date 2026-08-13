// Schema audit engine (docs/audit.md): walks the document once, dispatches the
// rules over it, scores the result. Plain data in, plain data out — no DOM, no
// storage, no i18n: a finding carries a `ruleId` and its parameters, the UI
// resolves `audit.rule.{id}.message` from them.
//
// Input is the RAW document, not the normalized model (docs/audit.md §5): the
// audit is the second legitimate consumer of the raw schema next to
// normalization, precisely because normalization erases what several rules must
// flag (3.0 vs 3.1 spellings, version mismatches). Rule 6 is about rendering,
// and the audit page renders findings, not the schema.

import { operationKey, pathItemOperations, webhookKey } from '../openapi/model.js'
import { CATEGORIES, GRADES, LOWEST_GRADE, SEVERITIES, SEVERITY_WEIGHT } from './constants.js'
import { pointer } from './pointer.js'
import { RULES } from './rules/index.js'
import { collectSchemas } from './schema-walk.js'

// `source`: the document as served, $refs intact — the only place unused
// components and ref shapes are observable.
// `document`: the same document dereferenced (possibly cyclic).
// `model`: the normalized model, used as the hide filter's verdict (see below).
//
// `rules` is a seam for the engine's own tests (synthetic rules give a
// deterministic score); production callers pass nothing.
export function auditSchema(input, rules = RULES) {
  const run = auditRun(input, rules)
  let step = run.next()
  while (!step.done) step = run.next()
  return step.value
}

// The same run, cut into one rule's worth of work per step, returning the
// report when drained. On the repo's heaviest document the whole audit is half
// a second of frozen main thread — over the blocking budget of rule 14 on its
// own — so a caller on the UI thread drives this and gives the browser a frame
// between steps. There is no partial report to show along the way: a score is
// only meaningful once every category has been graded.
export function* auditRun(input, rules = RULES) {
  const ctx = createAuditContext(input)
  yield
  const categories = []
  const counts = { error: 0, warning: 0, info: 0, total: 0 }
  for (const id of CATEGORIES) {
    const category = yield* runCategory(
      id,
      rules.filter((rule) => rule.category === id),
      ctx,
    )
    // A category with no applicable check (no rule yet, or nothing in the
    // document to check) is absent from the report rather than scored 0 — an
    // API with no deprecation is not a badly deprecating API.
    if (!category) continue
    categories.push(category)
    for (const severity of SEVERITIES) counts[severity] += category.counts[severity]
    counts.total += category.findings.length
  }
  const score = categories.length
    ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length)
    : null
  return {
    openapi: ctx.version.raw,
    api: apiIdentity(ctx.document.info),
    scope: auditScope(ctx),
    score,
    grade: score === null ? null : gradeFor(score),
    counts,
    categories,
  }
}

// Who the audited document says it is. Read from the raw `info` like every
// other rule input (§5): the model now normalizes `contact` and `license` too,
// but it drops what it cannot render — an empty `contact: {}`, a `license` whose
// only URL is a `javascript:` one — and those are exactly the cases
// `info-metadata` grades. The report shows what the document wrote.
function apiIdentity(info) {
  const object = (value) => (value && typeof value === 'object' ? value : null)
  return {
    title: typeof info?.title === 'string' ? info.title : '',
    version: typeof info?.version === 'string' ? info.version : '',
    contact: object(info?.contact),
    license: object(info?.license),
  }
}

// What the run actually covered, counted on the document rather than on the
// model: hidden operations are in these figures because they are in the audit
// (§3), and the reader must be able to tell that the report spans more than the
// rendered documentation. Same figures as the home page's, plus the schemas —
// the audit's own unit of work, and the one nothing else counts.
function auditScope(ctx) {
  return {
    operations: ctx.operations.filter((entry) => entry.kind === 'operation').length,
    groups: countTags(ctx),
    webhooks: ctx.operations.filter((entry) => entry.kind === 'webhook').length,
    securitySchemes: Object.keys(ctx.document.components?.securitySchemes ?? {}).length,
    schemas: ctx.schemas.length,
  }
}

// Tags declared by the document, plus tags used by an operation without being
// declared — both make a navigation group. No fallback group for untagged
// operations: `operation-tagged` already reports them one by one, and counting
// a bucket the document never asked for would inflate the figure. A tag borne
// only by a webhook makes no group either: the nav lists webhooks flat, in
// their own section, which is also why `operation-tagged` spares them.
function countTags(ctx) {
  const tags = new Set()
  for (const tag of ctx.document.tags ?? []) {
    if (typeof tag?.name === 'string') tags.add(tag.name)
  }
  for (const entry of ctx.operations) {
    if (entry.kind !== 'operation') continue
    for (const tag of entry.op.tags ?? []) if (typeof tag === 'string') tags.add(tag)
  }
  return tags.size
}

export function gradeFor(score) {
  for (const [grade, threshold] of GRADES) if (score >= threshold) return grade
  return LOWEST_GRADE
}

// Exported for the per-rule tests: a rule is a pure function of the context,
// and this is the only way to run one.
export function runRule(rule, ctx) {
  const findings = []
  let checks = 0
  rule.run(ctx, (passed, target = {}) => {
    checks += 1
    if (!passed) findings.push(buildFinding(rule, target))
  })
  return { checks, findings }
}

export function createAuditContext({ source, document, model }) {
  // The audit sees the FULL document — an author wants the whole picture, hidden
  // operations included — but the model is the hide filter's verdict: an
  // operation absent from it has no route, so its findings must not carry a
  // link (docs/audit.md §3).
  const routable = new Set([...model.operations, ...model.webhooks].map((op) => op.id))
  const operations = collectOperations(document, routable)
  return {
    source,
    document,
    model,
    version: parseVersion(document.openapi),
    operations,
    schemas: collectSchemas(document, operations),
  }
}

function* runCategory(id, rules, ctx) {
  const findings = []
  let checks = 0
  let weighted = 0
  let weightedPassed = 0
  for (const rule of rules) {
    const result = runRule(rule, ctx)
    const weight = SEVERITY_WEIGHT[rule.severity]
    checks += result.checks
    weighted += weight * result.checks
    weightedPassed += weight * (result.checks - result.findings.length)
    findings.push(...result.findings)
    yield
  }
  if (!weighted) return null
  findings.sort(compareFindings)
  const counts = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return { id, score: Math.round((100 * weightedPassed) / weighted), checks, findings, counts }
}

// Stable order inside a category: severity, then rule, then position in the
// document — the report must not shuffle between two runs on the same schema.
function compareFindings(a, b) {
  const severity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
  if (severity) return severity
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1
  if (a.dataPath !== b.dataPath) return a.dataPath < b.dataPath ? -1 : 1
  return 0
}

function buildFinding(rule, { op = null, location, dataPath, params }) {
  const finding = {
    ruleId: rule.id,
    severity: rule.severity,
    category: rule.category,
    location: location ?? (op ? operationLocation(op) : ''),
    opRef: op && !op.hidden ? op.key : null,
    dataPath: dataPath ?? op?.pointer ?? '',
    params: params ?? {},
  }
  // Distinguishes "not an operation" from "operation the reader cannot reach":
  // the UI shows a hidden badge instead of a dead link.
  if (op?.hidden) finding.hidden = true
  return finding
}

// A callback's address is a runtime expression, and its deep link is its
// parent's: the callback's own name is the only thing telling two findings of
// the same operation apart. Named first, as the doc's callbacks section does.
function operationLocation(op) {
  const target = `${op.method.toUpperCase()} ${op.path}`
  return op.callback ? `${op.callback} · ${target}` : target
}

// Rules that must branch on the declared version (docs/audit.md §4.6) read
// this, never a substring test of their own.
function parseVersion(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const [major, minor] = text.split('.')
  return { raw: text, major: Number(major) || 0, minor: Number(minor) || 0 }
}

// One entry per operation of the document, webhooks and callbacks included,
// hidden ones included. `parameters` merges the Path Item's parameters with the
// operation's (same override key as normalization: name + in), each keeping the
// pointer to where it is actually declared.
function collectOperations(document, routable) {
  const entries = []
  const sections = [
    { kind: 'operation', container: document.paths, root: 'paths', keyOf: operationKey },
    { kind: 'webhook', container: document.webhooks, root: 'webhooks', keyOf: webhookKey },
  ]
  for (const { kind, container, root, keyOf } of sections) {
    for (const [path, pathItem] of Object.entries(container ?? {})) {
      if (!pathItem || typeof pathItem !== 'object') continue
      const base = pointer(root, path)
      for (const [method, op] of pathItemOperations(pathItem)) {
        const key = keyOf(path, method, op)
        const opPointer = `${base}${operationSegment(pathItem, method, op)}`
        const entry = {
          kind,
          key,
          method,
          path,
          op,
          pathItem,
          pointer: opPointer,
          hidden: !routable.has(key),
          parameters: mergeParameters(pathItem, op, base, opPointer),
        }
        entries.push(entry, ...callbackOperations(entry))
      }
    }
  }
  return entries
}

// The operations a callback declares. They carry their PARENT's key and hidden
// state: a callback has no route of its own — the doc renders it inside the
// operation that declares it — so a finding on one must deep-link there. The
// alternative, an entry the router cannot resolve, would show the "hidden"
// badge, and the operation is not hidden at all.
//
// One level deep, like normalization (rule 7): the spec allows a callback to
// declare callbacks of its own, and a dereferenced circular `$ref` makes that
// infinite.
function* callbackOperations(parent) {
  for (const [name, expressions] of Object.entries(parent.op.callbacks ?? {})) {
    if (!expressions || typeof expressions !== 'object') continue
    for (const [expression, pathItem] of Object.entries(expressions)) {
      if (!pathItem || typeof pathItem !== 'object') continue
      const base = `${parent.pointer}${pointer('callbacks', name, expression)}`
      for (const [method, op] of pathItemOperations(pathItem)) {
        const opPointer = `${base}${operationSegment(pathItem, method, op)}`
        yield {
          kind: 'callback',
          key: parent.key,
          method,
          // The runtime expression the delivery is sent to, which is what the
          // doc shows and the only address a callback has.
          path: expression,
          callback: name,
          op,
          pathItem,
          pointer: opPointer,
          hidden: parent.hidden,
          parameters: mergeParameters(pathItem, op, base, opPointer),
        }
      }
    }
  }
}

// 3.2 `additionalOperations`: the operation does not sit under its method key,
// so a `/paths/…/{method}` pointer would designate nothing.
function operationSegment(pathItem, method, op) {
  if (pathItem[method] === op) return pointer(method)
  const additional = pathItem.additionalOperations ?? {}
  const name = Object.keys(additional).find((key) => additional[key] === op)
  return pointer('additionalOperations', name)
}

function mergeParameters(pathItem, op, base, opPointer) {
  const merged = []
  const add = (param, dataPath) => {
    if (!param || typeof param !== 'object') return
    const at = merged.findIndex((e) => e.param.name === param.name && e.param.in === param.in)
    if (at >= 0) merged[at] = { param, dataPath }
    else merged.push({ param, dataPath })
  }
  for (const [index, param] of (pathItem.parameters ?? []).entries()) {
    add(param, `${base}${pointer('parameters', index)}`)
  }
  for (const [index, param] of (op.parameters ?? []).entries()) {
    add(param, `${opPointer}${pointer('parameters', index)}`)
  }
  return merged
}
