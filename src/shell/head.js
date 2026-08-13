// What the app writes into `<head>` for the route it is showing
// (docs/seo.md §3): title, meta description and JSON-LD. `headFor` is a pure
// derivation over the normalized model and is unit-tested; `applyHead` is the
// only thing here that touches the document.
//
// Two deliberate absences. No canonical link: under hash routing every route
// shares one server URL, so a per-route canonical would be a lie and a static
// one is the host page's business — canonicals belong to the baked snapshots.
// And the host's original `<title>` is never restored: once booted, the app
// owns the title, because a half-owned one flickers between two names.
import { docsPageBody } from '../export/docs-page-markdown.js'
import { t } from '../i18n/index.js'

// Search engines cut the snippet around there; past it the tail is written for
// nobody.
const MAX_DESCRIPTION = 160

const JSON_LD_ID = 'apidoc-jsonld'

function oneLine(value) {
  return String(value ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

// Markdown reduced to the prose it renders to. A meta description is plain
// text: syntax left in it reads as noise in a search result, and a stray `<`
// would be markup in the wrong document.
function plainText(source) {
  return oneLine(
    String(source ?? '')
      .replaceAll(/```[\s\S]*?```/g, ' ')
      .replaceAll(/`([^`]*)`/g, '$1')
      .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/^[^\S\n]{0,3}#{1,6}[^\S\n]+/gm, '')
      .replaceAll(/^[^\S\n]{0,3}>[^\S\n]?/gm, '')
      .replaceAll(/^[^\S\n]{0,3}[-*+][^\S\n]+/gm, '')
      .replaceAll(/[*_~]/g, ''),
  )
}

// A period ends a sentence only when what follows opens one: "e.g. the id" and
// "version 1.2" are not boundaries, and cutting there produces a description
// that stops mid-thought.
function firstSentence(source) {
  const plain = plainText(source)
  const match = /^.*?[.!?](?=\s+[A-Z0-9“"'(])/s.exec(plain)
  return match ? match[0] : plain
}

// The first block of prose of a page body: its own title heading is already
// the page title, and repeating it as the description says nothing new.
function leadParagraph(source) {
  for (const block of String(source ?? '').split(/\n\s*\n/)) {
    const trimmed = block.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue
    const plain = plainText(trimmed)
    if (plain) return plain
  }
  return ''
}

// Cut on a word boundary: a truncated word reads as corruption rather than as
// a summary that ran long.
function clamp(text) {
  if (text.length <= MAX_DESCRIPTION) return text
  const cut = text.slice(0, MAX_DESCRIPTION - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

// The route's own name, before the API title is appended. A route whose target
// did not resolve (unknown operation id, missing page) names nothing: the
// document is left with the bare API title, which is what the reader sees.
function viewName(view) {
  switch (view?.type) {
    case 'op':
      return view.op
        ? oneLine(view.op.summary) || `${view.op.method.toUpperCase()} ${view.op.path}`
        : ''
    case 'page':
      return view.page ? oneLine(view.page.title) : ''
    case 'audit':
      return t('audit.title')
    case 'overview':
      return t('nav.overview')
    case 'first-call':
      return t('firstCall.title')
    // A scenario names itself once its document is in hand — the app resolves
    // it asynchronously, the bake holds it already. Until then, and for an
    // imported one that is nobody's page, the section is what the route is.
    case 'scenario':
      return oneLine(view.title || view.scenario?.name) || t('nav.scenariosSection')
    case 'scenario-import':
      return t('nav.scenariosSection')
    default:
      return ''
  }
}

// The summary is already the title: the description is the prose underneath
// it, and falls back to the document's own when the route has none of its own.
function viewDescription(view, info) {
  const documentLevel = () => plainText(info.summary) || firstSentence(info.description)
  if (view?.type === 'op' && view.op) {
    return firstSentence(view.op.description) || plainText(view.op.summary) || documentLevel()
  }
  if (view?.type === 'page' && view.page) {
    // The body arrives asynchronously (§3): until then the page contributes no
    // description of its own and the document's stands in.
    return (view.text ? leadParagraph(docsPageBody(view.text, view.format)) : '') || documentLevel()
  }
  if (view?.type === 'scenario' && view.scenario) {
    return firstSentence(view.scenario.description) || documentLevel()
  }
  return documentLevel()
}

// Semantically correct, speculative payoff, near-zero cost — and the same
// objects the baked snapshots reuse. The tool views (audit, scenarios, first
// call) describe no indexable content, so they declare nothing rather than
// claim a type they do not have.
function viewJsonLd(view, info, { name, description }) {
  const apiTitle = oneLine(info.title)
  const described = description ? { description } : {}
  if (view?.type === 'op' && view.op) {
    return {
      '@context': 'https://schema.org',
      '@type': 'APIReference',
      name,
      ...described,
      identifier: view.op.id,
      ...(info.version ? { assemblyVersion: oneLine(info.version) } : {}),
      ...(apiTitle ? { isPartOf: { '@type': 'WebAPI', name: apiTitle } } : {}),
    }
  }
  // A workflow reads as a tutorial — a sequence of calls with a goal — which is
  // the same kind of article as a prose page and is typed like one.
  if ((view?.type === 'page' && view.page) || (view?.type === 'scenario' && view.scenario)) {
    return {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: name,
      ...described,
      ...(apiTitle ? { isPartOf: { '@type': 'WebSite', name: apiTitle } } : {}),
    }
  }
  if ((view?.type === null || view?.type === undefined || view?.type === 'overview') && apiTitle) {
    return { '@context': 'https://schema.org', '@type': 'WebSite', name: apiTitle, ...described }
  }
  return null
}

// → { title, description, jsonLd } for a view: the route type plus whatever it
// resolved to (`op`, `page` with its loaded `text`/`format`, or `scenario` with
// the `title` under which it is listed).
export function headFor(view, model) {
  const info = model?.info ?? {}
  const apiTitle = oneLine(info.title)
  const name = viewName(view)
  const description = clamp(viewDescription(view, info))
  return {
    // The API title alone on home, and never twice when a route happens to
    // carry the same name.
    title: [name, name === apiTitle ? '' : apiTitle].filter(Boolean).join(' — '),
    description,
    jsonLd: viewJsonLd(view, info, { name: name || apiTitle, description }),
  }
}

function setDescription(content) {
  let tag = document.head.querySelector('meta[name="description"]')
  if (!content) {
    // A description the host wrote and we never overwrote stays: only ours is
    // ours to drop.
    if (tag?.dataset.apidoc) tag.remove()
    return
  }
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'description'
    document.head.append(tag)
  }
  tag.dataset.apidoc = 'head'
  tag.content = content
}

function setJsonLd(data) {
  const existing = document.getElementById(JSON_LD_ID)
  if (!data) {
    existing?.remove()
    return
  }
  const script = existing ?? document.createElement('script')
  if (!existing) {
    script.id = JSON_LD_ID
    script.type = 'application/ld+json'
    document.head.append(script)
  }
  // `<` only ever occurs inside a JSON string, and a schema description
  // containing `</script>` would otherwise close this element from the inside.
  script.textContent = JSON.stringify(data).replaceAll('<', '\\u003c')
}

// `seo: { index: false }` (docs/seo.md §2): the installation is publicly
// reachable but not meant to be found. Written once at boot, not per route —
// the value cannot change without a reload, and the flag is a request to
// crawlers, never a protection: what must not be read needs an auth wall.
export function applyNoIndex() {
  const tag = document.createElement('meta')
  tag.name = 'robots'
  tag.content = 'noindex'
  document.head.append(tag)
}

export function applyHead({ title, description, jsonLd }) {
  // An empty title would leave the tab nameless: the host's stands instead.
  if (title) document.title = title
  setDescription(description)
  setJsonLd(jsonLd)
}
