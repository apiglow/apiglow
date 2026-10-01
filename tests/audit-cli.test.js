import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDictionary } from '../src/i18n/index.js'
import { run } from '../scripts/cli.mjs'

// `apiglow audit` (docs/audit.md §8) end to end from the sources: a schema in,
// a report and an exit status out. The engine, the generators, the baseline
// and the checks are tested on their own; what only this file sees is the
// command wired around them — the input forms, the streams, the status a CI
// job reads.

const fixture = (name) => fileURLToPath(new URL(`e2e/fixtures/${name}`, import.meta.url))
const CLEAN = fixture('e2e-api-clean.json')
const PETSTORE = fixture('e2e-api.json')

const audit = (...args) => run(['audit', ...args])

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'apiglow-audit-'))
  // `--language` switches the process-wide dictionary: each test starts from
  // the bundled English, whatever the previous one asked for.
  useDictionary('en', null)
})

describe('apiglow audit', () => {
  it('passes a schema with no finding, the report on stdout and the verdict on stderr', async () => {
    const { stdout, stderr, code } = await audit(CLEAN)
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Schema audit — Clean E2E API\n/)
    expect(stdout).toContain('No findings. Every applicable check passes on this schema.')
    expect(stderr).toBe(
      'PASS  --fail-on error: 0 finding(s) at this severity or above\nAudit passed',
    )
  })

  it('fails on the threshold and lists what made it fail', async () => {
    const { stderr, code } = await audit(PETSTORE, '--fail-on', 'warning')
    expect(code).toBe(1)
    expect(stderr).toMatch(/^FAIL {2}--fail-on warning: \d+ finding\(s\)/)
    expect(stderr).toContain(
      '  warning parameter-described — tests/e2e/fixtures/e2e-api.json:29:11 · GET /pets · /paths/~1pets/get/parameters/0',
    )
    expect(stderr).toMatch(/\nAudit failed$/)
  })

  it('reports every check it was given, each on its own', async () => {
    const { stderr, code } = await audit(
      CLEAN,
      '--fail-on',
      'none',
      '--min-grade',
      'A',
      '--min-score',
      '100',
    )
    expect(code).toBe(0)
    expect(stderr.split('\n')).toEqual([
      'PASS  --min-grade A: grade A',
      'PASS  --min-score 100: score 100',
      'Audit passed',
    ])
    const failed = await audit(PETSTORE, '--fail-on', 'none', '--min-score', '100')
    expect(failed.code).toBe(1)
    expect(failed.stderr).toMatch(/^FAIL {2}--min-score 100: score \d+$/m)
  })

  it('reads YAML, the format most schemas are written in', async () => {
    const yaml = join(dir, 'openapi.yaml')
    await writeFile(
      yaml,
      'openapi: 3.1.0\ninfo:\n  title: YAML API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )
    const { stdout, code } = await audit(yaml)
    expect(code).toBe(0)
    expect(stdout).toMatch(/^Schema audit — YAML API\n/)
  })

  it('accepts a baseline, then fails only on what it does not list', async () => {
    const baseline = join(dir, 'audit-baseline.json')
    const written = await audit(PETSTORE, '--fail-on', 'info', '--write-baseline', baseline)
    // Writing records the findings; it is not a check.
    expect(written.code).toBe(0)
    expect(written.stderr).toMatch(/^Baseline of \d+ finding\(s\) written to /)
    expect(JSON.parse(await readFile(baseline, 'utf8')).specs.default).toHaveProperty(
      'parameter-described',
    )

    const known = await audit(PETSTORE, '--fail-on', 'info', '--baseline', baseline)
    expect(known.code).toBe(0)
    expect(known.stderr).toMatch(/^PASS {2}--fail-on info: 0 new finding\(s\)/)

    // The same API with one more undocumented parameter: that one is new.
    const changed = JSON.parse(await readFile(PETSTORE, 'utf8'))
    changed.paths['/pets'].get.parameters.push({
      name: 'sort',
      in: 'query',
      schema: { type: 'string' },
    })
    const next = join(dir, 'next.json')
    await writeFile(next, JSON.stringify(changed), 'utf8')
    const regressed = await audit(next, '--fail-on', 'info', '--baseline', baseline)
    expect(regressed.code).toBe(1)
    expect(regressed.stderr).toMatch(/^FAIL {2}--fail-on info: 1 new finding\(s\)/)
    expect(regressed.stderr).toMatch(
      / {2}warning parameter-described — .*next\.json:\d+:\d+ · GET \/pets · /,
    )
  })

  // docs/audit.md §8.3: an entry left behind would one day hide a new finding
  // that happens to land on the same pointer.
  it('fails on baseline entries that no longer occur, unless pruned or allowed', async () => {
    const baseline = join(dir, 'audit-baseline.json')
    await audit(PETSTORE, '--write-baseline', baseline)
    const document = JSON.parse(await readFile(baseline, 'utf8'))
    document.specs.default['parameter-described'].push('/paths/~1gone/get/parameters/0')
    document.specs.retired = { 'operation-described': ['/paths/~1old/get'] }
    await writeFile(baseline, JSON.stringify(document), 'utf8')

    const stale = await audit(PETSTORE, '--baseline', baseline)
    expect(stale.code).toBe(1)
    expect(stale.stderr).toContain(
      [
        'FAIL  --baseline: 2 stale entr(ies), findings it lists that no longer occur — drop them with --prune-baseline <file>',
        '  stale parameter-described — /paths/~1gone/get/parameters/0',
        '  stale operation-described — [retired] /paths/~1old/get',
      ].join('\n'),
    )
    const json = JSON.parse(
      (await audit(PETSTORE, '--baseline', baseline, '--format', 'json')).stdout,
    )
    expect(json.passed).toBe(false)
    expect(json.staleBaseline).toEqual([
      {
        spec: 'default',
        ruleId: 'parameter-described',
        dataPath: '/paths/~1gone/get/parameters/0',
      },
      { spec: 'retired', ruleId: 'operation-described', dataPath: '/paths/~1old/get' },
    ])

    const allowed = await audit(PETSTORE, '--baseline', baseline, '--allow-stale-baseline')
    expect(allowed.code).toBe(0)
    expect(allowed.stderr).toContain('— allowed by --allow-stale-baseline')

    const pruned = join(dir, 'pruned.json')
    const pruning = await audit(PETSTORE, '--baseline', baseline, '--prune-baseline', pruned)
    expect(pruning.code).toBe(0)
    expect(pruning.stderr).toMatch(/Baseline pruned of 2 stale entr\(ies\), written to /)
    const clean = await audit(PETSTORE, '--baseline', pruned, '--fail-on', 'info')
    expect(clean.code).toBe(0)
    expect(clean.stderr).toContain('PASS  --baseline: no stale entry')
    expect(JSON.parse(await readFile(pruned, 'utf8')).specs).not.toHaveProperty('retired')
  })

  it('marks the known findings in the JSON report', async () => {
    const baseline = join(dir, 'audit-baseline.json')
    await audit(PETSTORE, '--write-baseline', baseline)
    const { stdout } = await audit(PETSTORE, '--format', 'json', '--baseline', baseline)
    const [spec] = JSON.parse(stdout).specs
    expect(spec.newFindings).toBe(0)
    const findings = spec.report.categories.flatMap((category) => category.findings)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => finding.known)).toBe(true)
  })

  it('fingerprints every finding the same way from one run to the next', async () => {
    const run = async () => JSON.parse((await audit(PETSTORE, '--format', 'json')).stdout)
    const [first, second] = [await run(), await run()]
    const prints = (json) =>
      json.specs[0].report.categories.flatMap((category) =>
        category.findings.map((f) => f.fingerprint),
      )
    expect(prints(first).length).toBeGreaterThan(0)
    expect(prints(first).every((print) => /^[0-9a-f]{64}$/.test(print))).toBe(true)
    expect(new Set(prints(first)).size).toBe(prints(first).length)
    expect(prints(second)).toEqual(prints(first))
    expect(first).toMatchObject({
      format: 'apiglow-audit-report',
      version: 1,
      tool: { name: 'apiglow' },
    })
    expect(first.rules['parameter-described'].fix).toMatch(/^Add a description/)
  })

  it('writes JSON a script can read: verdict, checks and the report', async () => {
    const { stdout, code } = await audit(PETSTORE, '--format', 'json', '--min-grade', 'A')
    const json = JSON.parse(stdout)
    expect(json.passed).toBe(code === 0)
    expect(json.specs).toHaveLength(1)
    expect(json.specs[0]).toMatchObject({ id: 'default', source: PETSTORE })
    expect(json.specs[0].gates.map((gate) => gate.gate)).toEqual(['fail-on', 'min-grade'])
    expect(json.specs[0].report.api.title).toBe('E2E Test API')
    // No baseline, no count of new findings: there is nothing they would be new to.
    expect(json.specs[0]).not.toHaveProperty('newFindings')
  })

  it('writes the report to --output, leaving stdout empty', async () => {
    const output = join(dir, 'audit.md')
    const { stdout, code } = await audit(CLEAN, '--format', 'markdown', '--output', output)
    expect(code).toBe(0)
    expect(stdout).toBe('')
    expect(await readFile(output, 'utf8')).toMatch(/^# Schema audit — Clean E2E API\n/)
  })

  it('writes several reports in one run, stdout kept for --format', async () => {
    const json = join(dir, 'audit.json')
    const markdown = join(dir, 'audit.md')
    const alone = await audit(CLEAN, '--report', `json=${json}`, '--report', `markdown=${markdown}`)
    expect(alone.code).toBe(0)
    // Nothing asked for a report on stdout: --report took its place.
    expect(alone.stdout).toBe('')
    expect(JSON.parse(await readFile(json, 'utf8')).passed).toBe(true)
    expect(await readFile(markdown, 'utf8')).toMatch(/^# Schema audit — Clean E2E API\n/)

    const both = await audit(CLEAN, '--format', 'text', '--report', `json=${json}`)
    expect(both.stdout).toMatch(/^Schema audit — Clean E2E API\n/)
  })

  it('writes the formats a CI platform displays, placed at the line', async () => {
    const sarif = JSON.parse((await audit(PETSTORE, '--format', 'sarif')).stdout)
    const [result] = sarif.runs[0].results.filter((r) => r.ruleId === 'parameter-described')
    expect(result.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'tests/e2e/fixtures/e2e-api.json' },
      region: { startLine: 29, startColumn: 11 },
    })
    expect(sarif.runs[0].tool.driver).toMatchObject({
      name: 'apiglow',
      informationUri: 'https://apiglow.dev',
    })

    const annotations = (await audit(PETSTORE, '--format', 'github')).stdout
    expect(annotations).toContain(
      '::warning file=tests/e2e/fixtures/e2e-api.json,line=29,col=11,title=Parameter without description [parameter-described]::',
    )
    const quality = JSON.parse((await audit(PETSTORE, '--format', 'codequality')).stdout)
    expect(quality.find((issue) => issue.check_name === 'parameter-described')).toMatchObject({
      severity: 'major',
      location: { path: 'tests/e2e/fixtures/e2e-api.json', lines: { begin: 29 } },
    })
  })

  it('lists only what --min-severity keeps, the verdict still on the whole report', async () => {
    const full = JSON.parse((await audit(PETSTORE, '--format', 'json')).stdout).specs[0]
    const { stdout, code } = await audit(PETSTORE, '--format', 'json', '--min-severity', 'warning')
    const [spec] = JSON.parse(stdout).specs
    const listed = spec.report.categories.flatMap((category) => category.findings)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((finding) => finding.severity === 'warning')).toBe(true)
    expect(spec.omitted).toEqual({ lessSevere: full.report.counts.info, known: 0 })
    // The counts and the grade describe the document, not the listing.
    expect(spec.report.counts).toEqual(full.report.counts)
    expect(spec.report.grade).toBe(full.report.grade)
    expect(code).toBe(0)

    const text = (await audit(PETSTORE, '--min-severity', 'warning')).stdout
    expect(text).toContain(
      `${full.report.counts.info} less severe finding(s) not listed in this report.`,
    )
    expect(text).not.toContain('[property-described]')
  })

  it('lists only the new findings with --only-new, fingerprints unchanged', async () => {
    const baseline = join(dir, 'audit-baseline.json')
    await audit(PETSTORE, '--write-baseline', baseline)
    const changed = JSON.parse(await readFile(PETSTORE, 'utf8'))
    changed.paths['/pets'].get.parameters.push({
      name: 'sort',
      in: 'query',
      schema: { type: 'string' },
    })
    const next = join(dir, 'next.json')
    await writeFile(next, JSON.stringify(changed), 'utf8')

    const all = JSON.parse((await audit(next, '--format', 'json', '--baseline', baseline)).stdout)
    const only = JSON.parse(
      (await audit(next, '--format', 'json', '--baseline', baseline, '--only-new')).stdout,
    )
    const findingsOf = (json) => json.specs[0].report.categories.flatMap((c) => c.findings)
    const fresh = findingsOf(all).filter((finding) => !finding.known)
    expect(findingsOf(only)).toEqual(fresh)
    expect(only.specs[0].omitted.known).toBe(findingsOf(all).length - 1)
    const text = (await audit(next, '--baseline', baseline, '--only-new')).stdout
    expect(text).toMatch(
      /\d+ finding\(s\) the baseline already accepts not listed in this report\./,
    )
  })

  it('reports in the language it is asked for', async () => {
    const { stdout } = await audit(CLEAN, '--language', 'fr')
    expect(stdout).toMatch(/^Audit du schéma — Clean E2E API\n/)
  })

  it('audits every spec a multi-spec config declares, each under its id', async () => {
    const config = join(dir, 'apidoc.config.json')
    await writeFile(
      config,
      JSON.stringify({
        openapi: {
          specs: [
            { id: 'clean', url: relative(dir, CLEAN) },
            { id: 'pets', url: relative(dir, PETSTORE) },
          ],
        },
      }),
      'utf8',
    )
    const { stdout, stderr, code } = await audit('--config', config, '--fail-on', 'warning')
    expect(code).toBe(1)
    expect(stdout).toMatch(/^\[clean\]\nSchema audit — Clean E2E API\n/)
    expect(stdout).toContain('\n[pets]\nSchema audit — E2E Test API\n')
    expect(stderr).toMatch(/^\[clean\] PASS {2}--fail-on warning/)
    expect(stderr).toMatch(/^\[pets\] FAIL {2}--fail-on warning/m)

    const json = JSON.parse((await audit('--config', config, '--format', 'json')).stdout)
    expect(json.specs.map((spec) => spec.id)).toEqual(['clean', 'pets'])
  })

  // docs/audit.md §8.1: a monorepo's schemas in one run, each named by its path.
  it('audits every file a pattern matches, each under its path', async () => {
    for (const [name, source] of [
      ['apis/pets', PETSTORE],
      ['apis/clean', CLEAN],
      ['node_modules/vendor', PETSTORE],
    ]) {
      await mkdir(join(dir, name), { recursive: true })
      await copyFile(source, join(dir, name, 'openapi.json'))
    }
    const id = (name) => relative(process.cwd(), join(dir, name)).replaceAll('\\', '/')
    const pattern = `${dir}/**/openapi.{yaml,json}`
    const json = JSON.parse((await audit(pattern, '--format', 'json')).stdout)
    // Sorted, and never what sits under node_modules.
    expect(json.specs.map((spec) => spec.id)).toEqual([
      id('apis/clean/openapi.json'),
      id('apis/pets/openapi.json'),
    ])

    const baseline = join(dir, 'audit-baseline.json')
    await audit(pattern, '--write-baseline', baseline)
    expect(Object.keys(JSON.parse(await readFile(baseline, 'utf8')).specs)).toEqual([
      id('apis/clean/openapi.json'),
      id('apis/pets/openapi.json'),
    ])

    // Paths a shell expanded: the same ids as the pattern gives.
    const listed = await audit(
      join(dir, 'apis/pets/openapi.json'),
      join(dir, 'apis/clean/openapi.json'),
    )
    expect(listed.stdout).toMatch(new RegExp(`^\\[${id('apis/pets/openapi.json')}\\]\n`))
  })

  it('warns about a pattern that matches nothing, and stops on it when asked', async () => {
    const unmatched = `${dir}/none/*.yaml`
    const warned = await audit(CLEAN, unmatched)
    expect(warned.code).toBe(0)
    expect(warned.stderr).toMatch(/^warning: no file matches ".*none\/\*\.yaml"$/m)

    const strict = await audit(CLEAN, unmatched, '--fail-on-unmatched-globs')
    expect(strict.code).toBe(2)
    expect(strict.stderr).toMatch(/^apiglow audit: no file matches ".*none\/\*\.yaml"$/)

    // Nothing at all to audit is never a pass.
    const nothing = await audit(unmatched)
    expect(nothing.code).toBe(2)
  })

  // A leading `/` in a config means the site root, which on disk is the config's
  // own directory (docs/seo.md §4): the declarations below are relative to it.
  it('resolves what a config names against the config file, overlays applied', async () => {
    const config = join(dir, 'apidoc.config.json')
    await writeFile(
      config,
      JSON.stringify({
        openapi: {
          url: relative(dir, fixture('e2e-api-overlay.json')),
          overlays: [relative(dir, fixture('e2e-overlay.yaml'))],
        },
      }),
      'utf8',
    )
    const plain = JSON.parse(
      (await audit(fixture('e2e-api-overlay.json'), '--format', 'json')).stdout,
    )
    const overlaid = JSON.parse((await audit('--config', config, '--format', 'json')).stdout)
    expect(overlaid.specs[0].report).not.toEqual(plain.specs[0].report)
  })

  it('cannot run without an input, nor on a value it does not know', async () => {
    const cases = [
      [[], /a schema or --config is required/],
      [[CLEAN, '--config', 'x.json'], /a schema or --config, not both/],
      [[CLEAN, '--fail-on', 'fatal'], /--fail-on must be one of error, warning, info, none/],
      [[CLEAN, '--min-grade', 'E'], /--min-grade must be one of A, B, C, D, F/],
      [[CLEAN, '--min-score', '80%'], /--min-score must be an integer from 0 to 100/],
      [[CLEAN, '--format', 'pdf'], /--format must be one of text, json, markdown, sarif/],
      [[CLEAN, '--baseline', 'a', '--write-baseline', 'b'], /do not combine/],
      [[CLEAN, '--report', 'json'], /--report takes <format>=<file>, got "json"/],
      [[CLEAN, '--min-severity', 'none'], /--min-severity must be one of error, warning, info/],
      [[CLEAN, '--only-new'], /--only-new needs a --baseline/],
      [[CLEAN, '--prune-baseline', 'x.json'], /--prune-baseline needs a --baseline/],
      [[CLEAN, '--allow-stale-baseline'], /--allow-stale-baseline needs a --baseline/],
      [[CLEAN, '--fetch-timeout', '0'], /--fetch-timeout must be a number of seconds above 0/],
      [
        [CLEAN, '--fail-on', 'info', '--min-severity', 'warning'],
        /--fail-on info would fail on findings/,
      ],
      [[CLEAN, '--report', 'pdf=x.pdf'], /--report format must be one of/],
      [[CLEAN, '--output', 'x', '--report', 'json=x'], /two reports would be written to /],
      [[join(dir, 'missing.json')], /spec "default" could not be loaded/],
      [['--config', join(dir, 'missing.json')], /--config .* could not be read/],
      [[CLEAN, '--language', 'xx'], /unknown --language "xx"/],
    ]
    for (const [args, message] of cases) {
      const { stderr, code } = await audit(...args)
      expect(code, args.join(' ')).toBe(2)
      expect(stderr).toMatch(/^apiglow audit: /)
      expect(stderr).toMatch(message)
    }
  })

  it('refuses a baseline file it cannot trust rather than reading it as empty', async () => {
    const baseline = join(dir, 'audit-baseline.json')
    await writeFile(baseline, '{"specs": {}}', 'utf8')
    const { stderr, code } = await audit(CLEAN, '--baseline', baseline)
    expect(code).toBe(2)
    expect(stderr).toMatch(/--baseline .* could not be read: not an audit baseline/)
  })

  // The rule configuration (docs/audit.md §2.2): the same `audit` block the
  // page reads, or a file of its own for a run with no host config.
  it('grades under a rule configuration, and says so', async () => {
    const config = join(dir, 'audit.json')
    await writeFile(
      config,
      JSON.stringify({
        rules: { 'parameter-described': 'error' },
        overrides: [{ paths: ['/webhooks'], rules: { 'parameter-described': 'off' } }],
      }),
      'utf8',
    )
    const { stdout, stderr, code } = await audit(PETSTORE, '--audit-config', config)
    expect(code).toBe(1)
    expect(stdout).toContain(
      'Custom rule set — 1 rule(s) reconfigured, 1 path override(s) — not comparable with the default grade',
    )
    expect(stderr).toMatch(/ {2}error parameter-described — \S+:\d+:\d+ · GET \/pets\/\{petId\} · /)
    // Switched off under /webhooks: the webhook's parameter is neither a finding nor a check.
    expect(stderr).not.toContain('petAdopted')

    const json = JSON.parse(
      (await audit(PETSTORE, '--audit-config', config, '--format', 'json')).stdout,
    )
    expect(json.specs[0].report.profile).toEqual({
      custom: true,
      rules: { 'parameter-described': 'error' },
      options: {},
      overrides: 1,
    })
  })

  it('reads the rule configuration from the host config', async () => {
    const config = join(dir, 'apidoc.config.json')
    await writeFile(
      config,
      JSON.stringify({
        openapi: { url: relative(dir, CLEAN) },
        audit: { rules: { 'info-metadata': 'off' } },
      }),
      'utf8',
    )
    const json = JSON.parse((await audit('--config', config, '--format', 'json')).stdout)
    expect(json.specs[0].report.profile.custom).toBe(true)
  })

  // A pipeline must never pass on a configuration nobody wrote.
  it('refuses to run on a rule configuration it cannot read', async () => {
    const config = join(dir, 'audit.json')
    await writeFile(config, JSON.stringify({ rules: { 'parameter-describd': 'off' } }), 'utf8')
    const { stderr, code } = await audit(CLEAN, '--audit-config', config)
    expect(code).toBe(2)
    expect(stderr).toBe('apiglow audit: audit.rules: unknown rule "parameter-describd"')
    const missing = await audit(CLEAN, '--audit-config', join(dir, 'missing.json'))
    expect(missing.code).toBe(2)
    expect(missing.stderr).toMatch(/--audit-config .* could not be read/)
  })

  // docs/audit.md §8.1: what a terminal, an editor and a CI annotation need.
  it('places each finding at its line and column, across the files $refs reach', async () => {
    await writeFile(
      join(dir, 'openapi.yaml'),
      [
        'openapi: 3.1.0',
        'info: { title: Split API, version: 1.0.0 }',
        'paths:',
        '  /pets:',
        '    get:',
        '      summary: List pets',
        '      responses:',
        "        '200':",
        "          $ref: 'responses.yaml#/Pets'",
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      join(dir, 'responses.yaml'),
      [
        'Pets:',
        '  description: The pets',
        '  content:',
        '    application/json:',
        '      schema:',
        '        type: object',
        '        properties:',
        '          name: { type: string }',
        '',
      ].join('\n'),
      'utf8',
    )
    const { stdout } = await audit(join(dir, 'openapi.yaml'), '--format', 'json')
    const findings = JSON.parse(stdout).specs[0].report.categories.flatMap((c) => c.findings)
    const property = findings.find((f) => f.ruleId === 'property-described')
    expect(property.position).toMatchObject({ line: 8, column: 11 })
    expect(property.position.file).toMatch(/responses\.yaml$/)
    // Reached through the root file's `$ref`, which is where the walk crossed.
    expect(property.via).toEqual([expect.objectContaining({ line: 8, column: 9 })])
    expect(property.via[0].file).toMatch(/openapi\.yaml$/)

    const text = (await audit(join(dir, 'openapi.yaml'))).stdout
    expect(text).toMatch(/responses\.yaml:8:11 · GET \/pets/)
  })

  it('places findings relative to the working directory', async () => {
    const { stdout } = await audit(PETSTORE, '--format', 'json')
    const findings = JSON.parse(stdout).specs[0].report.categories.flatMap((c) => c.findings)
    expect(findings.every((f) => f.position?.file === 'tests/e2e/fixtures/e2e-api.json')).toBe(true)
    const parameter = findings.find((f) => f.dataPath === '/paths/~1pets/get/parameters/0')
    expect(parameter.position).toMatchObject({ line: 29, column: 11 })
  })

  // docs/audit.md §8.1: a job that must stay off the network, and one that
  // must not hang on a host that never answers.
  it('never fetches with --offline, even what it could do without', async () => {
    const positional = await audit('https://api.example.test/openapi.json', '--offline')
    expect(positional.code).toBe(2)
    expect(positional.stderr).toMatch(
      /^apiglow audit: --offline: https:\/\/api\.example\.test\/openapi\.json is a URL/,
    )

    // An overlay the loader would skip with a warning still stops the run.
    const config = join(dir, 'apidoc.config.json')
    await writeFile(
      config,
      JSON.stringify({
        openapi: { url: relative(dir, CLEAN), overlays: ['https://api.example.test/overlay.yaml'] },
      }),
      'utf8',
    )
    const overlay = await audit('--config', config, '--offline')
    expect(overlay.code).toBe(2)
    expect(overlay.stderr).toBe(
      'apiglow audit: --offline: https://api.example.test/overlay.yaml would be fetched',
    )
    expect(globalThis.fetch.name).toBe('fetch')
  })

  it('gives up on a document that does not arrive within --fetch-timeout', async () => {
    const server = createServer(() => {})
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/openapi.json`
    try {
      const { stderr, code } = await audit(url, '--fetch-timeout', '0.2')
      expect(code).toBe(2)
      expect(stderr).toBe(
        `apiglow audit: spec "default" could not be loaded: network — no answer from ${url} within 0.2 s (--fetch-timeout)`,
      )
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('explains a rule, or lists them all, without auditing anything', async () => {
    const explained = await audit('--explain', 'operation-id-present', '--language', 'fr')
    expect(explained.code ?? 0).toBe(0)
    expect(explained.stdout).toMatch(/^operation-id-present — /)
    expect(explained.stdout).toContain('Comment corriger')

    const listed = await audit('--list-rules')
    const { format, rules } = JSON.parse(listed.stdout)
    expect(format).toBe('apiglow-audit-rules')
    expect(rules.map((rule) => rule.id)).toContain('operation-id-present')

    const unknown = await audit('--explain', 'operation-id')
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('did you mean duplicate-operation-id, operation-id-present,')
    // A schema next to them would be silently ignored: refused instead.
    expect((await audit('--list-rules', CLEAN)).code).toBe(2)
  })

  it('prints its usage', async () => {
    const { stdout } = await audit('--help')
    expect(stdout).toMatch(/^Usage: apiglow audit <spec>\.\.\. \[options\]/)
    expect(stdout).toContain('Exit status: 0 passed, 1 a check failed, 2 the audit could not run.')
  })
})
