// "llms-full.txt" export (competitive analysis, prio 2 — AI angle): the
// whole doc concatenated into a single Markdown, to hand as-is to an LLM or
// serve statically alongside the host page. Pure function, tested by
// snapshot. Generated client-side: the doc is a hash-based SPA, a
// crawler/LLM can't browse it by URL.

import { publishedArazzo } from './arazzo.js'
import { toEndpointMarkdown } from './endpoint-markdown.js'
import { toScenarioMarkdown } from './scenario-markdown.js'

// Blank lines around the rule: a `---` stuck to the previous paragraph would
// be parsed as a setext heading, not as a horizontal rule.
const SEPARATOR = '\n\n---\n\n'

// How to authenticate against this API at all: the schemes it declares and,
// separately, which of them apply by default. Per-operation overrides are
// emitted by `toEndpointMarkdown`; without this block they would be overrides
// of nothing.
function authBlock(model) {
  const schemes = model.securitySchemes ?? []
  if (!schemes.length) return []
  const lines = ['', '## Authentication', '']
  for (const scheme of schemes) {
    const bits = [scheme.type]
    if (scheme.scheme) bits.push(scheme.scheme)
    if (scheme.in && scheme.paramName) bits.push(`${scheme.in} \`${scheme.paramName}\``)
    if (scheme.bearerFormat) bits.push(scheme.bearerFormat)
    const description = scheme.description?.trim().replaceAll('\n', ' ')
    lines.push(`- \`${scheme.name}\` (${bits.join(', ')})${description ? ` — ${description}` : ''}`)
  }
  const required = model.security ?? []
  if (required.length) {
    lines.push('', 'Applies to every operation unless overridden — one of:', '')
    for (const requirement of required) {
      const names = Object.entries(requirement).map(
        ([name, scopes]) => `\`${name}\`${scopes?.length ? ` (scopes: ${scopes.join(', ')})` : ''}`,
      )
      lines.push(`- ${names.join(' + ') || 'none'}`)
    }
  }
  return lines
}

// The recipe an agent runs, inlined rather than linked: this file is the
// territory handed over in one piece, and a recipe behind a second fetch is a
// recipe the model does not have (docs/scenario-handoff.md §3.3). Which
// document that is — the author's own or one `toArazzo` generates — is
// `publishedArazzo`'s rule, shared with the bake so that the copy inlined here
// and the file served next to it are the same document.
//
// `ops` covers the webhooks too, as the scenario view and the bake do: a step
// resolved here and orphaned in the served file would be the same recipe
// described twice.
function workflowBlock(entry, { ops, baseUrl, specUrl }) {
  const markdown = toScenarioMarkdown(entry.scenario, {
    ops,
    baseUrl,
    heading: `Workflow: ${entry.title}`,
  }).trim()
  const recipe = publishedArazzo(entry, { ops, specUrl })
  if (!recipe) return markdown
  return `${markdown}\n\n## Arazzo recipe\n\n\`\`\`json\n${JSON.stringify(recipe, null, 2)}\n\`\`\``
}

// Where the section came from, for the reader that has to name it back: an
// agent answering out of this file holds the whole documentation and not one
// address to cite. Only a baked install has one — nothing is served otherwise
// — so the line appears with the mapper and never without it.
function withSource(markdown, url) {
  if (!url) return markdown
  const [heading, ...rest] = markdown.split('\n')
  return [heading, '', `Source: ${url}`, ...rest].join('\n')
}

// pages: [{ slug, title, content }] — the Markdown content of the config's
// pages, already fetched by the caller (generation stays synchronous and pure).
// scenarios: [{ title, scenario, arazzo }] — the config-declared ones, loaded
// the same way; a reader's own are private and never published
// (docs/scenario-handoff.md §2).
// specUrl: the published schema URL, or '' when the schema only exists inside
// the host page — it decides whether a recipe can be generated at all.
// urls: the bake's mapper ({ op, page, scenario }), pointing at the pages it
// serves for each section of this file.
export function toLlmsFullText(
  model,
  { baseUrl = '', pages = [], scenarios = [], specUrl = '', urls = null } = {},
) {
  const blocks = []
  const sourceOf = (kind, id) => (urls && id ? urls[kind](id) : '')

  const head = [`# ${model.info.title}`]
  const meta = [
    model.info.version && `Version ${model.info.version}`,
    `OpenAPI ${model.sourceVersion}`,
  ]
    .filter(Boolean)
    .join(' — ')
  head.push('', `> ${meta}`)
  if (baseUrl) head.push('', `Base URL: ${String(baseUrl).replace(/\/+$/, '')}`)
  if (model.externalDocs?.url) {
    const label = model.externalDocs.description?.trim()
    head.push('', `More: ${model.externalDocs.url}${label ? ` — ${label}` : ''}`)
  }
  if (model.info.description) head.push('', model.info.description.trim())
  // The declared servers, not just the one the reader happens to be pointed
  // at: `baseUrl` above is the active environment, which the document itself
  // may not even list.
  if (model.servers?.length) {
    head.push('', '## Servers', '')
    for (const server of model.servers) {
      const label = server.description?.trim()
      head.push(`- ${server.url}${label ? ` — ${label}` : ''}`)
    }
  }
  head.push(...authBlock(model))
  blocks.push(head.join('\n'))

  for (const page of pages) {
    // Explicit section heading: the page content has its own headings, often
    // already H1 — the prefix ties it back to its place in the nav.
    const body = `# Page: ${page.title}\n\n${String(page.content ?? '').trim()}`
    blocks.push(withSource(body, sourceOf('page', page.slug)))
  }

  // After the pages and before the operations, the order of the map: a
  // workflow reads as the guide to a sequence of endpoints, and the endpoints
  // it names are below it.
  const ops = [...model.operations, ...(model.webhooks ?? [])]
  for (const entry of scenarios) {
    const block = workflowBlock(entry, { ops, baseUrl, specUrl })
    blocks.push(withSource(block, sourceOf('scenario', entry.id)))
  }

  for (const op of model.operations) {
    blocks.push(withSource(toEndpointMarkdown(op, { baseUrl }).trim(), sourceOf('op', op.id)))
  }

  for (const webhook of model.webhooks ?? []) {
    blocks.push(withSource(toEndpointMarkdown(webhook).trim(), sourceOf('op', webhook.id)))
  }

  return `${blocks.join(SEPARATOR)}\n`
}
