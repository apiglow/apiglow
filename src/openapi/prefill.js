// Starting values of a request's parameters: what the schema itself DECLARES
// the value to be, never an invented sample (sample.js). A first Try It that
// works without typing is the whole point (docs/architecture.md §5.5.7), and a
// fabricated `"string"` sent to a real API is worse than an empty field —
// it looks like a value and answers 400.
//
// Only REQUIRED parameters are pre-filled. On an optional query parameter the
// old rule still holds: sending an explicit default is not the same request as
// leaving the choice to the server. A required one has no such reading — the
// server needs it either way.

import { coerceDeep } from './coerce.js'
import { isMultiValue, isObjectValue } from './params.js'

// Declared value of one parameter, or undefined. Precedence is the model's
// own: `examples` already folds the parameter's `example`/`examples` and the
// schema's (model.js), so what remains here is example-before-default.
export function paramPrefill(param) {
  if (!param?.required) return undefined
  // Array and object parameters edit through their own multi-row widgets; a
  // single string would be a different value than the one they'd produce.
  if (isMultiValue(param) || isObjectValue(param)) return undefined
  const declared = param.examples?.length ? param.examples[0].value : param.schema?.default
  if (declared === undefined) return undefined
  // `example: "20.51"` on a numeric schema describes 20.51: the shape follows
  // the declared type before it becomes editor text (coerce.js).
  const value = coerceDeep(declared, param.schema)
  if (value === null || typeof value === 'object') return undefined
  return String(value)
}

// { [name]: value } for one location, empty when nothing is declared.
export function prefilledValues(op, location) {
  const out = {}
  for (const param of op?.parameters ?? []) {
    if (param.in !== location) continue
    const value = paramPrefill(param)
    if (value !== undefined) out[param.name] = value
  }
  return out
}
