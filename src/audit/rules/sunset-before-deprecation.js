import {
  documentResponses,
  headerExamples,
  parseImfFixdate,
  parseStructuredDate,
} from '../deprecation-headers.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A response whose examples remove the thing before deprecating it. RFC 9745
// §4: "The timestamp given in the Sunset HTTP header field MUST NOT be earlier
// than the one given in the Deprecation header field." Graded by that MUST
// NOT: the two examples contradict each other, and whichever is wrong, a
// client reading the document learns a timeline no server may send — the
// removal date before the warning date.
//
// Only what can be compared is checked: a Response declaring both headers
// (names without case), each with an example that parses — a `Deprecation`
// Structured Field Date (`@1688169599`, RFC 9651 §3.3.7), a `Sunset`
// IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`, RFC 8594 §3 and RFC 9110
// §5.6.7). The first parsing example of each counts. One check per such
// Response, a `components.responses` entry once; the finding on its `Sunset`
// header. A `Deprecation` example that does not parse is
// `deprecation-header-format`'s; a `Sunset` one, `http-date-headers'`.
export const sunsetBeforeDeprecation = {
  id: 'sunset-before-deprecation',
  category: 'deprecation',
  severity: 'error',
  run(ctx, check) {
    for (const { dataPath, headers } of documentResponses(ctx)) {
      const deprecation = headers.get('deprecation')
      const sunset = headers.get('sunset')
      if (!deprecation || !sunset) continue
      const deprecated = firstParsed(deprecation.header, parseStructuredDate)
      const removed = firstParsed(sunset.header, parseImfFixdate)
      if (!deprecated || !removed) continue
      const at = `${dataPath}${pointer('headers', sunset.key)}`
      check(removed.time >= deprecated.time, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: { sunset: removed.value, deprecation: deprecated.value },
      })
    }
  },
}

function firstParsed(header, parse) {
  for (const value of headerExamples(header)) {
    const time = parse(value)
    if (time !== null) return { value, time }
  }
  return null
}
