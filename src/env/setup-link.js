// Environment setup link (docs/env-setup-link.md): one URL that
// configures a teammate's environment — base URL, default headers, and the
// *names* of the credential variables. Pure core (rule 10): the codec, the
// caps and the merge plan live here and know nothing of `window`; the shell
// owns reading the hash and writing through EnvStore.

import { fromBase64Url, toBase64Url } from '../export/share.js'
import { normalizeEnvColor } from './colors.js'

const SETUP_LINK_VERSION = 1

// §3.3. A link is untrusted input arriving in a URL, and `environments` is the
// one localStorage dataset with no numeric cap (architecture §6.2) — these
// bounds are what keeps that true of user-typed content only.
export const SETUP_CAPS = {
  // Bytes of decoded JSON: ~11 KB of base64, already past what any chat
  // client forwards intact.
  payloadBytes: 8 * 1024,
  variables: 50,
  headers: 20,
  // Characters, for variable names, header names and the environment name.
  nameChars: 200,
  // Characters, for values and the base URL. A JWT is ~1 KB.
  valueChars: 4 * 1024,
  // Not a bound on the payload but on the generated URL (§3.4): past this
  // length a chat client, an issue tracker or a mail client may truncate it
  // silently, which is the worst failure mode a link has — it still looks like
  // a link. Warned about, never enforced: the sender decides.
  urlWarnChars: 2000,
}

// The generator's default checkbox state (§3.4, decision 4): everything
// travels except sensitive *values*, which cost a deliberate gesture. An
// unselected variable still travels by name — that is the skeleton.
export function defaultSetupSelection(env) {
  return {
    baseUrl: true,
    color: true,
    variables: Object.fromEntries(
      (env?.variables ?? []).filter((v) => v?.name).map((v) => [v.name, v.sensitive !== true]),
    ),
    headers: Object.fromEntries(
      (env?.defaultHeaders ?? []).filter((h) => h?.name).map((h) => [h.name, true]),
    ),
  }
}

// Whether a secret actually travels in the link — the warning both generators
// show (§3.4, decision 4). One definition, because the §3.4 checklist and the
// §3.5 form have to agree on what "a secret travels" means, and a warning that
// differs between the two is a warning nobody can rely on.
export function setupSharesSecret(env, selection) {
  return (env?.variables ?? []).some(
    (v) => v?.name && v.sensitive === true && v.value && selection?.variables?.[v.name] === true,
  )
}

// --- the from-scratch form's core (§3.5) -----------------------------------
//
// The builder owns no codec, but it does own a shaping — which is where its
// real rules live: names are trimmed and values are not, a blank row is
// dropped, the selection is keyed by the *trimmed* name so it cannot desync
// from the environment it describes. Pure and here rather than in the custom
// element, because that is what makes it reachable from the codec's own tests.

// Rows in, `{ env, selection }` out, both derived from the same trimmed names.
// Blank rows are dropped rather than refused — a row starts blank, and that is
// a state to pass through, not an error to report.
export function setupFormPayload(form) {
  const named = (rows) =>
    (rows ?? [])
      .map((row) => ({ ...row, name: String(row?.name ?? '').trim() }))
      .filter((row) => row.name)
  const variables = named(form?.variables)
  const headers = named(form?.headers)
  return {
    env: {
      name: String(form?.name ?? '').trim(),
      baseUrl: String(form?.baseUrl ?? '').trim(),
      color: form?.color ?? null,
      variables: variables.map(({ name, value, sensitive }) => ({
        name,
        value: String(value ?? ''),
        sensitive: sensitive === true,
      })),
      defaultHeaders: headers.map(({ name, value }) => ({ name, value: String(value ?? '') })),
    },
    // Everything travels except a sensitive value the lead has not opted in
    // for: `carry` is the §3.4 checkbox, moved onto the row it governs.
    selection: {
      baseUrl: true,
      color: true,
      variables: Object.fromEntries(variables.map((row) => [row.name, row.carry === true])),
      headers: Object.fromEntries(headers.map((row) => [row.name, true])),
    },
  }
}

const ISSUE_MAX = {
  variables: SETUP_CAPS.variables,
  headers: SETUP_CAPS.headers,
  nameChars: SETUP_CAPS.nameChars,
  valueChars: SETUP_CAPS.valueChars,
}

// The §3.3 bounds, checked on the form so the generator can *say* them: the
// decoder rejects the same payload but deliberately never names the bound,
// because its reader cannot fix it — here the reader is the one who can.
// Codes and not messages: the core owns the bounds, the component owns the
// wording. `payloadBytes` is absent on purpose — it is a property of the
// encoded payload, not of any field, and `decodeSetupLink` stays its judge.
export function setupFormIssues(env) {
  const issues = []
  const code = (name) => issues.push({ code: name, max: ISSUE_MAX[name] })
  if (!env.name) issues.push({ code: 'name' })
  if (env.variables.length > SETUP_CAPS.variables) code('variables')
  if (env.defaultHeaders.length > SETUP_CAPS.headers) code('headers')
  const overName = (row) => row.name.length > SETUP_CAPS.nameChars
  if (
    env.name.length > SETUP_CAPS.nameChars ||
    env.variables.some(overName) ||
    env.defaultHeaders.some(overName)
  )
    code('nameChars')
  const overValue = (row) => row.value.length > SETUP_CAPS.valueChars
  if (
    env.baseUrl.length > SETUP_CAPS.valueChars ||
    env.variables.some(overValue) ||
    env.defaultHeaders.some(overValue)
  )
    code('valueChars')
  // Per list, not across both: a `tenant` variable and an `X-Tenant` header are
  // two namespaces, and it is the decoder's per-list rejection this mirrors.
  for (const name of [...duplicateNames(env.variables), ...duplicateNames(env.defaultHeaders)])
    issues.push({ code: 'duplicate', name })
  return issues
}

// A name appearing twice would preview twice and write once, which is why the
// decoder rejects the link whole (§3.3) — caught here so the form can say which
// name, instead of the recipient getting "unreadable".
function duplicateNames(rows) {
  const seen = new Set()
  const twice = new Set()
  for (const { name } of rows) {
    if (seen.has(name)) twice.add(name)
    seen.add(name)
  }
  return [...twice]
}

// `selection` is authoritative and read strictly: an absent key means *not*
// selected, so a partial selection can only ever under-share.
export function encodeSetupLink(env, selection = defaultSetupSelection(env), { specId } = {}) {
  const link = { name: String(env?.name ?? '') }
  if (selection?.baseUrl === true && env?.baseUrl) link.baseUrl = String(env.baseUrl)
  if (selection?.color === true && normalizeEnvColor(env?.color)) link.color = env.color
  const vars = (env?.variables ?? [])
    .filter((v) => v?.name)
    .map((v) => {
      const value = selection?.variables?.[v.name] === true ? String(v.value ?? '') : ''
      // The flag travels even when the value does not: it is what makes the
      // recipient's field masked from the moment it is created (§3.2).
      return v.sensitive === true ? [v.name, value, true] : [v.name, value]
    })
  const headers = (env?.defaultHeaders ?? [])
    .filter((h) => h?.name && selection?.headers?.[h.name] === true)
    .map((h) => [h.name, String(h.value ?? '')])
  if (vars.length) link.vars = vars
  if (headers.length) link.headers = headers
  const payload = { v: SETUP_LINK_VERSION }
  if (specId) payload.spec = String(specId)
  payload.env = link
  return toBase64Url(JSON.stringify(payload))
}

// Which bound failed is a developer's question, not a user's (§3.3): the
// console carries it, the UI says "invalid link" either way.
function reject(bound) {
  console.error(`[api-doc] setup link rejected: ${bound}`)
  return null
}

const isName = (v) => typeof v === 'string' && v.length > 0 && v.length <= SETUP_CAPS.nameChars
const isValue = (v) => typeof v === 'string' && v.length <= SETUP_CAPS.valueChars

// [name, value] or [name, value, sensitive] — the third slot is omitted when
// false, since this travels in a URL.
function decodeRows(rows, max) {
  if (rows === undefined) return []
  if (!Array.isArray(rows) || rows.length > max) return null
  const out = []
  const seen = new Set()
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2 || row.length > 3) return null
    const [name, value, sensitive] = row
    if (!isName(name) || !isValue(value)) return null
    if (sensitive !== undefined && typeof sensitive !== 'boolean') return null
    // Two rows for one name would render a preview that promises twice and
    // writes once — rejected whole, like any other deviation (decision 8).
    if (seen.has(name)) return null
    seen.add(name)
    out.push({ name, value, sensitive: sensitive === true })
  }
  return out
}

// Untrusted input from a URL: any deviation returns null, never throws — the
// `decodeShareState` discipline, for the same reason.
export function decodeSetupLink(encoded) {
  const raw = String(encoded ?? '')
  // Cheap pre-check so a multi-megabyte hash is never base64-decoded: base64
  // expands by 4/3, so no payload within the byte cap can reach this.
  if (raw.length > SETUP_CAPS.payloadBytes * 2) return reject('payloadBytes')
  let json
  try {
    json = fromBase64Url(raw)
  } catch {
    return null
  }
  if (new TextEncoder().encode(json).length > SETUP_CAPS.payloadBytes) return reject('payloadBytes')
  let payload
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (payload.v !== SETUP_LINK_VERSION) return null
  if (payload.spec !== undefined && !isName(payload.spec)) return null
  const link = payload.env
  if (!link || typeof link !== 'object' || Array.isArray(link)) return null
  if (!isName(link.name)) return reject('nameChars')
  if (link.baseUrl !== undefined && !isValue(link.baseUrl)) return reject('valueChars')
  const variables = decodeRows(link.vars, SETUP_CAPS.variables)
  if (!variables) return reject('variables')
  const defaultHeaders = decodeRows(link.headers, SETUP_CAPS.headers)
  if (!defaultHeaders) return reject('headers')
  return {
    v: SETUP_LINK_VERSION,
    spec: payload.spec ?? null,
    env: {
      name: link.name,
      baseUrl: link.baseUrl ?? '',
      // A color outside the closed palette is dropped, not refused: it says
      // nothing about the environment's content (§3.2).
      color: normalizeEnvColor(link.color),
      variables,
      // Stripped of `sensitive`: a header is not a credential slot, and
      // `decodeRows` fills the flag for both kinds of row.
      defaultHeaders: defaultHeaders.map(({ name, value }) => ({ name, value })),
    },
  }
}

// `add` when the row does not exist locally, `set` when the link carries a
// different non-empty value, `keep` otherwise — which is decision 5: an empty
// link value never overwrites a filled local one.
function planRow(link, local) {
  if (!local) return { action: 'add', value: link.value }
  if (link.value && link.value !== local.value) return { action: 'set', value: link.value }
  return { action: 'keep', value: local.value }
}

// The single source of both halves of the landing: the dialog renders this and
// apply executes it, so the preview cannot promise what the write does not do.
// `env` is the environment matching the link's name, or null (decision 6:
// variables the link does not mention are absent from the plan, and stay
// untouched).
export function planSetup(payload, { env = null } = {}) {
  const link = payload?.env
  if (!link) return null
  const localVars = new Map((env?.variables ?? []).filter((v) => v?.name).map((v) => [v.name, v]))
  const localHeaders = new Map(
    (env?.defaultHeaders ?? []).filter((h) => h?.name).map((h) => [h.name, h]),
  )
  return {
    mode: env ? 'update' : 'create',
    name: link.name,
    baseUrl:
      link.baseUrl && link.baseUrl !== (env?.baseUrl ?? '')
        ? { from: env?.baseUrl ?? '', to: link.baseUrl }
        : null,
    color:
      link.color && link.color !== (env?.color ?? null)
        ? { from: env?.color ?? null, to: link.color }
        : null,
    variables: (link.variables ?? []).map((v) => {
      const local = localVars.get(v.name)
      return {
        name: v.name,
        ...planRow(v, local),
        // Effective sensitivity, not just the link's: a `set` row over a
        // variable the user already marked sensitive must still be masked in
        // the preview (§4.3). Only `add` rows carry it to the write, where
        // `EnvStore.setVariable` applies it on creation only (§4.2).
        sensitive: v.sensitive === true || local?.sensitive === true,
      }
    }),
    headers: (link.defaultHeaders ?? []).map((h) => ({
      name: h.name,
      ...planRow(h, localHeaders.get(h.name)),
    })),
  }
}

// Executes the plan the dialog has just shown, and nothing besides: a `keep`
// row is not written, and a variable the link never mentioned is not touched.
// Next to `planSetup` and not in the shell, because the two halves have to
// agree on the vocabulary — `keep`/`add`/`set`, and where a header row lands.
// `env` is the same match the plan was built against, or null to create.
export function applySetupPlan(plan, { envStore, env: match = null }) {
  const env = match ?? envStore.create({ name: plan.name })
  const patch = {}
  if (plan.baseUrl) patch.baseUrl = plan.baseUrl.to
  if (plan.color) patch.color = plan.color.to
  const changedHeaders = plan.headers.filter((row) => row.action !== 'keep')
  if (changedHeaders.length) {
    // The rows are copied, not just the array: merging writes into them, and
    // `env` belongs to the store, not to us.
    const headers = env.defaultHeaders.map((h) => ({ ...h }))
    for (const row of changedHeaders) {
      const existing = headers.find((h) => h.name === row.name)
      if (existing) existing.value = row.value
      else headers.push({ name: row.name, value: row.value })
    }
    patch.defaultHeaders = headers
  }
  if (Object.keys(patch).length) envStore.update(env.id, patch)
  for (const row of plan.variables) {
    if (row.action === 'keep') continue
    // `sensitive` lands on creation only — EnvStore's own contract, and the
    // reason a link cannot unmask a variable the user marked itself.
    envStore.setVariable(env.id, row.name, row.value, { sensitive: row.sensitive })
  }
  envStore.select(env.id)
  return env
}
