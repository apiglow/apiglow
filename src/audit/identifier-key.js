// What is left of a name once a code generator has made an identifier of it,
// as far as two names can collide there. openapi-generator's `sanitizeName`
// turns `.`, `-`, `:`, `|`, space, `/`, `\`, `[` and `(` into `_` (`]` and `)`
// into nothing), then `camelize` drops each `_` and uppercases the letter after
// it, and a property or method name gets its first letter lowercased. Every
// other letter keeps its case: `pet_status`, `pet-status`, `pet.status` and
// `PetStatus` all become `petStatus`, `user_id` and `userId` one `userId`
// field, `get_user` and `GetUser` one `getUser` method — but `userId` and
// `userid` stay two fields, `getUserId()` and `getUserid()`.
//
// Any other symbol stays in the key: the generator spells it out from its
// special-character table (`+1` → `plus1`, `@type` → `atType`) rather than
// dropping it, so `+1` and `-1` — GitHub's reaction counts — do not collide.
const DROPPED = /[\])]/g
const SEPARATED = /[_.\-:| /\\[(]+(.?)/g

export function identifierKey(name) {
  if (typeof name !== 'string') return ''
  const camel = name.replace(DROPPED, '').replace(SEPARATED, (_, next) => next.toUpperCase())
  return camel.charAt(0).toLowerCase() + camel.slice(1)
}

// A generated type is a file named after it, and two names one case-insensitive
// file system — macOS's, Windows' default — holds as one file collide there too.
export function fileNameKey(name) {
  return identifierKey(name).toLowerCase()
}
