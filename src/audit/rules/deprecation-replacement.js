import { deprecableElements, isDeprecated } from '../deprecated.js'
import { headerExamples } from '../deprecation-headers.js'
import { hasText } from '../text.js'
import { isObject } from '../value-check.js'

// A deprecation that says nothing is a dead end: the reader learns the thing is
// going away and not what to do about it. Only the deprecated elements are
// checked.
//
// The heuristic is deliberately loose. It catches the flag set and then
// forgotten, not the badly worded migration note: any word pointing to a
// successor, or a date, passes. Both languages the product ships in are
// covered, since the schema's prose is the author's, not ours. Whole words
// only — "Removes a pet" or "utilisateurs" name no successor — and bounded by
// letters rather than `\b`, which takes `é` and `à` for word breaks.
const HINT_RE =
  /(?<![\p{L}\p{N}])(use|instead|replaced|replacement|superseded|successor|migrat\p{L}*|sunset|prefer|in favou?r of|utilisez|utiliser|remplacée?s?|remplaçant|successeur|migrer|préférez|privilégiez|au profit|à la place)(?![\p{L}\p{N}])/iu
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/

// `sunset` as a field (or the `x-sunset` extension) is the machine-readable
// half of the same information: a date is an answer.
const SUNSET_FIELDS = ['sunset', 'x-sunset']

// An operation can also answer on the wire, in the headers its responses
// declare (any status): `Sunset` (RFC 8594) carries the removal date,
// `Deprecation` (RFC 9745) the deprecation's, and a `Link` header naming one
// of the relations that point somewhere — `successor-version`,
// `latest-version` (RFC 5829), `deprecation` (RFC 9745), `sunset` (RFC 8594) —
// in its description or its examples. A client reads those from every
// response, which is where the answer is most useful.
const DATE_HEADERS = new Set(['sunset', 'deprecation'])
const LINK_RELATION_RE = /\b(successor-version|latest-version|deprecation|sunset)\b/i

export const deprecationReplacement = {
  id: 'deprecation-replacement',
  category: 'deprecation',
  severity: 'warning',
  run(ctx, check) {
    for (const { node, target } of deprecableElements(ctx)) {
      if (!isDeprecated(node)) continue
      const prose = [node.description, node.summary].filter(hasText).join(' ')
      const dated = SUNSET_FIELDS.some((field) => node[field] !== undefined)
      const announced = node === target.op?.op && answersOnTheWire(node)
      check(dated || announced || HINT_RE.test(prose) || DATE_RE.test(prose), target)
    }
  },
}

function answersOnTheWire(operation) {
  const responses = isObject(operation.responses) ? operation.responses : {}
  for (const response of Object.values(responses)) {
    if (!isObject(response) || !isObject(response.headers)) continue
    for (const [name, header] of Object.entries(response.headers)) {
      const key = name.toLowerCase()
      if (DATE_HEADERS.has(key)) return true
      if (key !== 'link' || !isObject(header)) continue
      const texts = [header.description, ...headerExamples(header)]
      if (texts.some((text) => typeof text === 'string' && LINK_RELATION_RE.test(text))) {
        return true
      }
    }
  }
  return false
}
