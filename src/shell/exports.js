// The two LLM-facing exports of the whole documentation. Both need a base URL
// resolved at call time — the selected environment can change between the
// moment the buttons are built and the moment one is pressed — hence
// `baseUrl` as a callback rather than a value.
import { docsPageBody } from '../export/docs-page-markdown.js'
import { toLlmsFullText } from '../export/llms-full.js'
import { toLlmsText } from '../export/llms.js'
import { publishedScenarios } from '../scenarios/loader.js'
import { loadDocsPageTexts } from './docs.js'

// An entry declared by `url` is downloaded through the shared cache, so a
// scenario the reader already opened is not fetched again.
async function exportedScenarios({ scenarios = [], ops = [], fetchText }) {
  const published = await publishedScenarios(scenarios, { ops, fetchText })
  return published.map((entry) => ({
    ...entry,
    // The one recipe link that survives without a bake: an Arazzo document
    // declared by `url` is already served by the host at the address the
    // config states. Declared by `document`, or written in our envelope, there
    // is nothing published to point at (§3.2).
    recipeUrl: entry.arazzo ? entry.url : '',
  }))
}

// "llms-full.txt" (entire doc for an LLM): info + docs pages + workflows + all
// operations. Pages and scenarios are downloaded on demand, an unreachable one
// omitted rather than blocking the export.
export function llmsFullExporter({
  model,
  pages,
  scenarios,
  ops,
  fetchText,
  baseUrl,
  specUrl = '',
}) {
  return async () => {
    // The same body the "Copy page" menu hands over: `.txt` as-is, an `.html`
    // page flattened to its text (an LLM has no use for the markup), a `.md`
    // page without the frontmatter the render drops too.
    const [texts, workflows] = await Promise.all([
      loadDocsPageTexts(pages),
      exportedScenarios({ scenarios, ops, fetchText }),
    ])
    const contents = texts.map(({ page, text, format }) => ({
      slug: page.slug,
      title: page.title,
      content: docsPageBody(text, format),
    }))
    return toLlmsFullText(model, {
      baseUrl: baseUrl(),
      pages: contents,
      scenarios: workflows,
      specUrl,
    })
  }
}

// "llms.txt" (llmstxt.org): the index of the same documentation. It links to
// the pages instead of inlining them, so unlike llms-full it downloads nothing
// for them — but a workflow line states how many steps and inputs the scenario
// has, which only the loaded document says. `outline` carries the nav
// arrangement: group titles become sections, external links join `## Optional`.
export function llmsTextExporter({
  model,
  outline,
  docsUrl,
  specUrl,
  baseUrl,
  overlays = 0,
  scenarios,
  ops,
  fetchText,
}) {
  return async () =>
    toLlmsText(model, {
      docsUrl,
      baseUrl: baseUrl(),
      specUrl,
      outline,
      overlays,
      scenarios: await exportedScenarios({ scenarios, ops, fetchText }),
    })
}
