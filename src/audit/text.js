// A prose field counts as present only when it carries something: `description:
// ""` documents exactly as much as no description at all, and a rule reading it
// with a bare `!== undefined` would hand out a free pass for it.
export function hasText(value) {
  return typeof value === 'string' && Boolean(value.trim())
}

// What the `*-described` rules accept as documentation: text that says more
// than its own absence. A placeholder ("TODO", "string", "description") or the
// field's name read back ("userId: User id" — the `title` code generators emit
// for every property) fills the slot and documents nothing; counting it as
// present would grade a fake-complete document above an honest, half-written
// one, and it is exactly what a generator or a hurried agent leaves behind.
//
// `name`: the identifier the prose sits on, when it has one. Matching is on the
// normalized text as a whole — a description that merely *mentions* its name
// ("The user id, as returned by /login") is substance, and stays so.
export function isSubstantive(value, { name } = {}) {
  if (!hasText(value)) return false
  const text = normalize(value)
  if (!text || PLACEHOLDERS.has(text) || text.startsWith('lorem ipsum')) return false
  if (name && withoutArticle(text) === normalize(humanize(name))) return false
  return true
}

// Lower case, accents and punctuation dropped, whitespace collapsed: "À
// compléter." and "a completer" are the same placeholder.
export function normalize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// `userId`, `user_id`, `user-id`, `UserID` → "user id".
function humanize(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
}

const ARTICLE = /^(the|a|an|le|la|les|l|un|une|des) /

function withoutArticle(text) {
  return text.replace(ARTICLE, '')
}

// English and French, the two languages the product speaks; normalized as
// above. The JSON type names are what generators and Swagger UI scaffolds
// leave in place of prose.
const PLACEHOLDERS = new Set([
  'todo',
  'to do',
  'tbd',
  'tba',
  'fixme',
  'xxx',
  'wip',
  'n a',
  'na',
  'none',
  'null',
  'undefined',
  'nil',
  'test',
  'placeholder',
  'description',
  'desc',
  'summary',
  'title',
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'a faire',
  'a completer',
  'a definir',
  'a venir',
  'a remplir',
  'aucune',
  'aucun',
  'vide',
])

// A finding's list of names, kept to one line: the first three, then `…`.
const SHOWN = 3

export function abbreviate(values) {
  const shown = values.slice(0, SHOWN).join(', ')
  return values.length > SHOWN ? `${shown}, …` : shown
}
