import { pointer } from '../pointer.js'
import { hasText } from '../text.js'

// Who to ask when the API misbehaves, and under what terms it may be used. Two
// fields, filled once for the life of the document, and the only ones that
// answer "can I build on this, and who do I talk to".
const FIELDS = [
  { field: 'contact', filled: (value) => ['name', 'url', 'email'].some((k) => hasText(value[k])) },
  { field: 'license', filled: (value) => hasText(value.name) || hasText(value.identifier) },
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
