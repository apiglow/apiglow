// `sitemap.xml` for a baked install (docs/seo.md §4). It lists the HTML
// snapshots and only them: they are the indexable form, where the `.md`
// mirrors are written for agents and are reached through `llms.txt`.
//
// This file is the only list of URLs a crawler can discover at all — the app's
// own routes live in a fragment, which never reaches a server and which Google
// treats as one URL whatever follows the `#`.
//
// No `<lastmod>`: the generator is pure and has no clock, and a date read off
// the bake machine would say when the file was written rather than when the
// documentation changed — the one thing the tag is meant to tell a crawler.

import { bakedUrl } from './site-layout.js'

const XML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

function escapeXml(value) {
  return String(value ?? '').replaceAll(/[&<>"']/g, (char) => XML_ESCAPE[char])
}

// One spec's pages, in the order the nav arranges them: the welcome view, the
// prose, the workflows, then the reference. A sitemap carries no order of its
// own, but the file is read by people too when something is missing from it.
function specTargets({ specId = '', model, pages = [], scenarios = [] }) {
  return [
    { kind: 'overview', specId },
    ...pages.map((page) => ({ kind: 'page', id: page.slug, specId })),
    ...scenarios.map((entry) => ({ kind: 'scenario', id: entry.id, specId })),
    ...(model?.operations ?? []).map((op) => ({ kind: 'op', id: op.id, specId })),
    ...(model?.webhooks ?? []).map((webhook) => ({ kind: 'op', id: webhook.id, specId })),
  ]
}

// `sources`: one entry per spec — { specId, model, pages, scenarios }. A
// mono-spec install passes a single entry with no `specId`; a multi-spec one
// passes them all, because the root sitemap covers the whole site and a
// crawler is given one file to find, not one per spec.
export function toSitemap(sources, { siteUrl = '' } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
  for (const source of sources ?? []) {
    for (const target of specTargets(source)) {
      lines.push(`  <url><loc>${escapeXml(bakedUrl(siteUrl, target))}</loc></url>`)
    }
  }
  lines.push('</urlset>')
  return `${lines.join('\n')}\n`
}
