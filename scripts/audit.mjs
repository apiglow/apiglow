// `apiglow audit` (docs/audit.md §8): the schema audit of the `#/audit` page,
// run where a CI job can gate on it. Same engine, same rules, same report — the
// command only adds what a pipeline needs around it: an exit status, machine
// output, and a baseline so that adopting the check on an existing API fails
// on what a change introduces rather than on the whole history of the schema.
//
// Streams: the report goes to stdout (or `--output`), everything about the run
// — warnings, the checks, the verdict — to stderr, so `--format json > x` and
// `--format markdown >> "$GITHUB_STEP_SUMMARY"` stay exactly the report.

import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { applyBaseline, findingsOf, readBaseline, toBaseline } from '../src/audit/baseline.js'
import { readAuditConfig } from '../src/audit/config.js'
import { auditSchema } from '../src/audit/engine.js'
import { FAIL_ON, GRADE_ORDER, atOrAbove, gateResults } from '../src/audit/gate.js'
import { hostConfig } from '../src/config.js'
import { toAuditMarkdown } from '../src/export/audit-markdown.js'
import { toAuditText } from '../src/export/audit-text.js'
import { useDictionary } from '../src/i18n/index.js'
import { normalizeSpecsConfig } from '../src/specs.js'
import { CliError, catalog, loadSpecModel } from './cli-support.mjs'

const FORMATS = ['text', 'json', 'markdown']

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
    audits.push({ id: spec.id, source, report: auditSchema({ ...loaded, config: rules }) })
  }
  return { audits, warnings }
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
  --format           text | json | markdown (default: text)
  --output           write the report to this file instead of stdout
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

  const results = audits.map(({ id, source, report }) => {
    const applied = known ? applyBaseline(report, known[id]) : null
    const marked = applied?.report ?? report
    const fresh = applied?.fresh ?? findingsOf(report)
    const gates = values['write-baseline']
      ? []
      : gateResults(report, { findings: fresh, ...options })
    return { id, source, report: marked, fresh, gates, passed: gates.every((g) => g.passed) }
  })
  const passed = results.every((result) => result.passed)

  const output = render(results, { format: values.format, passed, baseline: Boolean(known) })
  if (values.output) await write(values.output, output)
  const notes = warnings.map((warning) => `warning: ${warning}`)
  if (values['write-baseline']) {
    const baseline = toBaseline(results)
    await write(values['write-baseline'], `${JSON.stringify(baseline, null, 2)}\n`)
    const count = results.reduce((sum, result) => sum + findingsOf(result.report).length, 0)
    notes.push(`Baseline of ${count} finding(s) written to ${values['write-baseline']}`)
  } else {
    notes.push(...verdictLines(results, { multi: results.length > 1, options, known }))
  }

  return {
    stdout: values.output ? '' : output.replace(/\n$/, ''),
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
        format: { type: 'string', default: 'text' },
        output: { type: 'string' },
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
  let minScore
  if (values['min-score'] !== undefined) {
    minScore = Number(values['min-score'])
    if (!/^\d+$/.test(values['min-score']) || minScore > 100) {
      refuse(`--min-score must be an integer from 0 to 100, got "${values['min-score']}"`)
    }
  }
  return { failOn: values['fail-on'], minGrade: values['min-grade'], minScore }
}

// A schema named on the command line is the one-spec config the app would boot
// on, resolved against the working directory like any argument a shell passes.
// A relative path stays as typed — it is what the JSON report names as the
// source — and the working directory is the base it resolves against.
function fromSpec(spec) {
  const url = !IS_URL.test(spec) && isAbsolute(spec) ? pathToFileURL(spec).href : spec
  return { config: { openapi: { url } } }
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

function render(results, { format, passed, baseline }) {
  if (format === 'json') {
    const specs = results.map(({ id, source, report, fresh, gates, passed }) => ({
      id,
      source,
      passed,
      gates,
      ...(baseline ? { newFindings: fresh.length } : {}),
      report,
    }))
    return `${JSON.stringify({ passed, specs }, null, 2)}\n`
  }
  const multi = results.length > 1
  return results
    .map(({ id, report }) => {
      const body = format === 'markdown' ? toAuditMarkdown(report) : toAuditText(report)
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
      const where = [finding.location, finding.dataPath].filter(Boolean).join(' · ')
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
