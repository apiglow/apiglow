// The CI hand-off (docs/scenario-handoff.md §4): the job a reader pastes into
// their own pipeline so this scenario's Arazzo document runs on a schedule.
// Scheduling is structurally impossible in a front-end product — this hands the
// work to the CI the reader already has, and to the runners the ecosystem
// already runs Arazzo in. Pure generators, snapshot-tested (rule 12).
//
// Three contracts here are somebody else's: each runner's CLI, each runner's
// declared Arazzo revision, and the two platforms' YAML. `CI_RUNNERS` gathers
// the first two in one table for the reason `MCP_BRIDGES` is one table — one
// place to fix when a project moves, each entry verified against that project's
// own documentation.
//
// The support check is deliberately mechanical: a runner declares the revision
// its own documentation claims, constructs declare the revision that introduced
// them, and a gap is the comparison of the two. Claiming more than a project
// states about itself would be inventing a contract we do not own — and a
// declared Arazzo document (§2.1) is checked as it stands, which is the only
// honest thing to do with a file we did not write.
//
// A snippet never embeds a value (rule 12): what a workflow input needs travels
// as a name, wired to the platform's own secret store.

import { slugify } from '../openapi/model.js'

// Each runtime carries its own GitHub setup step: a third one in any other
// language would otherwise fall into the `else` of a two-way branch and emit a
// job that installs Python.
const NODE = {
  version: '22',
  image: 'node:22',
  install: [],
  action: 'actions/setup-node@v4',
  versionKey: 'node-version',
}
const PYTHON = {
  version: '3.12',
  image: 'python:3.12',
  install: ['pip install arazzo-runner'],
  action: 'actions/setup-python@v5',
  versionKey: 'python-version',
}

export const CI_RUNNERS = [
  {
    id: 'redocly-respect',
    name: 'Redocly Respect',
    docs: 'https://redocly.com/docs/respect/commands/respect',
    // What the project's own documentation states it reads. Empty = it states
    // nothing, which the panel reports rather than resolving either way.
    arazzo: '1.0.1',
    runtime: NODE,
    command: ({ file, workflowId, inputs }) => [
      `npx @redocly/cli@latest respect ${file}`,
      ...(workflowId ? [`--workflow ${workflowId}`] : []),
      ...inputs.map(({ input, env }) => `--input ${input}="$${env}"`),
    ],
  },
  {
    id: 'arazzo-runner',
    name: 'Arazzo Runner',
    docs: 'https://docs.jentic.com/getting-started/arazzo-runner/',
    arazzo: '',
    runtime: PYTHON,
    command: ({ file, workflowId, inputs }) => [
      `arazzo-runner execute-workflow ${file}`,
      ...(workflowId ? [`--workflow-id ${workflowId}`] : []),
      // One JSON object rather than repeated flags, the shape this CLI takes.
      // Double quotes outside so the shell still expands the variables inside.
      ...(inputs.length
        ? [
            `--inputs "{${inputs.map(({ input, env }) => `\\"${input}\\": \\"$${env}\\"`).join(', ')}}"`,
          ]
        : []),
    ],
  },
]

export const CI_PLATFORMS = ['github', 'gitlab']

// Constructs and the Arazzo revision that introduced them. A runner reading an
// earlier revision will not execute them — the gap the panel names, one warning
// per construct, without guessing at anyone's roadmap.
const CONSTRUCT_SINCE = { selectorOutputs: '1.1.0' }

function compareVersions(a, b) {
  const parts = (value) =>
    String(value ?? '')
      .split('.')
      .map(Number)
  const [left, right] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff) return diff
  }
  return 0
}

// A Selector Object output (`{ context, selector, type }`) is 1.1's only shape
// for a query extraction — the very thing `toArazzo` emits for one, so this is
// not a hypothetical construct in documents we generate.
function constructsUsed(document) {
  const used = new Set()
  const scan = (outputs) => {
    for (const value of Object.values(outputs ?? {})) {
      if (value && typeof value === 'object') used.add('selectorOutputs')
    }
  }
  for (const workflow of document?.workflows ?? []) {
    scan(workflow.outputs)
    for (const step of workflow.steps ?? []) scan(step.outputs)
  }
  return [...used]
}

// The workflow this scenario is: an entry declaring an Arazzo document holds
// one scenario per workflow, and the loader's id is the `workflowId` — prefixed
// with the entry id when two documents claimed the same one. Nothing matching
// means the id was derived rather than claimed: the job runs the first
// workflow, and says so.
function selectWorkflow(document, scenarioId) {
  const workflows = document?.workflows ?? []
  if (!workflows.length) return { workflow: null, guessed: false }
  const id = String(scenarioId ?? '')
  const match = workflows.find(
    (workflow) => workflow.workflowId === id || id.endsWith(`.${workflow.workflowId}`),
  )
  if (match) return { workflow: match, guessed: false }
  return { workflow: workflows[0], guessed: workflows.length > 1 }
}

// What the caller must provide for the workflow to run: its declared `required`
// inputs, or — for a document that declares none — every input carrying no
// default. This is the list the prerequisites panel already computes on our
// side of the same workflow; here it is read off the document, because that is
// what the runner binds.
function requiredInputs(workflow) {
  const schema = workflow?.inputs
  if (Array.isArray(schema?.required)) return schema.required.map(String)
  return Object.entries(schema?.properties ?? {})
    .filter(([, property]) => property?.default === undefined)
    .map(([name]) => name)
}

// An input name is free-form; an environment variable is not. Two names
// sanitizing alike would silently share one value, so the second gets a rank.
function secretNames(inputs) {
  const used = new Set()
  return inputs.map((input) => {
    const base =
      String(input)
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase() || 'INPUT'
    const prefixed = /^\d/.test(base) ? `INPUT_${base}` : base
    let env = prefixed
    for (let n = 2; used.has(env); n += 1) env = `${prefixed}_${n}`
    used.add(env)
    return { input, env }
  })
}

// YAML scalar: bare when the value is made of characters YAML reads as text,
// single-quoted otherwise — a URL carries a colon, and a title may carry
// anything.
function yamlText(value) {
  const text = String(value ?? '')
  if (/^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(text)) return text
  return `'${text.replaceAll("'", "''")}'`
}

// The file the runner is pointed at. Committed: the path the panel names, which
// works for every install, baked or not — and a workflow file in a PR is the
// diffable artifact the whole design aims at. Fetched: the document the host
// already serves, downloaded into the job's working directory, keeping the
// extension it is served under since a runner reads both JSON and YAML.
function fetchedName(url) {
  return /\.ya?ml($|[?#])/i.test(String(url)) ? 'scenario.arazzo.yaml' : 'scenario.arazzo.json'
}

function githubSnippet({ runner, jobName, slug, file, command, secrets, url, documentFile }) {
  const lines = [
    `# ${file}`,
    `name: ${yamlText(jobName)}`,
    'on:',
    '  workflow_dispatch:',
    '  schedule:',
    "    - cron: '0 6 * * *'",
    'jobs:',
    `  ${slug}:`,
    '    runs-on: ubuntu-latest',
    '    steps:',
  ]
  // Nothing is checked out when the document is fetched: the job reads no file
  // of the repository at all.
  if (!url) lines.push('      - uses: actions/checkout@v4')
  lines.push(
    `      - uses: ${runner.runtime.action}`,
    '        with:',
    `          ${runner.runtime.versionKey}: '${runner.runtime.version}'`,
  )
  if (url) {
    lines.push(
      '      - name: Fetch the workflow document',
      `        run: curl -fsSL ${yamlText(url)} -o ${documentFile}`,
    )
  }
  for (const install of runner.runtime.install) lines.push(`      - run: ${install}`)
  lines.push('      - name: Run the workflow', '        run: |')
  command.forEach((chunk, index) => {
    const continued = index < command.length - 1 ? ' \\' : ''
    lines.push(`${index === 0 ? '          ' : '            '}${chunk}${continued}`)
  })
  if (secrets.length) {
    lines.push('        env:')
    for (const { env } of secrets) lines.push(`          ${env}: \${{ secrets.${env} }}`)
  }
  return `${lines.join('\n')}\n`
}

function gitlabSnippet({ runner, slug, file, command, secrets, url, documentFile }) {
  const lines = [`# ${file}`]
  if (secrets.length) {
    lines.push(
      '# Define these as masked CI/CD variables (Settings → CI/CD → Variables):',
      ...secrets.map(({ env }) => `#   ${env}`),
    )
  }
  lines.push(
    '# Run it on a schedule from CI/CD → Schedules.',
    `${slug}:`,
    `  image: ${runner.runtime.image}`,
    '  script:',
  )
  if (url) lines.push(`    - curl -fsSL ${yamlText(url)} -o ${documentFile}`)
  for (const install of runner.runtime.install) lines.push(`    - ${install}`)
  // One line per script entry: a YAML sequence item carries no backslash
  // continuation, so the command that GitHub spreads over several lines is
  // joined here.
  lines.push(`    - ${command.join(' ')}`)
  return `${lines.join('\n')}\n`
}

// → { snippet, file, documentPath, secrets, warnings, workflowId }
//
// `document`: the Arazzo document this scenario publishes — the authored one
// when the config declared it, the generated one otherwise (`publishedArazzo`).
// No document, no snippet: an install with no published schema has nothing a
// runner could fetch, and the panel is absent rather than wrong (§2).
// `url`: the address the config states for a declared Arazzo document, already
// served by the host — the single-source case, where nothing has to be
// committed. Empty otherwise.
// `authored`: the document is the author's own, not one we generated.
//
// Warnings are codes with their parameters, translated by the caller — the
// contract the importers and the MCP export already share.
export function toCiSnippet(
  document,
  {
    runnerId = '',
    platform = CI_PLATFORMS[0],
    name = '',
    scenarioId = '',
    url = '',
    authored = false,
  } = {},
) {
  const runner = CI_RUNNERS.find((candidate) => candidate.id === runnerId) ?? CI_RUNNERS[0]
  const slug = slugify(name) || slugify(scenarioId) || 'scenario'
  // A job id starts with a letter or an underscore on GitHub's side; a scenario
  // named "2FA login" slugifies to something that does not.
  const jobId = /^[A-Za-z_]/.test(slug) ? slug : `run-${slug}`
  const documentPath = `arazzo/${slug}.arazzo.json`
  const documentFile = url ? fetchedName(url) : documentPath
  const { workflow, guessed } = selectWorkflow(document, scenarioId)
  const secrets = secretNames(requiredInputs(workflow))
  const command = runner.command({
    file: documentFile,
    workflowId: workflow?.workflowId ?? '',
    inputs: secrets,
  })

  // Every warning names the runner it is about: the panel switches runners
  // under the same list, and a gap belongs to the one selected.
  const warnings = []
  if (!runner.arazzo) warnings.push({ code: 'versionUnstated', runner: runner.name })
  else if (compareVersions(document.arazzo, runner.arazzo) > 0) {
    warnings.push({
      code: 'version',
      runner: runner.name,
      supported: runner.arazzo,
      document: document.arazzo,
    })
    for (const construct of constructsUsed(document)) {
      if (compareVersions(CONSTRUCT_SINCE[construct], runner.arazzo) > 0)
        warnings.push({ code: 'construct', construct, runner: runner.name })
    }
  }
  if (guessed) warnings.push({ code: 'workflowGuessed', workflowId: workflow.workflowId })
  if (authored) warnings.push({ code: 'authored' })

  const file = platform === 'gitlab' ? '.gitlab-ci.yml' : `.github/workflows/${slug}.yml`
  const build = platform === 'gitlab' ? gitlabSnippet : githubSnippet
  return {
    snippet: build({
      runner,
      jobName: name || slug,
      slug: jobId,
      file,
      command,
      secrets,
      url,
      documentFile,
    }),
    file,
    documentPath,
    secrets,
    warnings,
    workflowId: workflow?.workflowId ?? '',
  }
}
