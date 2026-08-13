import { templatizeEntry } from '../export/redact.js'
import { templatizeState } from '../export/share.js'
import { extractPathValues, extractQueryValues } from '../openapi/request-builder.js'
import { normalizeRequest } from './model.js'

// Capture of a scenario step (docs/scenarios.md §5.4) — pure functions.
//
// Two sources, a single result: the TEMPLATE shape of the request, the same
// as the try-it panel's. No known sensitive value comes out of it — it's
// the same guarantee (and the same mechanism) as the share link.

// From the editor: the state is already in template form, except for what
// the user has pasted into it in the clear — the values of sensitive
// environment variables are re-templatized.
export function stepRequestFromState(state, sensitiveVariables = []) {
  return normalizeRequest(templatizeState(state, sensitiveVariables))
}

// From a history entry: the request there is RESOLVED (values substituted).
// `usedVariables` allows retracing the reverse path, variable by variable —
// same mechanism as the "template" export.
export function stepRequestFromEntry(entry, op) {
  const templated = templatizeEntry(entry)
  const url = templated.request?.url ?? ''
  const headers = templated.request?.headers ?? {}
  return normalizeRequest({
    path: extractPathValues(op.path, url),
    // Unparseable URL: the step is captured without a query rather than
    // not at all.
    query: extractQueryValues(url, op) ?? {},
    headers: (Array.isArray(headers) ? headers : Object.entries(headers)).map(([name, value]) => ({
      name,
      value,
    })),
    body: templated.request?.body ?? null,
    // The media type isn't stored in the entry: the step starts over from
    // the first declared content, like a freshly opened panel.
    mediaTypeIndex: 0,
  })
}
