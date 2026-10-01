// A Server Object's `url` is a template: each `{name}` stands for one of its
// `variables` (OAS §4.8.6), whose `default` is the value to use when nobody
// chose another. A URL taken as written keeps the braces — a host
// `{region}.api.example.com` that resolves nowhere, a path segment the URL
// parser percent-encodes into `%7BbasePath%7D`.

const VARIABLE = /\{([^{}]+)\}/g

// `base` defaults to the one the model gave the server (`server.base`, the
// document's own URI): a relative server means "next to the document", never
// "next to the page showing it".

// The URL with every declared variable at its default, resolved against
// `base` when relative. A `{name}` the server does not declare stays as
// written: there is no value to give it (the audit's `server-variables`).
export function serverUrl(server, base = server?.base) {
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
export function serverTemplate(server, base = server?.base) {
  return resolveTemplate(
    server,
    base,
    (name) => Boolean(declared(server, name)),
    (name) => `{{${name}}}`,
  )
}

// The address as the document gives it, every `{name}` kept, made absolute
// when relative: what a page or an export shows, read away from the document
// a `/v1` was relative to.
export function serverAddress(server, base = server?.base) {
  return resolveTemplate(
    server,
    base,
    () => true,
    (name) => `{${name}}`,
  )
}

// Placeholders the URL parser leaves alone wherever they sit — scheme, host
// (lowercased), path — swapped back once the URL is resolved.
function resolveTemplate(server, base, keeps, render) {
  const names = []
  const url = String(server?.url ?? '').replace(VARIABLE, (match, name) => {
    if (!keeps(name)) return match
    names.push(name)
    return `apiglow-var-${names.length - 1}-`
  })
  return resolveAgainst(url, base).replace(/apiglow-var-(\d+)-/g, (_, index) =>
    render(names[Number(index)]),
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
