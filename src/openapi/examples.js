// How a normalized example is meant to be read (`model.js` `normalizeExamples`).
// Kept out of the components because all four surfaces that show an example —
// the doc's example block, the try-it's body pre-fill, the response viewer and
// the Markdown export — have to agree, and each of them used to decide for
// itself with `typeof value === 'string'`. That guess is wrong in both
// directions: it renders an `externalValue` URL as though it were the payload,
// and it strips the quotes off a `dataValue` that is legitimately a string,
// pre-filling a JSON body with something that is no longer JSON.

// A URL pointing AT the example, not the example. Nothing may show it as a
// payload, and nothing may pre-fill an editor with it: the file lives on
// someone else's server and this app does not fetch it (rule 5 — and a
// documentation page that fetches whatever a schema names is a request forgery
// surface). It is shown as the link it is.
export function isExternalExample(example) {
  return example?.kind === 'external'
}

// Text to show exactly as written: 3.2's `serializedValue`, and 3.0/3.1's
// single `value` when it happens to be a string — there the type really is all
// the document ever said.
export function isSerializedExample(example) {
  if (!example) return false
  if (example.kind) return example.kind === 'serialized'
  return typeof example.value === 'string'
}

// → { text, json } for an example that can be displayed inline, or null for one
// that cannot (external, or carrying no value at all). `json` says whether the
// text may be highlighted as JSON — never guessed from the string itself,
// because hljs auto-detection colours arbitrary prose at random.
export function exampleText(example) {
  if (!example || example.value === undefined || isExternalExample(example)) return null
  if (isSerializedExample(example)) return { text: String(example.value), json: false }
  return { text: JSON.stringify(example.value, null, 2), json: true }
}

// The first example a surface can actually render, skipping the external ones.
export function displayableExample(examples) {
  return examples?.find((example) => exampleText(example) !== null) ?? null
}
