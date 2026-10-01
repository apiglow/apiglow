import { hasText, isSubstantive } from '../text.js'

// An operation with a description but no summary worth the name. This
// documentation names an operation by its summary — the navigation entry, the
// page heading — and falls back to the path (`/pets/{petId}`), the tab title
// to `GET /pets/{petId}`, the pager to a bare "Next"; a webhook falls back to
// its name the same way. With no summary, every endpoint of the navigation reads as a URL, and
// the sentence that would have named it sits unread in the description. A
// placeholder summary (`TODO`) is printed as the name all the same.
//
// Operations and webhooks; callbacks have no navigation entry and no page of
// their own. With neither a summary nor a description the operation is
// `operation-described`'s, and has no check here. One check per operation
// with a substantive description.
export const operationSummaryPresent = {
  id: 'operation-summary-present',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      if (entry.kind === 'callback') continue
      const { summary, description } = entry.op
      if (!isSubstantive(description)) continue
      check(isSubstantive(summary), {
        op: entry,
        dataPath: `${entry.pointer}/summary`,
        params: { label: hasText(summary) ? summary : entry.path },
      })
    }
  },
}
