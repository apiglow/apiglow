// Which operation a newcomer should call first (docs/architecture.md §5.5.7).
// Pure and deterministic: the generated onboarding page must show the same
// endpoint on every load, and the choice must be explainable.
//
// A read is the only safe suggestion — the reader is invited to press Send on
// it sight unseen, so nothing here may create, modify or delete anything.

import { paramPrefill } from './prefill.js'

// How much typing stands between the reader and their first response. Lower
// wins; ties keep schema order, which is the author's own ordering.
function cost(op) {
  const required = op.parameters.filter((p) => p.required)
  const toType = required.filter((p) => paramPrefill(p) === undefined)
  return [toType.length, required.length]
}

export function pickFirstCallOperation(model) {
  const candidates = (model?.operations ?? []).filter(
    (op) => op.method === 'get' && !op.requestBody && !op.deprecated,
  )
  let best = null
  let bestCost = null
  for (const op of candidates) {
    const current = cost(op)
    if (
      !best ||
      current[0] < bestCost[0] ||
      (current[0] === bestCost[0] && current[1] < bestCost[1])
    ) {
      best = op
      bestCost = current
    }
  }
  return best
}
