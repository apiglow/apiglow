import { CI_PLATFORMS, CI_RUNNERS, toCiSnippet } from '../export/ci.js'
import { t } from '../i18n/index.js'
import { slugify } from '../openapi/model.js'
import { el, externalLink, selectField, text } from './dom.js'
import {
  setWarnings,
  takeAwayDownload,
  takeAwayPanel,
  takeAwaySource,
  warningList,
} from './take-away-panel.js'

// "Automate this scenario" (docs/scenario-handoff.md §4): the CI job that runs
// this workflow on a schedule, next to the export menu on the scenario page.
// The shell — collapsed, the job shown rather than only copied, what the runner
// would ignore above it, the variables it needs below it as names — is shared
// with the other take-away panels and lives in `take-away-panel.js`.
//
// No document, no panel: an install whose schema is not published has nothing a
// runner could fetch, so there is nothing to be right about (§2).

const WARNING_KEYS = {
  version: 'ci.warn.version',
  versionUnstated: 'ci.warn.versionUnstated',
  construct: 'ci.warn.construct',
  workflowGuessed: 'ci.warn.workflowGuessed',
  authored: 'ci.warn.authored',
}

// `state` / `onState`: the scenario view re-renders whole on every write, and
// this panel is rebuilt with it. Its open state and the two selections live in
// the view so a run landing its results does not close the panel under the
// reader's fingers, nor send them back to the first runner.
export function ciPanel({
  document: recipe,
  name = '',
  scenarioId = '',
  url = '',
  authored = false,
  state = {},
  onState = () => {},
}) {
  if (!recipe) return null

  const runner = selectField({
    id: 'ci-runner-select',
    label: t('ci.runner'),
    options: CI_RUNNERS.map((entry) => ({ value: entry.id, label: entry.name })),
    value: state.runnerId ?? CI_RUNNERS[0].id,
    onChange: (value) => {
      onState({ runnerId: value })
      refresh()
    },
  })
  const platform = selectField({
    id: 'ci-platform-select',
    label: t('ci.platform'),
    options: CI_PLATFORMS.map((value) => ({ value, label: t(`ci.platform.${value}`) })),
    value: state.platform ?? CI_PLATFORMS[0],
    onChange: (value) => {
      onState({ platform: value })
      refresh()
    },
  })

  // Href and label are the selected runner's, set by the first `refresh()`.
  const docsLink = externalLink('link link-hover text-xs text-subtle', '')
  const warnings = warningList()
  const source = el('p', 'text-sm')
  const secrets = el('p', 'text-sm')
  secrets.dataset.ciSecrets = ''
  let snippet = ''
  const block = takeAwaySource(() => snippet, t('ci.copy'), 'block whitespace-pre')

  const download = takeAwayDownload(t('ci.download'), () => ({
    filename: `${slugify(name) || 'scenario'}.arazzo.json`,
    content: `${JSON.stringify(recipe, null, 2)}\n`,
  }))
  download.dataset.ciDownload = ''

  function refresh() {
    const runnerId = runner.select.value
    const result = toCiSnippet(recipe, {
      runnerId,
      platform: platform.select.value,
      name,
      scenarioId,
      url,
      authored,
    })
    snippet = result.snippet
    // A YAML job built from ids and a URL: a text node rather than markup, so
    // there is nothing to sanitize and nothing that could carry any (rule 5).
    block.code.replaceChildren(text(snippet))
    const selected = CI_RUNNERS.find((entry) => entry.id === runnerId) ?? CI_RUNNERS[0]
    docsLink.href = selected.docs
    docsLink.replaceChildren(text(t('ci.docs', { runner: selected.name })))
    source.replaceChildren(
      text(
        url
          ? t('ci.source.served', { url })
          : t('ci.source.commit', { path: result.documentPath, file: result.file }),
      ),
    )
    secrets.replaceChildren(
      text(
        result.secrets.length
          ? t('ci.secrets', { names: result.secrets.map(({ env }) => env).join(', ') })
          : t('ci.secrets.none'),
      ),
    )
    setWarnings(
      warnings,
      result.warnings.map((warning) =>
        t(WARNING_KEYS[warning.code], {
          ...warning,
          construct: warning.construct ? t(`ci.construct.${warning.construct}`) : '',
        }),
      ),
    )
  }
  refresh()

  const panel = takeAwayPanel(
    { title: t('ci.title'), intro: t('ci.intro'), state, onState },
    el('div', 'flex flex-wrap gap-3', runner.node, platform.node),
    docsLink,
    source,
    warnings,
    block.node,
    secrets,
    el('div', 'flex flex-wrap items-center gap-2', download),
    el('p', 'text-xs text-subtle', text(t('ci.note'))),
  )
  panel.dataset.ciPanel = ''
  return panel
}
