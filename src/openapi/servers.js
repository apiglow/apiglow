// A Server Object's `url` is a template: each `{name}` stands for one of its
// `variables` (OAS §4.8.6), whose `default` is the value to use when nobody
// chose another. A URL taken as written keeps the braces — a host
// `{region}.api.example.com` that resolves nowhere, a path segment the URL
// parser percent-encodes into `%7BbasePath%7D`.

const VARIABLE = /\{([^{}]+)\}/g

// The URL with every declared variable at its default, resolved against
// `base` when relative. A `{name}` the server does not declare stays as
// written: there is no value to give it (the audit's `server-variables`).
export function serverUrl(server, base) {
  const url = String(server?.url ?? '').replace(VARIABLE, (match, name) => {
    const variable = declared(server, name)
    return variable?.default != null ? String(variable.default) : match
  })
  return resolveAgainst(url, base)
}

// The URL with every declared variable as an environment variable,
// `{region}` → `{{region}}`: what an environment seeded from this server keeps
// as its base URL, its variables pre-filled with the defaults, so that
// changing `region` in the environment changes the URL.
export function serverTemplate(server, base) {
  const names = []
  // Placeholders the URL parser leaves alone wherever they sit — scheme, host
  // (lowercased), path — swapped back once the URL is resolved.
  const url = String(server?.url ?? '').replace(VARIABLE, (match, name) => {
    if (!declared(server, name)) return match
    names.push(name)
    return `apiglow-var-${names.length - 1}-`
  })
  return resolveAgainst(url, base).replace(
    /apiglow-var-(\d+)-/g,
    (_, index) => `{{${names[Number(index)]}}}`,
  )
}

function declared(server, name) {
  return (server?.variables ?? []).find((variable) => variable.name === name)
}

function resolveAgainst(url, base) {
  if (!base) return url
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}
