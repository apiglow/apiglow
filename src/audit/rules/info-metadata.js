import { pointer } from '../pointer.js'
import { hasText } from '../text.js'
import { isSpdxExpression } from './license-identifier-spdx.js'

// Who to ask when the API misbehaves, and under what terms it may be used. Two
// fields, filled once for the life of the document, and the only ones that
// answer "can I build on this, and who do I talk to".
//
// Each counts only when it answers: a contact with an `email` or a `url` (a
// name alone reaches no one), a licence with an `identifier`, a `url`, or a
// `name` that is itself an SPDX licence expression (`MIT`, `Apache-2.0`) — a
// `name` like "Proprietary" names terms nobody can read. Whether the email,
// URL or identifier is well formed is `uri-form`'s and
// `license-identifier-spdx`'s.
const FIELDS = [
  { field: 'contact', filled: (value) => hasText(value.url) || hasText(value.email) },
  {
    field: 'license',
    filled: (value) =>
      hasText(value.identifier) ||
      hasText(value.url) ||
      (typeof value.name === 'string' && isSpdxExpression(value.name.trim())),
  },
]

export const infoMetadata = {
  id: 'info-metadata',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    const info = ctx.document.info ?? {}
    for (const { field, filled } of FIELDS) {
      const value = info[field]
      check(Boolean(value) && typeof value === 'object' && filled(value), {
        location: `info.${field}`,
        dataPath: pointer('info', field),
        params: { field },
      })
    }
  },
}
