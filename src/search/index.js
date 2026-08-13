// Full-text search (Cmd+K palette): in-memory index built once
// from the normalized model + config pages, queried on every
// keystroke. Pure module, no DOM dependency.

// Aligned with the render's auto-expansion depth (schema-view): beyond that,
// fields aren't visible anyway without manual unfolding.
const MAX_DEPTH = 3

// Cuts cycles via the visited-nodes Set, not via the `circular` flag:
// the latter marks the ENTRY node of a cycle, which still carries its
// properties — skipping it would index no field of recursive schemas.
function collectProperties(schema, depth, seen, out) {
  if (!schema || depth > MAX_DEPTH || seen.has(schema)) return
  seen.add(schema)
  for (const prop of schema.properties ?? []) {
    out.add(prop.name)
    collectProperties(prop.schema, depth + 1, seen, out)
  }
  if (typeof schema.additionalProperties === 'object') {
    collectProperties(schema.additionalProperties, depth + 1, seen, out)
  }
  // An array is transparent: its items' properties are at the same
  // conceptual level for whoever is searching for a field name.
  if (schema.items) collectProperties(schema.items, depth, seen, out)
  for (const item of schema.tupleItems ?? []) collectProperties(item, depth, seen, out)
  for (const variant of schema.composite?.variants ?? [])
    collectProperties(variant, depth, seen, out)
}

function operationEntry(op, group = null) {
  const names = new Set()
  const seen = new Set()
  for (const param of op.parameters ?? []) {
    names.add(param.name)
    collectProperties(param.schema, 1, seen, names)
  }
  for (const content of op.requestBody?.contents ?? [])
    collectProperties(content.schema, 0, seen, names)
  for (const response of op.responses ?? []) {
    for (const content of response.contents ?? []) collectProperties(content.schema, 0, seen, names)
    for (const header of response.headers ?? []) {
      names.add(header.name)
      collectProperties(header.schema, 1, seen, names)
    }
  }
  const properties = [...names]
  return {
    type: 'op',
    id: op.id,
    title: op.summary || op.path,
    method: op.method,
    path: op.path,
    // The section the nav files it under, null for the fallback group — read
    // from the model's groups rather than re-derived from `op.tags`, which
    // knows neither a 3.2 label tag nor a tag's display `summary`.
    group,
    primary: [op.summary, op.operationId].filter(Boolean).map((f) => String(f).toLowerCase()),
    secondary: [op.path, op.method].map((f) => String(f).toLowerCase()),
    description: String(op.description ?? '').toLowerCase(),
    properties,
    propertiesLower: properties.map((name) => name.toLowerCase()),
  }
}

function pageEntry(page) {
  const title = page.title ?? page.slug
  return {
    type: 'page',
    id: page.slug,
    title,
    group: null,
    primary: [title, page.slug].map((f) => String(f).toLowerCase()),
    secondary: [],
    description: '',
    properties: [],
    propertiesLower: [],
  }
}

// A section of a docs page (docs/docs-pages.md §6): heading in `primary`,
// body text in `description` — the existing field weights already rank a
// heading match above a body match, which is exactly the wanted order.
function pageSectionEntry(section) {
  const title = section.heading || section.pageTitle
  return {
    type: 'page-section',
    // Unique across a page's sections, and never used as a route: the hash is
    // built from `slug` + `anchor`.
    id: `${section.slug}#${section.anchor ?? ''}`,
    slug: section.slug,
    anchor: section.anchor ?? null,
    title,
    // The page a section belongs to, shown as the crumb under the result: a
    // heading alone ("Cursors") does not say which guide it is in.
    group: section.pageTitle,
    primary: [title].map((f) => String(f).toLowerCase()),
    secondary: [],
    description: String(section.text ?? '').toLowerCase(),
    properties: [],
    propertiesLower: [],
  }
}

// A scenario is indexed on its name, its description and its step
// labels (§5.1). Config scenarios not yet loaded only have their
// declared title: the index is rebuilt when the rest arrives.
function scenarioEntry(scenario) {
  const title = scenario.title ?? scenario.id
  return {
    type: 'scenario',
    id: scenario.id,
    title,
    group: null,
    primary: [title].map((f) => String(f).toLowerCase()),
    secondary: (scenario.stepTitles ?? []).map((f) => String(f).toLowerCase()),
    description: String(scenario.description ?? '').toLowerCase(),
    properties: [],
    propertiesLower: [],
  }
}

// `sections` arrives late and empty at first: the content index is built on
// the palette's first open (§6), so a session that never searches never
// fetches a page it did not display.
export function buildSearchIndex(model, pages = [], scenarios = [], sections = []) {
  // The first group an operation appears in, exactly as the nav files it: a
  // multi-tag operation has one position, the first one encountered.
  const groupOf = new Map()
  for (const group of model.groups) {
    for (const id of group.operationIds) {
      if (!groupOf.has(id)) groupOf.set(id, group.summary ?? group.tag ?? null)
    }
  }
  return [
    ...pages.map(pageEntry),
    ...sections.map(pageSectionEntry),
    ...scenarios.map(scenarioEntry),
    ...model.operations.map((op) => operationEntry(op, groupOf.get(op.id) ?? null)),
    // Same indexing as an operation (the webhook has its shape), distinct
    // type for the group label in the palette.
    ...(model.webhooks ?? []).map((webhook) => ({ ...operationEntry(webhook), type: 'webhook' })),
  ]
}

// Weight per field: a match in the name (summary/operationId/page title)
// is worth more than a match in the path or method, which is worth more than a
// property name, which is worth more than a description word.
const SCORE_PRIMARY_PREFIX = 120
const SCORE_PRIMARY = 100
const SCORE_SECONDARY = 70
const SCORE_PROPERTY = 40
const SCORE_DESCRIPTION = 15

// Space-separated tokens, all required (AND). Returns entries ranked
// by descending score, with the property names that justified the match
// (only when the token didn't already match a primary field — no point
// explaining an obvious result).
export function searchIndex(entries, query, limit = 20) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return []

  const results = []
  for (const entry of entries) {
    let score = 0
    const matchedProperties = new Set()
    let allTokensMatch = true
    for (const token of tokens) {
      let tokenScore = 0
      if (entry.primary.some((field) => field.startsWith(token))) tokenScore = SCORE_PRIMARY_PREFIX
      else if (entry.primary.some((field) => field.includes(token))) tokenScore = SCORE_PRIMARY
      else if (entry.secondary.some((field) => field.includes(token))) tokenScore = SCORE_SECONDARY
      else {
        for (let i = 0; i < entry.propertiesLower.length; i += 1) {
          if (entry.propertiesLower[i].includes(token)) {
            tokenScore = SCORE_PROPERTY
            matchedProperties.add(entry.properties[i])
          }
        }
        if (!tokenScore && entry.description.includes(token)) tokenScore = SCORE_DESCRIPTION
      }
      if (!tokenScore) {
        allTokensMatch = false
        break
      }
      score += tokenScore
    }
    if (!allTokensMatch) continue
    results.push({
      // The index entry that produced this result. What the palette's
      // incremental narrowing feeds back as the next keystroke's pool: with
      // AND semantics, extending the query can only shrink the match set.
      entry,
      type: entry.type,
      id: entry.id,
      title: entry.title,
      method: entry.method,
      path: entry.path,
      group: entry.group,
      // Docs sections only: the page they live in and the heading to land on.
      slug: entry.slug,
      anchor: entry.anchor,
      score,
      matchedProperties: [...matchedProperties],
    })
  }
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return results.slice(0, limit)
}
