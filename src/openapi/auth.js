import { interpolate } from '../env/interpolate.js'

// Auth mapping (docs/architecture.md §5.4) — pure functions, tested.
//
// Convention: the `X` scheme from securitySchemes is set via the environment
// variable `auth.X` (sensitive by default). Exception for http basic, which
// derives two variables `auth.X.username` / `auth.X.password`.

// Input fields of a scheme, the single source of the conventional variables:
// name, nature of the secret (`kind`, translated in the components
// layer) and default hiding when the variable is created.
export function credentialFields(scheme) {
  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return [
      { name: `auth.${scheme.name}.username`, kind: 'username', sensitive: false },
      { name: `auth.${scheme.name}.password`, kind: 'password', sensitive: true },
    ]
  }
  const KIND = { apiKey: 'apiKey', mutualTLS: 'credential' }
  return [{ name: `auth.${scheme.name}`, kind: KIND[scheme.type] ?? 'token', sensitive: true }]
}

export function suggestedVariables(scheme) {
  return credentialFields(scheme).map((field) => field.name)
}

// Credential status of a scheme in a given environment: one row per
// conventional variable, with its resolved value — the caller hides
// sensitive values when displaying.
export function credentialsStatus(scheme, variables) {
  return suggestedVariables(scheme).map((name) => {
    const variable = variables[name]
    const set = variable != null && variable.value !== ''
    return { name, set, sensitive: variable?.sensitive === true, value: set ? variable.value : '' }
  })
}

// Effective security requirements of an operation: its own `security`
// if it has one — including [] which disables auth — otherwise the document's
// global one. An empty requirement {} in the list makes auth optional.
export function applicableSchemes(model, op) {
  const requirements = op.security ?? model.security ?? []
  const byName = new Map(model.securitySchemes.map((s) => [s.name, s]))
  const schemes = []
  let optional = false
  for (const requirement of requirements) {
    const names = Object.keys(requirement)
    if (!names.length) {
      optional = true
      continue
    }
    for (const name of names) {
      const scheme = byName.get(name)
      if (scheme && !schemes.includes(scheme)) schemes.push(scheme)
    }
  }
  return { schemes, optional }
}

// Concrete injection for a chosen scheme: headers/query/cookies to merge
// into the request. Non-empty `missing` ⇒ the caller blocks the send (never
// send a literal {{var}}); `used` feeds redaction.
export function buildAuthInjection(scheme, variables) {
  const out = { headers: {}, query: {}, cookies: {}, missing: [], used: [] }
  const resolve = (template) => {
    const r = interpolate(template, variables)
    out.missing.push(...r.missing)
    out.used.push(...r.used)
    return r.value
  }

  switch (scheme.type) {
    case 'http': {
      if (scheme.scheme === 'basic') {
        const username = resolve(`{{auth.${scheme.name}.username}}`)
        const password = resolve(`{{auth.${scheme.name}.password}}`)
        if (!out.missing.length) {
          const encoded = `Basic ${btoa(`${username}:${password}`)}`
          out.headers.Authorization = encoded
          // The encoded form is still a secret: synthetic entry so that
          // redaction also covers the assembled header.
          out.used.push({ name: `auth.${scheme.name}`, value: encoded, sensitive: true })
        }
      } else {
        const token = resolve(`{{auth.${scheme.name}}}`)
        if (!out.missing.length) {
          // 'bearer' → standard prefix; other exotic http schemes:
          // informal prefix modeled on the scheme's name.
          const prefix = !scheme.scheme || scheme.scheme === 'bearer' ? 'Bearer' : scheme.scheme
          out.headers.Authorization = `${prefix} ${token}`
        }
      }
      break
    }
    case 'apiKey': {
      const value = resolve(`{{auth.${scheme.name}}}`)
      if (!out.missing.length && scheme.paramName) {
        if (scheme.in === 'query') out.query[scheme.paramName] = value
        else if (scheme.in === 'cookie') out.cookies[scheme.paramName] = value
        else out.headers[scheme.paramName] = value
      }
      break
    }
    case 'oauth2':
    case 'openIdConnect': {
      // No OAuth flow in the MVP (docs/architecture.md §5.4): the variable holds a token
      // obtained elsewhere and pasted in by hand.
      const token = resolve(`{{auth.${scheme.name}}}`)
      if (!out.missing.length) out.headers.Authorization = `Bearer ${token}`
      break
    }
    default:
      // mutualTLS & co: nothing injectable at the request level.
      break
  }
  return out
}
