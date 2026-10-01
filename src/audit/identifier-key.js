// What is left of a name once a code generator has made an identifier of it,
// as far as two names can collide there: case aside, without the separators.
// openapi-generator's `sanitizeName` turns `.`, `-`, `:`, `|`, space, `/`,
// `\`, `[` and `(` into `_` (`]` and `)` into nothing), then camelizes — so
// `pet_status`, `pet-status`, `pet.status` and `PetStatus` all become
// `PetStatus`, `user_id` and `userId` one `userId` field, `get_user` and
// `getUser` one `getUser` method. Two names with one key are one identifier in
// a generated SDK, and one file on a case-insensitive file system.
//
// Any other symbol stays in the key: the generator spells it out from its
// special-character table (`+1` → `plus1`, `@type` → `atType`) rather than
// dropping it, so `+1` and `-1` — GitHub's reaction counts — do not collide.
const SEPARATORS = /[_.\-:| /\\[\]()]/g

export function identifierKey(name) {
  return typeof name === 'string' ? name.toLowerCase().replace(SEPARATORS, '') : ''
}
