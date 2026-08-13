import { hasText } from '../text.js'

// `info.description` is the home page of this documentation: without it, the
// reader lands on a title and a list of endpoints, with nothing telling them
// what the API is for or how to get access to it.
export const infoDescribed = {
  id: 'info-described',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    const info = ctx.document.info ?? {}
    check(hasText(info.description) || hasText(info.summary), {
      location: 'info',
      dataPath: '/info/description',
    })
  },
}
