import { pointer } from '../pointer.js'

// Docs readiness: the credentials cartouche shows the scheme's description to
// explain what to paste and where to get it. Without one, the reader gets a
// bare field labeled with the scheme's key.
export const securitySchemeDescribed = {
  id: 'security-scheme-described',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const [name, scheme] of Object.entries(ctx.document.components?.securitySchemes ?? {})) {
      if (!scheme || typeof scheme !== 'object') continue
      check(typeof scheme.description === 'string' && Boolean(scheme.description.trim()), {
        location: `components.securitySchemes.${name}`,
        dataPath: pointer('components', 'securitySchemes', name),
        params: { name },
      })
    }
  },
}
