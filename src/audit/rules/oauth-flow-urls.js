import { pointer } from '../pointer.js'

// Docs readiness: the try-it drives authorizationCode (authorizationUrl +
// tokenUrl) and clientCredentials (tokenUrl) itself — see src/openapi/oauth.js.
// A flow missing one of its URLs falls back to pasting a token by hand, when
// it is not simply unusable.
//
// URLs each flow requires, per the OpenAPI spec. `deviceAuthorization` is 3.2:
// listing it costs nothing on older documents, where the key cannot appear.
const REQUIRED_URLS = {
  implicit: ['authorizationUrl'],
  password: ['tokenUrl'],
  clientCredentials: ['tokenUrl'],
  authorizationCode: ['authorizationUrl', 'tokenUrl'],
  deviceAuthorization: ['deviceAuthorizationUrl', 'tokenUrl'],
}

export const oauthFlowUrls = {
  id: 'oauth-flow-urls',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    for (const [name, scheme] of Object.entries(ctx.document.components?.securitySchemes ?? {})) {
      if (scheme?.type !== 'oauth2' || !scheme.flows || typeof scheme.flows !== 'object') continue
      for (const [key, flow] of Object.entries(scheme.flows)) {
        if (!flow || typeof flow !== 'object') continue
        for (const url of REQUIRED_URLS[key] ?? []) {
          check(typeof flow[url] === 'string' && Boolean(flow[url].trim()), {
            location: `components.securitySchemes.${name}.flows.${key}`,
            dataPath: pointer('components', 'securitySchemes', name, 'flows', key, url),
            params: { name, flow: key, url },
          })
        }
      }
    }
  },
}
