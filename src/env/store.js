// Prefs scoped per spec: in multi-spec, each spec has its own environments —
// two specs declaring a scheme with the same name (bearerAuth) never share an
// auth.X variable, so no token leakage between APIs.
import { readSpecPref, writeSpecPref } from '../storage/prefs.js'
import { normalizeEnvColor } from './colors.js'

const KEY_LIST = 'environments'
const KEY_SELECTED = 'environment.selected'

// Converts from the host config format ({ variables: { k: { value, sensitive } },
// defaultHeaders: { k: v } }) to the internal array-based format — stable order
// for editing and modifiable names without overwriting other keys.
export function normalizeConfigEnvironment(raw) {
  return {
    id: crypto.randomUUID(),
    name: String(raw.name ?? ''),
    baseUrl: String(raw.baseUrl ?? ''),
    color: normalizeEnvColor(raw.color),
    variables: Object.entries(raw.variables ?? {}).map(([name, v]) =>
      v && typeof v === 'object'
        ? { name, value: String(v.value ?? ''), sensitive: v.sensitive === true }
        : { name, value: String(v ?? ''), sensitive: false },
    ),
    defaultHeaders: Object.entries(raw.defaultHeaders ?? {}).map(([name, value]) => ({
      name,
      value: String(value ?? ''),
    })),
  }
}

// What to call an environment in a control that has to fit on one line. A name
// is optional in the editor, so the fallbacks are what keeps a switcher entry,
// an option or a button label from rendering as an empty string.
export function envLabel(env) {
  return env.name || env.baseUrl || env.id.slice(0, 8)
}

// CRUD + localStorage persistence + current selection. EventTarget: the UI
// subscribes to 'change' rather than knowing about mutations one by one.
export class EnvStore extends EventTarget {
  #envs = []
  #selectedId = null
  #locked = false

  // localStorage is authoritative on environment content, but an
  // environment declared in config and absent from storage (unknown name) is
  // added: without this, changing schema/config after a first session would
  // never make new environments appear.
  //
  // In locked mode (environmentsLocked), it's the opposite: the config
  // is authoritative on the set of environments and their structure; storage
  // only keeps runtime state — ids (selection stability), variable
  // values (OAuth tokens, entered clientId) and variables created at
  // runtime — reapplied by environment name.
  constructor(configEnvironments = [], { locked = false } = {}) {
    super()
    this.#locked = locked
    const stored = readSpecPref(KEY_LIST)
    if (locked) {
      const storedByName = new Map(
        (Array.isArray(stored) ? stored : []).map((e) => [String(e?.name ?? ''), e]),
      )
      this.#envs = (configEnvironments ?? []).map((raw) => {
        const env = normalizeConfigEnvironment(raw)
        const prev = storedByName.get(env.name)
        if (!prev) return env
        if (prev.id) env.id = prev.id
        const configVarNames = new Set(env.variables.map((v) => v.name))
        const prevVars = Array.isArray(prev.variables) ? prev.variables : []
        for (const variable of env.variables) {
          const prevVar = prevVars.find((v) => v?.name === variable.name)
          if (prevVar) variable.value = String(prevVar.value ?? variable.value)
        }
        env.variables.push(...prevVars.filter((v) => v?.name && !configVarNames.has(v.name)))
        return env
      })
      this.#persistList()
    } else if (Array.isArray(stored)) {
      this.#envs = stored
      const known = new Set(this.#envs.map((e) => e.name))
      const added = (configEnvironments ?? [])
        .filter((e) => !known.has(String(e?.name ?? '')))
        .map(normalizeConfigEnvironment)
      if (added.length) {
        this.#envs.push(...added)
        this.#persistList()
      }
    } else {
      this.#envs = (configEnvironments ?? []).map(normalizeConfigEnvironment)
      if (this.#envs.length) this.#persistList()
    }
    const storedSelection = readSpecPref(KEY_SELECTED)
    this.#selectedId = this.#envs.some((e) => e.id === storedSelection)
      ? storedSelection
      : (this.#envs[0]?.id ?? null)
  }

  get locked() {
    return this.#locked
  }

  list() {
    return this.#envs
  }

  get(id) {
    return this.#envs.find((e) => e.id === id) ?? null
  }

  // History entries only retain the environment name: their badge
  // color is resolved at display time, on the env carrying that name
  // (env deleted or renamed since → neutral badge).
  colorOfName(name) {
    return this.#envs.find((e) => e.name === name)?.color ?? null
  }

  get selectedId() {
    return this.#selectedId
  }

  selected() {
    return this.get(this.#selectedId)
  }

  select(id) {
    this.#selectedId = this.get(id) ? id : null
    writeSpecPref(KEY_SELECTED, this.#selectedId)
    this.#emit()
  }

  create(partial = {}) {
    const env = {
      id: crypto.randomUUID(),
      name: String(partial.name ?? ''),
      baseUrl: String(partial.baseUrl ?? ''),
      color: normalizeEnvColor(partial.color),
      variables: partial.variables ?? [],
      defaultHeaders: partial.defaultHeaders ?? [],
    }
    this.#envs.push(env)
    this.#persistList()
    this.select(env.id)
    return env
  }

  update(id, patch) {
    const env = this.get(id)
    if (!env) return
    Object.assign(env, patch)
    this.#persistList()
    this.#emit()
  }

  duplicate(id, newName) {
    const env = this.get(id)
    if (!env) return null
    return this.create({
      ...structuredClone({ ...env, id: undefined }),
      name: newName ?? env.name,
    })
  }

  remove(id) {
    const idx = this.#envs.findIndex((e) => e.id === id)
    if (idx < 0) return
    this.#envs.splice(idx, 1)
    this.#persistList()
    if (this.#selectedId === id) this.select(this.#envs[0]?.id ?? null)
    else this.#emit()
  }

  // Creates or updates a variable (obtained OAuth token, clientId entered in
  // the credentials form). `sensitive` only applies on creation: an
  // explicit choice made in the environment manager is never overwritten.
  setVariable(envId, name, value, { sensitive = false } = {}) {
    const env = this.get(envId)
    if (!env || !name) return
    const existing = env.variables.find((v) => v.name === name)
    if (existing) existing.value = value
    else env.variables.push({ name, value, sensitive })
    this.#persistList()
    this.#emit()
  }

  // Object view for interpolation: { name: { value, sensitive } }.
  variablesOf(env = this.selected()) {
    const out = {}
    for (const v of env?.variables ?? []) {
      if (v.name) out[v.name] = { value: v.value, sensitive: v.sensitive === true }
    }
    return out
  }

  #persistList() {
    writeSpecPref(KEY_LIST, this.#envs)
  }

  #emit() {
    this.dispatchEvent(new Event('change'))
  }
}
