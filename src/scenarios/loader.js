import { isArazzoDocument, parseArazzo } from '../import/arazzo.js'
import { parseDocumentText } from '../openapi/loader.js'
import { decodeScenarioFile, isConfigScenarioId } from './model.js'

// The declared-scenario loader (docs/scenarios.md §3): a `scenarios[]` entry in,
// the scenarios it declares out. Two independent axes, and neither is a mode
// the author selects:
//
//   - the FORMAT is read from the document — our `apiglow-scenario` envelope,
//     or an Arazzo workflow document (JSON or YAML), sniffed with
//     `isArazzoDocument` and parsed by the very importer the file picker uses;
//   - the CARRIER says where the document comes from — `url` (fetched) or
//     `document` (the object straight in the config, no fetch, no error state).
//
// An Arazzo document natively holds `workflows[]`, so one entry can declare
// several scenarios; the envelope holds exactly one. That is why the ids the
// nav and the routes use are known only here, and not from the config alone.
//
// Same contract as the parsers it calls: untrusted input, never a throw. An
// entry that yields nothing keeps a record carrying its error, so the nav still
// lists what the config declared and the route can say what went wrong.

export async function loadConfigScenarios(entries, { ops = [], fetchText } = {}) {
  const declared = entries ?? []
  // Fetched in parallel, resolved in declaration order: the ids depend on who
  // claimed what first, and that order has to be the config's, not the
  // network's.
  const documents = await Promise.all(declared.map((entry) => readEntry(entry, fetchText)))
  // Entry ids are reserved before any workflow is looked at, so declaring an
  // Arazzo document next to an envelope never moves the envelope's route.
  const claimed = new Set(declared.map((entry) => entry.id))
  const records = []
  declared.forEach((entry, index) => {
    // Its own id is not an obstacle to itself: a document whose single
    // workflow is named after the entry keeps the address the config states.
    claimed.delete(entry.id)
    records.push(...resolveEntry(entry, documents[index], { ops, claimed }))
    claimed.add(entry.id)
  })
  return records
}

// The publishable set (docs/scenario-handoff.md §2): what the config declares
// and nothing else — a reader's own scenarios live in IndexedDB, which neither
// the export path nor a Node process opens, so a downloaded file and a baked
// one describe the same documentation.
//
// One projection for both, because that is the record every publication
// surface reads: a field added for one of them and missed by the other is a
// divergence nothing would report. Where the recipe is *served* is what the
// two genuinely disagree on, so they add `recipeUrl` themselves. An entry that
// did not resolve is dropped rather than failing the whole export, and
// `onSkip` is how a caller with somewhere to say so says it.
export async function publishedScenarios(entries, { ops = [], fetchText, onSkip } = {}) {
  const records = await loadConfigScenarios(entries, { ops, fetchText })
  const published = []
  for (const record of records) {
    if (!record.scenario) {
      onSkip?.(record)
      continue
    }
    published.push({
      id: record.id,
      title: record.title,
      scenario: record.scenario,
      arazzo: record.arazzo,
      url: record.url,
    })
  }
  return published
}

async function readEntry(entry, fetchText) {
  // What the entry carries wins over what it would have to fetch — the rule
  // `docsPages` and `openapi.spec` already state.
  if (entry.document) return { document: entry.document }
  try {
    return { document: await parseDocumentText(await fetchText(entry.url)) }
  } catch (err) {
    return { error: { code: 'scenario-unreachable', url: entry.url, cause: err } }
  }
}

function resolveEntry(entry, read, { ops, claimed }) {
  // `arazzo` is the authored document, kept as it was read: what the model
  // holds is our reading of it, and the publication surfaces
  // (docs/scenario-handoff.md §3.3, §3.4) hand out the file itself so nothing
  // of it is lost on the way. Null for our own envelope, which has no such
  // file behind it.
  const base = {
    entryId: entry.id,
    url: entry.url ?? '',
    pinned: entry.pinned === true,
    arazzo: null,
  }
  const failed = (error, warnings = []) => [
    { ...base, id: entry.id, title: entry.title || entry.id, scenario: null, warnings, error },
  ]
  if (read.error) return failed(read.error)
  if (isArazzoDocument(read.document)) {
    const { scenarios, warnings, errors } = parseArazzo(read.document, {
      ops,
      source: 'config',
      id: (workflowId, position) =>
        claim(claimed, entry, isConfigScenarioId(workflowId) ? workflowId : rank(entry, position)),
    })
    if (!scenarios.length) return failed(errors[0] ?? { code: 'arazzo-no-workflow' }, warnings)
    return scenarios.map((scenario) => ({
      ...base,
      arazzo: read.document,
      id: scenario.id,
      // A declared title names one scenario; it cannot name three. A document
      // holding several hands each workflow its own name — which `parseArazzo`
      // already prefixes with the document's title, so the group stays legible
      // in a nav that lists them side by side.
      title: (scenarios.length === 1 && entry.title) || scenario.name || scenario.id,
      scenario,
      // The whole document's warnings, on each of its scenarios: they are what
      // the badge names, and a reader looking at one workflow has no way to
      // open the others to find out what this file could not carry.
      warnings,
      error: null,
    }))
  }
  const { scenario, errors } = decodeScenarioFile(read.document, {
    source: 'config',
    id: entry.id,
  })
  if (!scenario) return failed(errors[0] ?? { code: 'file-invalid' })
  return [
    {
      ...base,
      id: scenario.id,
      title: entry.title || scenario.name || entry.id,
      scenario,
      // Non-fatal discrepancies (a step without an opId, a badly named
      // extraction) travel like an Arazzo document's: they are addressed to
      // the file's author, and the reader sees that something is missing.
      warnings: errors,
      error: null,
    },
  ]
}

// Two documents claiming the same `workflowId` are told apart by the entry that
// declared them — the one thing an author controls from the config, without
// touching a file they may not own. First claimant keeps the bare id, so
// declaration order decides, and reading the config is enough to know.
function claim(claimed, entry, wanted) {
  let id = wanted
  if (claimed.has(id)) id = `${entry.id}.${wanted}`
  // A document repeating a `workflowId` within itself: past the entry prefix
  // there is nothing left to disambiguate with but a number.
  for (let n = 2; claimed.has(id); n += 1) id = `${entry.id}.${wanted}-${n}`
  claimed.add(id)
  return id
}

// A `workflowId` Arazzo itself would refuse: the workflow is still rendered,
// under an address derived from the entry rather than dropped for the shape of
// its name.
function rank(entry, position) {
  return `${entry.id}-${position + 1}`
}
