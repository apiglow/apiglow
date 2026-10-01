// `apiglow audit` (docs/audit.md §8): the schema audit of the `#/audit` page,
// run where a CI job can gate on it. Same engine, same rules, same report — the
// command only adds what a pipeline needs around it: an exit status, machine
// output, and a baseline so that adopting the check on an existing API fails
// on what a change introduces rather than on the whole history of the schema.
//
// Streams: the report goes to stdout (or `--output`), everything about the run
// — warnings, the checks, the verdict — to stderr, so `--format json > x` and
// `--format markdown >> "$GITHUB_STEP_SUMMARY"` stay exactly the report.

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { load } from 'js-yaml'
import {
  applyBaseline,
  findingsOf,
  fingerprinted,
  readBaseline,
  toBaseline,
} from '../src/audit/baseline.js'
import { readAuditConfig } from '../src/audit/config.js'
import { lineIndex, pointerIndex, sourcePointer } from '../src/audit/positions.js'
import { auditSchema } from '../src/audit/engine.js'
import { SEVERITIES } from '../src/audit/constants.js'
import { FAIL_ON, GRADE_ORDER, atOrAbove, gateResults } from '../src/audit/gate.js'
import { hostConfig } from '../src/config.js'
import {
  SARIF_RESULT_CAP,
  toAuditAnnotations,
  toAuditCodeQuality,
  toAuditSarif,
} from '../src/export/audit-ci.js'
import { toAuditJson } from '../src/export/audit-json.js'
import { toAuditMarkdown } from '../src/export/audit-markdown.js'
import { toAuditText } from '../src/export/audit-text.js'
import { useDictionary } from '../src/i18n/index.js'
import { normalizeSpecsConfig } from '../src/specs.js'
import { CliError, catalog, loadSpecModel, refUrl } from './cli-support.mjs'

const FORMATS = ['text', 'json', 'markdown', 'sarif', 'github', 'codequality']

// What a failing `--fail-on` lists on stderr: the answer to "why did my build
// fail" at the bottom of the log, even when the report went to a file. The
// report itself always carries all of them.
const LISTED = 20

// A URL as opposed to a path. Narrower than a scheme test on purpose: `C:\…` is
// a Windows path, not a URL with the scheme `c`.
const IS_URL = /^[a-z][a-z0-9+.-]*:\/\//i

// Every spec the config declares, audited → { audits: [{ id, source, report }],
// warnings }. The whole document is audited whatever `features.audit` says:
// that switch removes the page from the published documentation, and an author
// running the command asked for the report.
export async function audit({ config: raw, base = pathToFileURL(`${process.cwd()}/`) } = {}) {
  const config = hostConfig(raw)
  const warnings = []
  let specsConfig
  try {
    specsConfig = normalizeSpecsConfig(config.openapi)
  } catch (err) {
    throw new CliError(err.message)
  }
  for (const warning of specsConfig.warnings) warnings.push(warning)
  const audits = []
  for (const spec of specsConfig.specs) {
    const { loaded, config: effective } = await loadSpecModel(config, spec, {
      multi: specsConfig.multi,
      base,
      warnings,
    })
    // Unlike the page, which leaves a wrong entry out and grades with the rest,
    // a pipeline refuses to run: passing on a configuration nobody wrote is the
    // one outcome a CI check must never produce.
    const { config: rules, errors } = readAuditConfig(effective.audit)
    if (errors.length) {
      const prefix = specsConfig.multi ? `spec "${spec.id}": ` : ''
      throw new CliError(errors.map((error) => `${prefix}${error}`).join('\n'))
    }
    // The source as its author wrote it — a path for a file, not a `file:` URL.
    const source = spec.url?.startsWith('file:') ? fileURLToPath(spec.url) : (spec.url ?? 'inline')
    const report = auditSchema({ ...loaded, config: rules })
    const url = spec.url ? refUrl(spec.url, base) : null
    audits.push({
      id: spec.id,
      source,
      report: url?.protocol === 'file:' ? await placed(report, url) : report,
    })
  }
  return { audits, warnings }
}

// Every finding gains `position: { file, line, column }` — where its node sits
// in the file the author edits — and `via`, the `$ref` sites crossed to reach
// it (docs/audit.md §8.1). Files only: a schema fetched from a URL is not the
// author's working copy, and an inline one has no file. A file that cannot be
// read or parsed again leaves its findings unplaced rather than failing a run
// that already has its report.
async function placed(report, rootUrl) {
  const files = new Map()
  const open = async (url) => {
    if (!files.has(url.href)) {
      try {
        const text = await readFile(url, 'utf8')
        const find = pointerIndex(text).find
        const at = lineIndex(text)
        const document = /^\s*[[{]/.test(text) ? JSON.parse(text) : load(text)
        files.set(url.href, {
          document,
          file: displayPath(url),
          locate: (pointer) => at(find(pointer).offset),
        })
      } catch {
        files.set(url.href, null)
      }
    }
    return files.get(url.href)
  }
  const root = await open(rootUrl)
  if (!root) return report
  // `$ref` targets are resolved up front: the walk itself is synchronous.
  const targets = new Map()
  const loadDocument = (target, from) => {
    const url = new URL(target, from ?? rootUrl)
    const entry = targets.get(url.href)
    return entry ? { file: url.href, document: entry.document } : null
  }
  await collectTargets(root.document, rootUrl, open, targets)
  const where = (file, pointer) => {
    const entry = file ? targets.get(file) : root
    return entry ? { file: entry.file, ...entry.locate(pointer) } : null
  }
  const categories = report.categories.map((category) => ({
    ...category,
    findings: category.findings.map((finding) => {
      const { file, pointer, refs } = sourcePointer(finding.dataPath, {
        document: root.document,
        loadDocument,
      })
      const position = where(file, pointer)
      if (!position) return finding
      const via = refs.map((ref) => where(ref.file, ref.pointer)).filter(Boolean)
      return { ...finding, position, ...(via.length ? { via } : {}) }
    }),
  }))
  return { ...report, categories }
}

// Every file the document's `$ref`s reach, transitively, keyed by URL — so that
// `sourcePointer`, which walks synchronously, finds them loaded.
async function collectTargets(document, url, open, targets) {
  const pending = [[document, url]]
  while (pending.length) {
    const [node, base] = pending.pop()
    for (const ref of refsIn(node)) {
      const [target] = ref.split('#')
      if (!target) continue
      const next = new URL(target, base)
      if (next.protocol !== 'file:' || targets.has(next.href)) continue
      const entry = await open(next)
      targets.set(next.href, entry)
      if (entry) pending.push([entry.document, next])
    }
  }
}

function* refsIn(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return
  seen.add(node)
  if (typeof node.$ref === 'string') yield node.$ref
  for (const value of Object.values(node)) yield* refsIn(value, seen)
}

// Relative to the working directory when the file is under it — what a
// terminal and a CI annotation both expect — absolute otherwise.
function displayPath(url) {
  const path = fileURLToPath(url)
  const rel = relative(process.cwd(), path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

const USAGE = `Usage: apiglow audit <spec> [options]
       apiglow audit --config <file> [options]

  <spec>             path or URL of the OpenAPI document (JSON or YAML)
  --config           the JSON config the host page inlines in #api-doc-config:
                     its overlays, hidden operations, rule configuration
                     (audit) and every spec it declares
  --audit-config     a JSON file holding the rule configuration alone
                     ({ "rules": …, "overrides": … }); replaces the config's
                     own audit block
  --fail-on          error | warning | info | none: fail on a finding this
                     severe or worse (default: error)
  --min-grade        A | B | C | D | F: fail below this grade
  --min-score        0-100: fail below this score
  --baseline         a baseline file: --fail-on only counts findings it does not list
  --write-baseline   write the current findings to this file and pass
  --format           text | json | markdown | sarif | github | codequality
                     (default: text)
  --output           write the report to this file instead of stdout
  --report           <format>=<file>: also write the report in this format to
                     this file; repeatable. With --report alone, stdout stays
                     empty unless --format or --output asks for a report too
  --min-severity     error | warning | info: list only the findings this severe
                     or worse, in every report (default: info)
  --only-new         with --baseline: list only the findings it does not know
  --language         en | fr: language of the report (default: en)

Exit status: 0 passed, 1 a check failed, 2 the audit could not run.`

export async function main(args) {
  const { values, positionals } = parse(args)
  if (values.help) return { stdout: USAGE }
  const options = checkOptions(values, positionals)
  useDictionary(values.language, await catalog(values.language))

  const input = positionals[0] ? fromSpec(positionals[0]) : await fromConfig(values.config)
  // The rule configuration of a run that has no host config to carry it — or
  // that wants to grade differently from the published page.
  if (values['audit-config'])
    input.config = { ...input.config, audit: await auditConfigFile(values['audit-config']) }
  const { audits, warnings } = await audit(input)
  const known = values.baseline ? await baselineFile(values.baseline) : null

  const results = audits.map(({ id, source, report: graded }) => {
    const report = fingerprinted(id, graded, fingerprintOf)
    const applied = known ? applyBaseline(report, known[id]) : null
    const marked = applied?.report ?? report
    const fresh = applied?.fresh ?? findingsOf(report)
    const gates = values['write-baseline']
      ? []
      : gateResults(report, { findings: fresh, ...options })
    return { id, source, report: marked, fresh, gates, passed: gates.every((g) => g.passed) }
  })
  const passed = results.every((result) => result.passed)

  const context = {
    passed,
    baseline: Boolean(known),
    tool: { name: 'apiglow', ...(await toolManifest()) },
  }
  let stdout = ''
  const listed = results.map((result) => listing(result, options))
  for (const { format, file } of options.reports) {
    const output = render(listed, { format, ...context })
    if (file) await write(file, output)
    else stdout = output.replace(/\n$/, '')
  }
  const notes = warnings.map((warning) => `warning: ${warning}`)
  if (options.reports.some((target) => target.format === 'sarif'))
    notes.push(...sarifCapLines(listed))
  if (values['write-baseline']) {
    const baseline = toBaseline(results)
    await write(values['write-baseline'], `${JSON.stringify(baseline, null, 2)}\n`)
    const count = results.reduce((sum, result) => sum + findingsOf(result.report).length, 0)
    notes.push(`Baseline of ${count} finding(s) written to ${values['write-baseline']}`)
  } else {
    notes.push(...verdictLines(results, { multi: results.length > 1, options, known }))
  }

  return {
    stdout,
    stderr: notes.join('\n'),
    code: passed ? 0 : 1,
  }
}

function parse(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        config: { type: 'string' },
        'fail-on': { type: 'string', default: 'error' },
        'min-grade': { type: 'string' },
        'min-score': { type: 'string' },
        'audit-config': { type: 'string' },
        baseline: { type: 'string' },
        'write-baseline': { type: 'string' },
        format: { type: 'string' },
        output: { type: 'string' },
        report: { type: 'string', multiple: true, default: [] },
        'min-severity': { type: 'string' },
        'only-new': { type: 'boolean', default: false },
        language: { type: 'string', default: 'en' },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (err) {
    throw new CliError(`${err.message}\n\n${USAGE}`)
  }
}

// Every value checked before anything is loaded: a typo in a threshold must
// not cost a schema download to be reported, nor — worse — be read as "no
// threshold" and pass a job that should have failed.
function checkOptions(values, positionals) {
  const refuse = (message) => {
    throw new CliError(`${message}\n\n${USAGE}`)
  }
  if (positionals.length > 1) refuse(`one schema per run, got ${positionals.length}`)
  if (!positionals.length && !values.config) refuse('a schema or --config is required')
  if (positionals.length && values.config) refuse('a schema or --config, not both')
  if (values.baseline && values['write-baseline']) {
    refuse('--baseline and --write-baseline do not combine: writing records every finding')
  }
  const oneOf = (name, allowed) => {
    if (values[name] !== undefined && !allowed.includes(values[name])) {
      refuse(`--${name} must be one of ${allowed.join(', ')}, got "${values[name]}"`)
    }
  }
  oneOf('fail-on', FAIL_ON)
  oneOf('min-grade', GRADE_ORDER)
  oneOf('format', FORMATS)
  oneOf('min-severity', SEVERITIES)
  if (values['only-new'] && !values.baseline)
    refuse('--only-new needs a --baseline to tell new findings apart')
  // A check failing on findings the report does not show leaves the reader of
  // a red job with nothing to read.
  const minSeverity = values['min-severity']
  const failOn = values['fail-on']
  if (
    minSeverity &&
    failOn !== 'none' &&
    SEVERITIES.indexOf(failOn) > SEVERITIES.indexOf(minSeverity)
  ) {
    refuse(
      `--fail-on ${failOn} would fail on findings --min-severity ${minSeverity} leaves out of the report`,
    )
  }
  let minScore
  if (values['min-score'] !== undefined) {
    minScore = Number(values['min-score'])
    if (!/^\d+$/.test(values['min-score']) || minScore > 100) {
      refuse(`--min-score must be an integer from 0 to 100, got "${values['min-score']}"`)
    }
  }
  return {
    failOn,
    minGrade: values['min-grade'],
    minScore,
    minSeverity,
    onlyNew: values['only-new'],
    reports: reportTargets(values, refuse),
  }
}

// Where each report goes → [{ format, file }], `file: null` for stdout. The
// stdout one is `--format`/`--output`, the run's default report — kept when
// either is given, or when no `--report` takes its place.
function reportTargets(values, refuse) {
  const targets = []
  if (values.format !== undefined || values.output !== undefined || !values.report.length) {
    targets.push({ format: values.format ?? 'text', file: values.output ?? null })
  }
  for (const value of values.report) {
    const at = value.indexOf('=')
    const format = value.slice(0, at)
    const file = value.slice(at + 1)
    if (at < 1 || !file) refuse(`--report takes <format>=<file>, got "${value}"`)
    if (!FORMATS.includes(format)) {
      refuse(`--report format must be one of ${FORMATS.join(', ')}, got "${format}"`)
    }
    targets.push({ format, file })
  }
  // Two reports into one file: the second would silently replace the first.
  const files = targets.filter((target) => target.file).map((target) => resolvePath(target.file))
  const twice = files.find((file, i) => files.indexOf(file) !== i)
  if (twice) refuse(`two reports would be written to ${twice}`)
  return targets
}

// A schema named on the command line is the one-spec config the app would boot
// on, resolved against the working directory like any argument a shell passes.
// A relative path stays as typed — it is what the JSON report names as the
// source — and the working directory is the base it resolves against.
function fromSpec(spec) {
  const url = !IS_URL.test(spec) && isAbsolute(spec) ? pathToFileURL(spec).href : spec
  return { config: { openapi: { url } } }
}

// SHA-256 of the finding's identity: fixed length and free of separators, so
// that a CI surface keying on it (SARIF, GitLab Code Quality) can take it as is.
function fingerprintOf(identity) {
  return createHash('sha256').update(identity).digest('hex')
}

// The package's own manifest, one directory up from this file in the repo
// (scripts/) and in the published package (dist/) alike.
async function toolManifest() {
  try {
    const { version, homepage } = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    return { version, homepage }
  } catch {
    return { version: '', homepage: '' }
  }
}

async function auditConfigFile(path) {
  try {
    return JSON.parse(await readFile(resolvePath(path), 'utf8'))
  } catch (err) {
    throw new CliError(`--audit-config ${path} could not be read: ${err.message}`)
  }
}

async function fromConfig(path) {
  const configPath = resolvePath(path)
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    // The config's own directory is where its relative declarations live, the
    // way the host page is where they live once served.
    return { config, base: pathToFileURL(configPath) }
  } catch (err) {
    throw new CliError(`--config ${path} could not be read: ${err.message}`)
  }
}

async function baselineFile(path) {
  try {
    return readBaseline(JSON.parse(await readFile(resolvePath(path), 'utf8')))
  } catch (err) {
    throw new CliError(`--baseline ${path} could not be read: ${err.message}`)
  }
}

async function write(path, content) {
  try {
    await writeFile(resolvePath(path), content, 'utf8')
  } catch (err) {
    throw new CliError(`${path} could not be written: ${err.message}`)
  }
}

// What the reports list under `--min-severity` and `--only-new`, and how many
// findings each filter left out. The counts, the grade and the checks keep
// reading the whole report: a filter changes what is shown, never the verdict.
function listing(result, { minSeverity, onlyNew }) {
  if (!minSeverity && !onlyNew) return result
  const floor = SEVERITIES.indexOf(minSeverity ?? 'info')
  const omitted = { lessSevere: 0, known: 0 }
  const kept = (finding) => {
    if (SEVERITIES.indexOf(finding.severity) > floor) omitted.lessSevere++
    else if (onlyNew && finding.known) omitted.known++
    else return true
    return false
  }
  const categories = result.report.categories.map((category) => ({
    ...category,
    findings: category.findings.filter(kept),
  }))
  return { ...result, report: { ...result.report, categories }, omitted }
}

function render(results, { format, passed, baseline, tool }) {
  if (format === 'json') {
    return toAuditJson(results, {
      passed,
      baseline,
      tool: { name: tool.name, version: tool.version },
    })
  }
  if (format === 'sarif') return toAuditSarif(results, { tool, baseline })
  if (format === 'github') return toAuditAnnotations(results)
  if (format === 'codequality') return toAuditCodeQuality(results)
  const multi = results.length > 1
  return results
    .map(({ id, report, omitted }) => {
      const body =
        format === 'markdown'
          ? toAuditMarkdown(report, { omitted })
          : toAuditText(report, { omitted })
      // A multi-spec install's reports follow one another: the spec id is what
      // the config, the baseline and the routes call each of them.
      return multi ? `${format === 'markdown' ? `<!-- spec: ${id} -->` : `[${id}]`}\n${body}` : body
    })
    .join('\n')
}

// The run's account on stderr: each check and how it went, then — when
// `--fail-on` failed — the findings that made it fail.
function verdictLines(results, { multi, options, known }) {
  const lines = []
  for (const { id, fresh, gates } of results) {
    const prefix = multi ? `[${id}] ` : ''
    for (const gate of gates) {
      lines.push(`${prefix}${gate.passed ? 'PASS' : 'FAIL'}  ${describeGate(gate, known)}`)
    }
    const failOn = gates.find((gate) => gate.gate === 'fail-on' && !gate.passed)
    if (!failOn) continue
    const failing = atOrAbove(fresh, options.failOn)
    for (const finding of failing.slice(0, LISTED)) {
      const place = finding.position
        ? `${finding.position.file}:${finding.position.line}:${finding.position.column}`
        : null
      const where = [place, finding.location, finding.dataPath].filter(Boolean).join(' · ')
      lines.push(`${prefix}  ${finding.severity} ${finding.ruleId} — ${where}`)
    }
    if (failing.length > LISTED) {
      lines.push(`${prefix}  … and ${failing.length - LISTED} more, all in the report`)
    }
  }
  const failed = results.some((result) => !result.passed)
  lines.push(failed ? 'Audit failed' : 'Audit passed')
  return lines
}

// What the SARIF report left out, said where the person reading the job log
// will see it: GitHub would otherwise drop the whole upload.
function sarifCapLines(results) {
  const multi = results.length > 1
  return results
    .map(({ id, report }) => ({ id, count: findingsOf(report).length }))
    .filter(({ count }) => count > SARIF_RESULT_CAP)
    .map(
      ({ id, count }) =>
        `${multi ? `[${id}] ` : ''}sarif: ${SARIF_RESULT_CAP} of ${count} results written, new and most severe first — GitHub reads no more per run`,
    )
}

function describeGate(gate, known) {
  switch (gate.gate) {
    case 'fail-on':
      return `--fail-on ${gate.threshold}: ${gate.actual} ${known ? 'new ' : ''}finding(s) at this severity or above`
    case 'min-grade':
      return `--min-grade ${gate.threshold}: grade ${gate.actual ?? 'none (nothing to grade)'}`
    default:
      return `--min-score ${gate.threshold}: score ${gate.actual ?? 'none (nothing to grade)'}`
  }
}
