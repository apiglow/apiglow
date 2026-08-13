// "llms.txt" index (llmstxt.org): the map an agent reads first — one line per
// operation, with the URL that opens it — where `llms-full.txt` is the expanded
// version it reads next. Pure function, tested by snapshot. Labels in English
// like the other exports: technical artifact, not UI.
//
// The links go through the router's own builders rather than a literal
// `#/op/…`: the multi-spec prefix is decided there, and a hand-written hash
// would silently drop it. The only hidden input is that prefix, locked at boot
// (`setRouteSpecId`), so the generator stays deterministic for a given install.
// A baked install hands in its own mapper instead (`urls`), because there the
// destinations exist as files.

import { docsZoneEntries } from '../docs/pages.js'
import { opHash, pageHash, scenarioHash } from '../router.js'
import { scenarioVariables } from '../scenarios/model.js'
import { siteBase, siteRoot } from './site-layout.js'

// Beyond this, the blockquote summary stops being a summary. Cut on a word
// boundary — llms.txt is read by a machine, but a truncated word reads as
// corruption in both directions.
const MAX_SUMMARY = 280

function oneLine(value) {
  return String(value ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

// First paragraph of the description, as the fallback summary: `info.summary`
// (3.1) is the field meant for this, and most documents still don't have one.
function leadParagraph(description) {
  const first = String(description ?? '')
    .split(/\n\s*\n/)[0]
    .trim()
  const line = oneLine(first)
  if (line.length <= MAX_SUMMARY) return line
  const cut = line.slice(0, MAX_SUMMARY)
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`
}

function link(name, url, note) {
  return `- [${name}](${url})${note ? `: ${note}` : ''}`
}

// The Reference link's own caveat. "as published" is only worth saying when
// something follows it: with no overlay and nothing hidden, the file and this
// index describe the same API and the plain label is the honest one.
function specNote(overlays, hidden) {
  const caveats = [
    overlays
      ? `this documentation renders it through ${overlays} overlay(s) the file does not carry`
      : null,
    hidden ? `it declares ${hidden} operation(s) this documentation does not list` : null,
  ].filter(Boolean)
  if (!caveats.length) return 'the machine-readable contract'
  return `the machine-readable contract as published — ${caveats.join('; ')}`
}

function trimSlash(url) {
  return String(url ?? '').replace(/\/+$/, '')
}

// Where every link in this file goes when the install is not baked: the host
// page's own hash routes, which is the only place the documentation exists.
// A baked one passes `urls` instead — the served `.md` mirrors, as
// llmstxt.org asks, so an agent gets Markdown it can fetch rather than a route
// it cannot follow.
function hashUrls(base) {
  return {
    op: (id) => `${base}${opHash(id)}`,
    page: (slug) => `${base}${pageHash(slug)}`,
    scenario: (id) => `${base}${scenarioHash(id)}`,
  }
}

// Convention documented in the README: llms-full.txt sits next to the host
// page. Derived rather than configured — a host that serves it elsewhere edits
// one line of a text file, which is cheaper than a config key nobody sets.
function siblingUrl(base, filename) {
  if (!base) return ''
  return `${siteRoot(base)}${filename}`
}

function operationEntry(op, urls) {
  const name =
    op.kind === 'webhook'
      ? `${op.method.toUpperCase()} ${op.name}`
      : `${op.method.toUpperCase()} ${op.path}`
  const note = [op.deprecated ? '(deprecated)' : '', oneLine(op.summary || op.description)]
    .filter(Boolean)
    .join(' ')
  return link(name, urls.op(op.id), note)
}

// The docs zone of the nav (docs/docs-pages.md §7), as llms.txt sections.
// Grouped pages get their group's title as the heading — the arrangement the
// docs author chose is information, and flattening it would throw it away.
// Ungrouped pages share one "Guides" section rather than opening a new heading
// each time one follows a group: this is a map, and two identical headings
// would read as a duplicate rather than as an order.
// External links are not documentation to read: they join `## Optional`, next
// to the terms of service and the license.
// `ungrouped` names the bucket for pages that belong to no group — it differs
// per zone (§2.7) because the two are printed on either side of the reference,
// and one heading appearing twice in a map reads as a duplicate.
function docsSections(outline, urls, ungrouped) {
  const links = []
  // Keyed by title, so two headings that would read the same become one
  // section — including a group a host happens to have named "Guides". A map
  // with a heading printed twice reads as a duplicate, not as an order.
  const sections = new Map()
  const addPage = (title, page) => {
    const line = link(page.title, urls.page(page.slug))
    const lines = sections.get(title)
    if (lines) lines.push(line)
    else sections.set(title, [line])
  }
  for (const entry of outline) {
    if (entry.kind === 'link') {
      links.push(link(entry.title, entry.href))
    } else if (entry.kind === 'page') {
      addPage(ungrouped, entry)
    } else {
      for (const child of entry.entries) {
        if (child.kind === 'link') links.push(link(child.title, child.href))
        else addPage(entry.title, child)
      }
    }
  }
  return { sections: [...sections].map(([title, lines]) => ({ title, lines })), links }
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// One declared scenario, one line (docs/scenario-handoff.md §3.2). The counts
// are what an agent decides on before opening anything: how long the sequence
// is, and how much it has to provide for it to run — `required` being what the
// prerequisites panel and the Markdown mirror already call for, so the three
// answer "why would this fail" with the same number.
//
// `recipeUrl` is a file the host already serves, linked as the config states
// it: relative or absolute, it resolves from here the way it resolves from the
// host page, which is where this file sits.
function workflowEntry(entry, urls) {
  const counts = [
    plural(entry.scenario?.steps?.length ?? 0, 'step'),
    plural(scenarioVariables(entry.scenario).required.length, 'input'),
  ].join(', ')
  const recipe = entry.recipeUrl
    ? ` — the [Arazzo recipe](${entry.recipeUrl}) runs it unchanged in CI.`
    : ''
  return link(entry.title, urls.scenario(entry.id), `${counts}${recipe}`)
}

// `outline`: the docs zone as arranged in the nav ({ kind, title, … }), passed
// by the shell — it is part of the documentation an agent should read, and the
// model knows nothing about it.
// `scenarios`: the config-declared ones, loaded ({ id, title, scenario,
// recipeUrl }). A reader's own are private and never published
// (docs/scenario-handoff.md §2); the feature turned off passes none, and there
// is no section rather than an empty one.
// `urls`: the bake's mapper ({ op, page, scenario }), pointing at the files it
// serves; without one the links stay on the host page's hash routes.
export function toLlmsText(
  model,
  {
    docsUrl = '',
    baseUrl = '',
    specUrl = '',
    fullUrl = '',
    outline = [],
    overlays = 0,
    scenarios = [],
    urls = null,
  } = {},
) {
  // Read off the model rather than passed in: what hiding removed is a property
  // of the document this file was generated from, not of the install.
  const hidden = model.hiddenOperations ?? 0
  const base = siteBase(docsUrl)
  const linkTo = urls ?? hashUrls(base)
  const lines = [`# ${model.info.title}`]

  const summary = oneLine(model.info.summary) || leadParagraph(model.info.description)
  if (summary) lines.push('', `> ${summary}`)

  const meta = [
    model.info.version && `Version ${model.info.version}`,
    `OpenAPI ${model.sourceVersion}`,
  ]
    .filter(Boolean)
    .join(' — ')
  lines.push('', `${meta}.`)
  if (baseUrl) lines.push('', `Base URL: ${trimSlash(baseUrl)}`)

  // One orientation line, not the contract: an agent deciding whether it can
  // call this API at all needs to know credentials are required and of what
  // kind. Which scheme applies to which operation is llms-full's job.
  const schemes = model.securitySchemes ?? []
  if (schemes.length) {
    const named = schemes.map((scheme) =>
      [scheme.name, scheme.scheme ? `${scheme.type}/${scheme.scheme}` : scheme.type].join(': '),
    )
    lines.push('', `Authentication: ${named.join(', ')}.`)
  }

  // The two docs zones bracket the reference here as they do in the nav: the
  // arrangement the author chose is information, and an agent reading the map
  // top to bottom should meet the guides before the endpoints and the
  // appendix after them.
  const docs = docsSections(docsZoneEntries(outline, 'top'), linkTo, 'Guides')
  const trailingDocs = docsSections(docsZoneEntries(outline, 'bottom'), linkTo, 'Resources')
  for (const section of docs.sections) {
    lines.push('', `## ${section.title}`, '', ...section.lines)
  }

  // Between the guides and the reference, the place scenarios occupy in the nav
  // (docs/scenarios.md §5.1): the arrangement the author chose is information
  // in the map exactly as it is in the page. "Workflows" rather than
  // "Scenarios" — the reader here is an agent, and workflow is the Arazzo noun
  // it already knows.
  if (scenarios.length) {
    lines.push('', '## Workflows', '')
    for (const entry of scenarios) lines.push(workflowEntry(entry, linkTo))
  }

  const byId = new Map(model.operations.map((op) => [op.id, op]))
  for (const group of model.groups ?? []) {
    const ops = group.operationIds.map((id) => byId.get(id)).filter(Boolean)
    if (!ops.length) continue
    // `tag: null` is the model's fallback group; its label belongs to the
    // consumer, and here the consumer is an English text file.
    lines.push('', `## ${group.tag ?? 'Other operations'}`, '')
    for (const op of ops) lines.push(operationEntry(op, linkTo))
  }

  if (model.webhooks?.length) {
    lines.push('', '## Webhooks', '')
    for (const webhook of model.webhooks) lines.push(operationEntry(webhook, linkTo))
  }

  for (const section of trailingDocs.sections) {
    lines.push('', `## ${section.title}`, '', ...section.lines)
  }

  // Everything below is a pointer out of this file, in the order an agent
  // should try them: the expanded docs, then the contract, then the human
  // metadata it can skip.
  const reference = [
    link(
      'Full documentation (llms-full.txt)',
      fullUrl || siblingUrl(base, 'llms-full.txt'),
      'every operation with its parameters, schemas and examples',
    ),
    // The one link in this file that does not lead to what the file describes:
    // the URL serves the published document, everything above was generated
    // from it overlaid and filtered. An agent told to prefer the
    // machine-readable contract has to know the two can disagree, and in which
    // direction each time — an overlay makes the file say less than this index,
    // hiding makes it say more.
    specUrl ? link('OpenAPI specification', specUrl, specNote(overlays, hidden)) : null,
  ].filter(Boolean)
  lines.push('', '## Reference', '', ...reference)

  const optional = [
    ...docs.links,
    ...trailingDocs.links,
    model.externalDocs?.url
      ? link(
          'External documentation',
          model.externalDocs.url,
          oneLine(model.externalDocs.description),
        )
      : null,
    model.info.termsOfService ? link('Terms of service', model.info.termsOfService) : null,
    model.info.license?.url
      ? link(model.info.license.name || 'License', model.info.license.url)
      : null,
  ].filter(Boolean)
  if (optional.length) lines.push('', '## Optional', '', ...optional)

  return `${lines.join('\n')}\n`
}
