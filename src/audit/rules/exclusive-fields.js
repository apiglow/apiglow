import { placeOf } from '../locate.js'
import { objectLabel } from '../openapi-objects.js'
import { pointer } from '../pointer.js'

// Two fields the specification makes mutually exclusive, both set. The
// document then says two things where one is allowed, and which one a tool
// keeps is not defined: this documentation shows the `examples` map over a
// single `example`, an Example's `value` over its `externalValue`, a
// licence's SPDX `identifier` over its `url` — another tool may keep the other
// one, and the reader of a generated client and of this page no longer see the
// same thing.
//
// The pairs, each a MUST of the version that has both fields: a Parameter's,
// Header's or Media Type's `example` and `examples`; an Example's `value` and
// `externalValue`, and from 3.2 `dataValue` with `value`, `externalValue` with
// `serializedValue`; a Link's `operationRef` and `operationId`; a License's
// `identifier` and `url` (3.1+, where `identifier` exists). One check per pair
// found together.
const PAIRS = {
  Parameter: [['example', 'examples']],
  Header: [['example', 'examples']],
  MediaType: [['example', 'examples']],
  Example: [
    ['value', 'externalValue'],
    ['dataValue', 'value', 2],
    ['serializedValue', 'externalValue', 2],
  ],
  Link: [['operationRef', 'operationId']],
  License: [['identifier', 'url', 1]],
}

export const exclusiveFields = {
  id: 'exclusive-fields',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    for (const { type, node, dataPath } of ctx.objects) {
      for (const [first, second, since = 0] of PAIRS[type] ?? []) {
        if (minor < since || node[first] === undefined || node[second] === undefined) continue
        const at = `${dataPath}${pointer(second)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { first, second, object: objectLabel(type) },
        })
      }
    }
  },
}
