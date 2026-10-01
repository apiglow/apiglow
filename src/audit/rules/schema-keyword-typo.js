import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { lastToken } from '../ref-pointer.js'
import { SCHEMA_KEYWORDS } from '../schema-keywords.js'

// A schema key that is no keyword in any OpenAPI version, but a near miss of
// one: `descripton`, `maxLenght`, `readonly`, `additionalproperties`. JSON
// Schema ignores unknown keywords — 3.1 even allows them — so the constraint or
// the annotation silently does nothing: no validator enforces the length, no
// generator marks the field read-only, and this documentation shows neither.
// Also `required: true` on a property schema, the draft-03 and Swagger 1.2
// habit: from draft-04 on, `required` is the parent's list of names, and the
// property stays optional everywhere.
//
// Near miss: the same keyword in another case, or one edit away (a letter
// added, dropped, changed, or two swapped) for keys of five letters or more —
// short keys are too close to everything to guess at. Read on the SOURCE
// schemas (`ctx.objects`), so each is reported where it is written. One check
// per near miss, none otherwise.

const BY_LOWER = new Map([...SCHEMA_KEYWORDS].map((keyword) => [keyword.toLowerCase(), keyword]))

export const schemaKeywordTypo = {
  id: 'schema-keyword-typo',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Schema') continue
      const report = (key, written, suggestion) => {
        const at = `${dataPath}${pointer(key)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { written, suggestion },
        })
      }
      for (const key of Object.keys(node)) {
        if (SCHEMA_KEYWORDS.has(key) || key.startsWith('x-')) continue
        const suggestion = nearestKeyword(key)
        if (suggestion) report(key, key, suggestion)
      }
      if (typeof node.required === 'boolean') {
        const name = propertyName(dataPath)
        report(
          'required',
          `required: ${node.required}`,
          `required: [${JSON.stringify(name ?? '…')}]`,
        )
      }
    }
  },
}

function nearestKeyword(key) {
  const sameLetters = BY_LOWER.get(key.toLowerCase())
  if (sameLetters) return sameLetters
  if (key.length < 5) return null
  for (const keyword of SCHEMA_KEYWORDS) {
    if (keyword.length >= 5 && oneEditAway(key, keyword)) return keyword
  }
  return null
}

// Optimal string alignment distance ≤ 1: one insertion, deletion, substitution
// or transposition of adjacent letters.
function oneEditAway(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff = [...a].flatMap((char, i) => (char === b[i] ? [] : [i]))
    if (diff.length === 1) return true
    return (
      diff.length === 2 &&
      diff[1] === diff[0] + 1 &&
      a[diff[0]] === b[diff[1]] &&
      a[diff[1]] === b[diff[0]]
    )
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  return short.slice(i) === long.slice(i + 1)
}

// `…/properties/petId` → `petId`: the name the parent's `required` should list.
function propertyName(dataPath) {
  if (dataPath.split('/').at(-2) !== 'properties') return null
  return lastToken(dataPath)
}
