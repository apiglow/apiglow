import { credentialFields, credentialsStatus } from '../openapi/auth.js'

// Host-provided credentials (docs/host-credentials.md) — the runtime bridge
// between the host page and the conventional `auth.X` variables.
//
// The app adds a SOURCE of credentials, never a second injection mechanism:
// everything below produces entries shaped exactly like `EnvStore.variablesOf()`
// so the existing machinery (interpolation, injection, missing-credential
// badges, redaction) keeps working untouched.
//
// Pure of `window` on purpose (§8): the shell owns the global and the idle
// scheduling, this module is unit-testable headless.

// Scheme map (`{ bearerAuth: 'eyJ…', basicAuth: { username, password } }`) →
// variable entries, already named the way the rest of the app names them (§3).
//
// A key that names no conventional variable of the loaded spec is REJECTED,
// not written: the provider must not be able to invent variables outside what
// `credentialFields` declares — which is what keeps the overlay confined to
// `auth.*` and makes the merge below provably neutral everywhere else.
export function expandCredentialMap(map, schemes = []) {
  const bySchemeName = new Map((schemes ?? []).map((scheme) => [scheme.name, scheme]))
  const values = {}
  const unknown = []
  // Scheme names the map actually addressed — what `#apply` replaces wholesale.
  // Collected here rather than re-derived: resolving a key against the spec is
  // this function's job, and answering it twice is how the two answers drift.
  const named = []
  for (const [schemeName, raw] of Object.entries(map ?? {})) {
    const scheme = bySchemeName.get(schemeName)
    if (!scheme) {
      unknown.push(schemeName)
      continue
    }
    named.push(schemeName)
    const fields = credentialFields(scheme).map((field) => field.name)
    for (const [name, value] of credentialEntries(schemeName, raw)) {
      if (!fields.includes(name)) {
        unknown.push(name)
        continue
      }
      // Always sensitive: a host token is a secret, and that flag is what
      // export redaction keys off (rule 12, §7).
      values[name] = { value: String(value), sensitive: true }
    }
  }
  return { values, unknown, named }
}

// A scheme's value is either a bare secret (`'eyJ…'` → `auth.X`) or a map of
// suffixes (`{ username, password }` → `auth.X.username`…). Null clears it,
// which is an empty entry list rather than a written void.
function credentialEntries(schemeName, raw) {
  if (raw == null) return []
  if (typeof raw === 'object')
    return Object.entries(raw).map(([suffix, value]) => [`auth.${schemeName}.${suffix}`, value])
  return [[`auth.${schemeName}`, raw]]
}

// The one merge, in the one order (§4): host overlay under the environment,
// run scope on top. An environment variable holding the EMPTY STRING is void
// and falls through to the overlay — everywhere else it is kept, because a
// declared-but-empty variable is how the rest of the app already says
// "missing", and dropping it would change resolution of variables the overlay
// never touches.
export function effectiveVariables(hostValues, envValues, runValues = null) {
  const out = { ...hostValues }
  for (const [name, entry] of Object.entries(envValues ?? {})) {
    if (entry?.value === '' && name in out) continue
    out[name] = entry
  }
  return runValues ? { ...out, ...runValues } : out
}

// Conventional credential variables of `schemes` that the environment leaves
// void — what a boot fill would be for. Empty ⇒ nothing to ask the host (§5).
export function voidCredentials(schemes = [], envValues = {}) {
  return (schemes ?? [])
    .flatMap((scheme) => credentialsStatus(scheme, envValues ?? {}))
    .filter((row) => !row.set)
    .map((row) => row.name)
}

// In-memory overlay + provider slot. `change` fires whenever the overlay's
// content changes, `provider` when a provider is registered — the shell turns
// the latter into an idle fill pass so registration order never matters (§5).
export class HostCredentials extends EventTarget {
  // Rebuilt on every mutation rather than copied per read: `values()` sits on
  // the try-it's refresh path, which runs on every keystroke.
  #values = {}
  #provider = null
  // Single-flight (§3): concurrent needs share one provider call.
  #pending = null
  #specId = 'default'
  #schemes = []

  // Set by the shell once the spec is loaded. Registrations that happened
  // before it are unaffected: nothing is expanded until a call returns.
  set context({ specId = 'default', schemes = [] } = {}) {
    this.#specId = specId
    this.#schemes = schemes ?? []
  }

  get hasProvider() {
    return this.#provider !== null
  }

  values() {
    return this.#values
  }

  covers(name) {
    return name in this.#values
  }

  // Did the overlay feed any of these injected values? `used` is
  // `buildAuthInjection`'s provenance list — comparing by value is what
  // distinguishes a credential we can refresh from one the user typed (§5).
  // Here rather than in the caller: the shape of `#values` is ours.
  supplied(used = []) {
    return used.some((entry) => {
      const held = this.#values[entry.name]
      return held != null && held.value === entry.value
    })
  }

  // Single slot: a second registration replaces the first, out loud — two
  // providers racing to fill the same overlay is never what the host means.
  registerProvider(fn) {
    if (typeof fn !== 'function') {
      console.warn('[api-doc] registerCredentialsProvider expects a function — ignored')
      return
    }
    if (this.#provider) console.warn('[api-doc] credentials provider replaced')
    this.#provider = fn
    this.dispatchEvent(new Event('provider'))
  }

  // `apidoc.setCredentials()`: the push shortcut for a host that already holds
  // the value. Same map shape, same per-scheme replace as a provider result.
  set(map) {
    return this.#apply(map)
  }

  // Host logout. The provider stays registered: the next login is a fill, not
  // a re-registration (§5).
  clear() {
    if (!Object.keys(this.#values).length) return false
    this.#values = {}
    this.dispatchEvent(new Event('change'))
    return true
  }

  // Asks the provider for credentials. Resolves to whether the overlay
  // actually changed — the 401 replay hangs off that answer (§5).
  async request(reason = 'manual', schemeName = undefined) {
    if (!this.#provider) return false
    if (this.#pending) return this.#pending
    this.#pending = this.#call(reason, schemeName).finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  async #call(reason, schemeName) {
    const context = {
      specId: this.#specId,
      reason,
      schemes: this.#descriptors(),
      schemeName,
    }
    let map = null
    try {
      map = await this.#provider(context)
    } catch (err) {
      // A broken provider never blocks the UI: the manual cartouche is always
      // the fallback (§3).
      console.warn('[api-doc] credentials provider failed:', err)
      return false
    }
    return this.#apply(map)
  }

  // One entry per conventional variable, same source as the cartouche fields
  // (§3) — a provider can read what the spec actually asks for instead of
  // hardcoding scheme names.
  #descriptors() {
    return this.#schemes.flatMap((scheme) =>
      credentialFields(scheme).map((field) => ({
        name: scheme.name,
        type: scheme.type,
        field: field.name,
      })),
    )
  }

  // Per-scheme replace: a map naming `basicAuth` replaces every
  // `auth.basicAuth.*` entry, so a host that stops sending the password
  // doesn't leave the old one behind. Schemes the map doesn't name are
  // untouched.
  #apply(map) {
    const { values, unknown, named } = expandCredentialMap(map, this.#schemes)
    for (const name of unknown) {
      console.warn(`[api-doc] host credentials: "${name}" names no credential of this spec`)
    }
    if (!named.length) return false
    const next = {}
    for (const [name, entry] of Object.entries(this.#values)) {
      const replaced = named.some(
        (scheme) => name === `auth.${scheme}` || name.startsWith(`auth.${scheme}.`),
      )
      if (!replaced) next[name] = entry
    }
    Object.assign(next, values)
    if (sameValues(this.#values, next)) return false
    this.#values = next
    this.dispatchEvent(new Event('change'))
    return true
  }
}

function sameValues(a, b) {
  const names = Object.keys(a)
  if (names.length !== Object.keys(b).length) return false
  return names.every((name) => a[name].value === b[name]?.value)
}
