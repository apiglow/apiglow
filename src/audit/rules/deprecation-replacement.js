import { deprecableElements, isDeprecated } from '../deprecated.js'
import { hasText } from '../text.js'

// A deprecation that says nothing is a dead end: the reader learns the thing is
// going away and not what to do about it. Only the deprecated elements are
// checked here — the rest is the inventory rule's business.
//
// The heuristic is deliberately loose. It catches the flag set and then
// forgotten, not the badly worded migration note: any hint of "there is a
// successor" or "there is a date" passes. Both languages the product ships in
// are covered, since the schema's prose is the author's, not ours.
const HINT_RE =
  /(instead|replac|superseded|migrat|prefer|sunset|remov|will be dropped|utilis|remplac|à la place|préfér|supprim)/i

// `sunset` as a field (or the `x-sunset` extension) is the machine-readable
// half of the same information: a date is an answer.
const SUNSET_FIELDS = ['sunset', 'x-sunset']

export const deprecationReplacement = {
  id: 'deprecation-replacement',
  category: 'deprecation',
  severity: 'warning',
  run(ctx, check) {
    for (const { node, target } of deprecableElements(ctx)) {
      if (!isDeprecated(node)) continue
      const prose = [node.description, node.summary].filter(hasText).join(' ')
      const dated = SUNSET_FIELDS.some((field) => node[field] !== undefined)
      check(dated || HINT_RE.test(prose), target)
    }
  },
}
