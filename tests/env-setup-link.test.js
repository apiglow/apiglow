import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase64Url } from '../src/export/share.js'
import {
  SETUP_CAPS,
  applySetupPlan,
  decodeSetupLink,
  defaultSetupSelection,
  encodeSetupLink,
  planSetup,
  setupFormIssues,
  setupFormPayload,
  setupSharesSecret,
} from '../src/env/setup-link.js'

const staging = () => ({
  id: 'env-1',
  name: 'Staging',
  baseUrl: 'https://staging.example.com/v3',
  color: 'amber',
  variables: [
    { name: 'auth.bearerAuth', value: 'tok-123', sensitive: true },
    { name: 'tenant', value: 'acme', sensitive: false },
  ],
  defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
})

const everything = (env) => {
  const selection = defaultSetupSelection(env)
  for (const name of Object.keys(selection.variables)) selection.variables[name] = true
  return selection
}

// Payload of an exact decoded size, spread over several variables so no single
// value reaches the (smaller) value cap.
const payloadOfBytes = (bytes) => {
  const vars = [
    ['a', ''],
    ['b', ''],
    ['c', ''],
  ]
  const shape = () => ({ v: 1, env: { name: 'S', vars } })
  const pad = bytes - JSON.stringify(shape()).length
  const per = Math.floor(pad / 3)
  vars[0][1] = 'x'.repeat(per)
  vars[1][1] = 'x'.repeat(per)
  vars[2][1] = 'x'.repeat(pad - 2 * per)
  return JSON.stringify(shape())
}

describe('setup link codec', () => {
  it('round-trips an environment, sensitive flags included', () => {
    const env = staging()
    const decoded = decodeSetupLink(encodeSetupLink(env, everything(env)))
    expect(decoded).toEqual({
      v: 1,
      spec: null,
      env: {
        name: 'Staging',
        baseUrl: 'https://staging.example.com/v3',
        color: 'amber',
        variables: [
          { name: 'auth.bearerAuth', value: 'tok-123', sensitive: true },
          { name: 'tenant', value: 'acme', sensitive: false },
        ],
        defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
      },
    })
  })

  it('carries the spec id only when there is one', () => {
    const env = staging()
    expect(
      decodeSetupLink(encodeSetupLink(env, everything(env), { specId: 'petstore' })).spec,
    ).toBe('petstore')
    expect(decodeSetupLink(encodeSetupLink(env)).spec).toBeNull()
  })

  it('ships a skeleton by default: sensitive values stay home, their names travel', () => {
    const env = staging()
    const decoded = decodeSetupLink(encodeSetupLink(env))
    expect(decoded.env.variables).toEqual([
      // The flag travels even though the value does not — that is what makes
      // the recipient's field masked from birth.
      { name: 'auth.bearerAuth', value: '', sensitive: true },
      { name: 'tenant', value: 'acme', sensitive: false },
    ])
  })

  it('reads the selection strictly: an unlisted row can only under-share', () => {
    const env = staging()
    const decoded = decodeSetupLink(encodeSetupLink(env, { variables: {}, headers: {} }))
    expect(decoded.env.baseUrl).toBe('')
    expect(decoded.env.color).toBeNull()
    expect(decoded.env.defaultHeaders).toEqual([])
    expect(decoded.env.variables.map((v) => v.value)).toEqual(['', ''])
  })

  it('produces a payload that needs no percent-encoding in a URL', () => {
    const env = { ...staging(), name: 'Recette « été »' }
    const encoded = encodeSetupLink(env, everything(env))
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(decodeSetupLink(encoded).env.name).toBe('Recette « été »')
  })

  it('refuses anything that is not a v1 payload, without throwing', () => {
    for (const input of [
      undefined,
      null,
      '',
      'not base64 !!',
      toBase64Url('not json'),
      toBase64Url('"a string"'),
      toBase64Url('[1,2,3]'),
      toBase64Url(JSON.stringify({ v: 2, env: { name: 'S' } })),
      toBase64Url(JSON.stringify({ env: { name: 'S' } })),
      toBase64Url(JSON.stringify({ v: 1 })),
      toBase64Url(JSON.stringify({ v: 1, env: null })),
      toBase64Url(JSON.stringify({ v: 1, env: [] })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: '' } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 42 } })),
      toBase64Url(JSON.stringify({ v: 1, spec: 42, env: { name: 'S' } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', baseUrl: 42 } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: 'nope' } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['k']] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['k', 'v', 'yes']] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['k', 42]] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [[42, 'v']] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['', 'v']] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [{ name: 'k' }] } })),
      // A name twice would preview twice and write once (decision 8).
      toBase64Url(
        JSON.stringify({
          v: 1,
          env: {
            name: 'S',
            vars: [
              ['k', 'a'],
              ['k', 'b'],
            ],
          },
        }),
      ),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', headers: [['H']] } })),
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', headers: [['H', 42]] } })),
    ]) {
      expect(decodeSetupLink(input)).toBeNull()
    }
  })

  it('drops what it does not recognize rather than refusing the link', () => {
    const decoded = decodeSetupLink(
      toBase64Url(
        JSON.stringify({
          v: 1,
          extra: 'ignored',
          env: { name: 'S', color: 'chartreuse', vars: [['k', 'v', false]], nope: 1 },
        }),
      ),
    )
    // A color outside the closed palette says nothing about the content.
    expect(decoded.env.color).toBeNull()
    expect(decoded.env).toEqual({
      name: 'S',
      baseUrl: '',
      color: null,
      variables: [{ name: 'k', value: 'v', sensitive: false }],
      defaultHeaders: [],
    })
  })
})

describe('setup link caps', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('accepts a payload at the byte cap and refuses one past it', () => {
    expect(payloadOfBytes(SETUP_CAPS.payloadBytes).length).toBe(SETUP_CAPS.payloadBytes)
    expect(decodeSetupLink(toBase64Url(payloadOfBytes(SETUP_CAPS.payloadBytes)))).not.toBeNull()
    expect(decodeSetupLink(toBase64Url(payloadOfBytes(SETUP_CAPS.payloadBytes + 1)))).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('payloadBytes'))
  })

  it('counts the bytes of a payload, not its characters', () => {
    // Two bytes per « é »: a payload that fits as characters can still bust.
    const oversized = JSON.stringify({
      v: 1,
      env: { name: 'S', vars: [['k', 'é'.repeat(SETUP_CAPS.valueChars)]] },
    })
    expect(oversized.length).toBeLessThan(SETUP_CAPS.payloadBytes)
    expect(decodeSetupLink(toBase64Url(oversized))).toBeNull()
  })

  it('refuses an oversized encoded string without decoding it', () => {
    expect(decodeSetupLink('A'.repeat(SETUP_CAPS.payloadBytes * 2 + 1))).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('payloadBytes'))
  })

  it('accepts the last allowed variable and header, and refuses the next', () => {
    const withRows = (key, count) =>
      toBase64Url(
        JSON.stringify({
          v: 1,
          env: { name: 'S', [key]: Array.from({ length: count }, (_, i) => [`v${i}`, 'x']) },
        }),
      )
    expect(decodeSetupLink(withRows('vars', SETUP_CAPS.variables))).not.toBeNull()
    expect(decodeSetupLink(withRows('vars', SETUP_CAPS.variables + 1))).toBeNull()
    expect(decodeSetupLink(withRows('headers', SETUP_CAPS.headers))).not.toBeNull()
    expect(decodeSetupLink(withRows('headers', SETUP_CAPS.headers + 1))).toBeNull()
  })

  it('bounds every name and every value', () => {
    const name = (len) => toBase64Url(JSON.stringify({ v: 1, env: { name: 'n'.repeat(len) } }))
    const varName = (len) =>
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['n'.repeat(len), 'x']] } }))
    const headerName = (len) =>
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', headers: [['n'.repeat(len), 'x']] } }))
    const value = (len) =>
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', vars: [['k', 'x'.repeat(len)]] } }))
    const baseUrl = (len) =>
      toBase64Url(JSON.stringify({ v: 1, env: { name: 'S', baseUrl: 'x'.repeat(len) } }))
    for (const build of [name, varName, headerName]) {
      expect(decodeSetupLink(build(SETUP_CAPS.nameChars))).not.toBeNull()
      expect(decodeSetupLink(build(SETUP_CAPS.nameChars + 1))).toBeNull()
    }
    for (const build of [value, baseUrl]) {
      expect(decodeSetupLink(build(SETUP_CAPS.valueChars))).not.toBeNull()
      expect(decodeSetupLink(build(SETUP_CAPS.valueChars + 1))).toBeNull()
    }
  })
})

// The builder (§3.5) owns no codec: it turns a form into a transient
// environment plus an all-selected-except-uncarried selection and feeds the
// encoder above. What is core about it is that property — the form's own live
// refusal is guarded in e2e, and it exists precisely because a payload past a
// cap is one the landing refuses.
describe('setup link builder, core side', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  // The builder's own shaping, called rather than restated: `rows` is the form
  // field name it uses for variables.
  const fromForm = ({ rows = [], ...form }) => setupFormPayload({ ...form, variables: rows })
  const rowsOf = (count) =>
    Array.from({ length: count }, (_, i) => ({ name: `v${i}`, value: 'x', carry: true }))

  const encodeForm = (form) => {
    const { env, selection } = fromForm(form)
    return decodeSetupLink(encodeSetupLink(env, selection, { specId: form.specId }))
  }

  it('trims names and drops the rows a form is left with half-filled', () => {
    const { env, selection } = fromForm({
      name: '  Staging  ',
      baseUrl: '  https://staging.example.com/v3  ',
      rows: [
        { name: '  tenant  ', value: '  acme  ', carry: true },
        // A row the lead added and never named: a state to pass through, not an
        // error to report.
        { name: '', value: 'orphan', carry: true },
      ],
      headers: [{ name: ' X-Tenant ', value: 'acme' }],
    })
    expect(env.name).toBe('Staging')
    expect(env.baseUrl).toBe('https://staging.example.com/v3')
    // The name is trimmed, the value is not: a trailing space in a token is a
    // value the lead typed, and only they know whether it belongs.
    expect(env.variables).toEqual([{ name: 'tenant', value: '  acme  ', sensitive: false }])
    expect(env.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }])
    // Keyed by the trimmed name, so a row cannot be selected under one spelling
    // and encoded under another.
    expect(selection.variables).toEqual({ tenant: true })
    expect(selection.headers).toEqual({ 'X-Tenant': true })
  })

  it('reports the bound a form is past, and only once per bound', () => {
    const codes = (form) => setupFormIssues(fromForm(form).env).map((issue) => issue.code)
    expect(codes({ name: 'Staging' })).toEqual([])
    expect(codes({ name: '' })).toEqual(['name'])
    expect(codes({ name: 'n'.repeat(SETUP_CAPS.nameChars + 1) })).toEqual(['nameChars'])
    // Two rows over the same bound is one thing to fix, said once.
    expect(
      codes({
        name: 'S',
        rows: [
          { name: 'a', value: 'x'.repeat(SETUP_CAPS.valueChars + 1) },
          { name: 'b', value: 'y'.repeat(SETUP_CAPS.valueChars + 1) },
        ],
      }),
    ).toEqual(['valueChars'])
    expect(
      setupFormIssues(fromForm({ name: 'S', rows: [{ name: 'tenant' }, { name: 'tenant' }] }).env),
    ).toEqual([{ code: 'duplicate', name: 'tenant' }])
    // The cap rides with the code: the wording is the component's, the number
    // is never retyped there.
    expect(codes({ name: 'S', rows: rowsOf(SETUP_CAPS.variables + 1) })).toEqual(['variables'])
    expect(setupFormIssues(fromForm({ name: 'S', rows: rowsOf(51) }).env)[0].max).toBe(
      SETUP_CAPS.variables,
    )
  })

  // The warning both generators show, over the form's own payload: it is the
  // opt-in that makes it true, not the sensitive flag.
  it('warns only once a sensitive value is actually carried', () => {
    const withCarry = (carry) =>
      fromForm({ name: 'S', rows: [{ name: 'k', value: 'tok', sensitive: true, carry }] })
    const off = withCarry(false)
    expect(setupSharesSecret(off.env, off.selection)).toBe(false)
    const on = withCarry(true)
    expect(setupSharesSecret(on.env, on.selection)).toBe(true)
    // Carried, but there is nothing to carry.
    const empty = fromForm({ name: 'S', rows: [{ name: 'k', sensitive: true, carry: true }] })
    expect(setupSharesSecret(empty.env, empty.selection)).toBe(false)
  })

  it('round-trips a form nobody ever saved as an environment', () => {
    const decoded = encodeForm({
      name: 'Staging',
      baseUrl: 'https://staging.example.com/v3',
      color: 'amber',
      specId: 'petstore',
      rows: [
        { name: 'auth.bearerAuth', value: 'lead-token', sensitive: true, carry: false },
        { name: 'tenant', value: 'acme', carry: true },
      ],
      headers: [{ name: 'X-Tenant', value: 'acme' }],
    })
    expect(decoded.spec).toBe('petstore')
    expect(decoded.env.name).toBe('Staging')
    expect(decoded.env.baseUrl).toBe('https://staging.example.com/v3')
    expect(decoded.env.color).toBe('amber')
    expect(decoded.env.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }])
    // The uncarried sensitive row is the skeleton: its name and its flag
    // travel, its value does not (decision 4).
    expect(decoded.env.variables).toEqual([
      { name: 'auth.bearerAuth', value: '', sensitive: true },
      { name: 'tenant', value: 'acme', sensitive: false },
    ])
  })

  it('carries a secret the form deliberately opted in for', () => {
    const decoded = encodeForm({
      name: 'Staging',
      rows: [{ name: 'auth.bearerAuth', value: 'lead-token', sensitive: true, carry: true }],
    })
    expect(decoded.env.variables[0]).toEqual({
      name: 'auth.bearerAuth',
      value: 'lead-token',
      sensitive: true,
    })
  })

  // Each of these is why the form refuses to encode rather than handing over a
  // link: the landing would refuse it, and the recipient would only read
  // "unreadable".
  it('produces a payload the landing refuses, once a form is past a cap', () => {
    expect(encodeForm({ name: 'S', rows: rowsOf(SETUP_CAPS.variables) })).not.toBeNull()
    expect(encodeForm({ name: 'S', rows: rowsOf(SETUP_CAPS.variables + 1) })).toBeNull()
    expect(
      encodeForm({
        name: 'S',
        headers: Array.from({ length: SETUP_CAPS.headers + 1 }, (_, i) => ({ name: `h${i}` })),
      }),
    ).toBeNull()
    expect(encodeForm({ name: 'n'.repeat(SETUP_CAPS.nameChars + 1) })).toBeNull()
    expect(
      encodeForm({
        name: 'S',
        rows: [{ name: 'k', value: 'x'.repeat(SETUP_CAPS.valueChars + 1), carry: true }],
      }),
    ).toBeNull()
    // Every value inside its own bound, and the payload still past the byte cap.
    const bulk = Array.from({ length: 4 }, (_, i) => ({
      name: `v${i}`,
      value: 'x'.repeat(SETUP_CAPS.valueChars),
      carry: true,
    }))
    expect(encodeForm({ name: 'S', rows: bulk })).toBeNull()
  })

  it('produces a payload the landing refuses when a form names a row twice', () => {
    expect(
      encodeForm({
        name: 'S',
        rows: [
          { name: 'tenant', value: 'acme', carry: true },
          { name: 'tenant', value: 'other', carry: true },
        ],
      }),
    ).toBeNull()
    // A variable and a header may share a name: two namespaces, and the
    // decoder's own rejection is per list.
    expect(
      encodeForm({
        name: 'S',
        rows: [{ name: 'tenant', value: 'acme', carry: true }],
        headers: [{ name: 'tenant', value: 'acme' }],
      }),
    ).not.toBeNull()
  })
})

describe('planSetup', () => {
  const decoded = (env, selection) => decodeSetupLink(encodeSetupLink(env, selection))

  it('creates an environment nothing matches, every row an add', () => {
    const env = staging()
    const plan = planSetup(decoded(env, everything(env)), { env: null })
    expect(plan).toEqual({
      mode: 'create',
      name: 'Staging',
      baseUrl: { from: '', to: 'https://staging.example.com/v3' },
      color: { from: null, to: 'amber' },
      variables: [
        { name: 'auth.bearerAuth', action: 'add', value: 'tok-123', sensitive: true },
        { name: 'tenant', action: 'add', value: 'acme', sensitive: false },
      ],
      headers: [{ name: 'X-Tenant', action: 'add', value: 'acme' }],
    })
  })

  it('updates the environment of the same name', () => {
    const env = staging()
    const local = {
      ...staging(),
      baseUrl: 'https://old.example.com',
      color: 'amber',
      variables: [{ name: 'tenant', value: 'acme', sensitive: false }],
      defaultHeaders: [],
    }
    const plan = planSetup(decoded(env, everything(env)), { env: local })
    expect(plan.mode).toBe('update')
    expect(plan.baseUrl).toEqual({
      from: 'https://old.example.com',
      to: 'https://staging.example.com/v3',
    })
    // Unchanged fields are absent, so the preview can only show real changes.
    expect(plan.color).toBeNull()
  })

  it('never overwrites a filled value with an empty one', () => {
    const env = staging()
    const local = {
      ...staging(),
      variables: [{ name: 'auth.bearerAuth', value: 'my-own-token', sensitive: true }],
    }
    // The skeleton link: names travel, the secret does not.
    const plan = planSetup(decoded(env), { env: local })
    expect(plan.variables[0]).toEqual({
      name: 'auth.bearerAuth',
      action: 'keep',
      value: 'my-own-token',
      sensitive: true,
    })
    // A variable the link mentions and the local environment lacks is created,
    // empty value or not.
    expect(plan.variables[1]).toEqual({
      name: 'tenant',
      action: 'add',
      value: 'acme',
      sensitive: false,
    })
  })

  it('sets a differing value and keeps an identical one', () => {
    const env = staging()
    const local = {
      ...staging(),
      variables: [
        { name: 'auth.bearerAuth', value: 'stale', sensitive: true },
        { name: 'tenant', value: 'acme', sensitive: false },
      ],
    }
    const plan = planSetup(decoded(env, everything(env)), { env: local })
    expect(plan.variables).toEqual([
      { name: 'auth.bearerAuth', action: 'set', value: 'tok-123', sensitive: true },
      { name: 'tenant', action: 'keep', value: 'acme', sensitive: false },
    ])
  })

  it('ignores local variables and headers the link does not mention', () => {
    const env = { ...staging(), variables: [], defaultHeaders: [] }
    const local = staging()
    const plan = planSetup(decoded(env, everything(env)), { env: local })
    expect(plan.variables).toEqual([])
    expect(plan.headers).toEqual([])
  })

  it('marks a row sensitive as soon as either side says so', () => {
    const env = {
      ...staging(),
      variables: [{ name: 'token', value: 'from-link', sensitive: false }],
    }
    const local = {
      ...staging(),
      // The recipient marked it sensitive in the manager: a link is not a
      // reason to unmask it in the preview.
      variables: [{ name: 'token', value: 'mine', sensitive: true }],
    }
    const plan = planSetup(decoded(env, everything(env)), { env: local })
    expect(plan.variables[0]).toMatchObject({ action: 'set', sensitive: true })
  })

  it('plans headers like variables, without a sensitive flag', () => {
    const env = staging()
    const local = { ...staging(), defaultHeaders: [{ name: 'X-Tenant', value: 'old' }] }
    const plan = planSetup(decoded(env, everything(env)), { env: local })
    expect(plan.headers).toEqual([{ name: 'X-Tenant', action: 'set', value: 'acme' }])
  })

  it('returns null on a payload that decoding would have refused', () => {
    expect(planSetup(null, { env: null })).toBeNull()
    expect(planSetup({ v: 1 }, { env: null })).toBeNull()
  })
})

// The write half of the landing. Its contract is negative as much as positive:
// what the plan says to keep must reach no store call at all.
describe('applySetupPlan', () => {
  const fakeStore = () => {
    const calls = { created: [], updated: [], variables: [], selected: null }
    return {
      calls,
      create({ name }) {
        const fresh = { id: 'new-1', name, baseUrl: '', variables: [], defaultHeaders: [] }
        calls.created.push(name)
        return fresh
      },
      update(id, patch) {
        calls.updated.push([id, patch])
      },
      setVariable(id, name, value, options) {
        calls.variables.push([id, name, value, options])
      },
      select(id) {
        calls.selected = id
      },
    }
  }

  // Through the codec, so the plan is built from what a link actually carries.
  const planFor = (link, env) =>
    planSetup(decodeSetupLink(encodeSetupLink(link, everything(link))), { env })

  it('creates the environment when the link matched none, and selects it', () => {
    const store = fakeStore()
    const env = applySetupPlan(planFor(staging(), null), { envStore: store, env: null })
    expect(store.calls.created).toEqual(['Staging'])
    expect(store.calls.selected).toBe('new-1')
    expect(env.id).toBe('new-1')
  })

  it('writes nothing but the selection when every row is a keep', () => {
    const store = fakeStore()
    const local = staging()
    applySetupPlan(planFor(staging(), local), { envStore: store, env: local })
    expect(store.calls.created).toEqual([])
    expect(store.calls.updated).toEqual([])
    expect(store.calls.variables).toEqual([])
    expect(store.calls.selected).toBe('env-1')
  })

  it('merges a header onto the existing row and pushes an unknown one', () => {
    const store = fakeStore()
    const local = {
      ...staging(),
      defaultHeaders: [
        { name: 'X-Tenant', value: 'old' },
        { name: 'X-Keep', value: 'mine' },
      ],
    }
    const link = { ...staging(), defaultHeaders: [{ name: 'X-New', value: 'v' }] }
    applySetupPlan(planFor(link, local), { envStore: store, env: local })
    const [, patch] = store.calls.updated[0]
    expect(patch.defaultHeaders).toEqual([
      { name: 'X-Tenant', value: 'old' },
      { name: 'X-Keep', value: 'mine' },
      { name: 'X-New', value: 'v' },
    ])
  })

  it('does not mutate the environment it was handed', () => {
    const store = fakeStore()
    const local = { ...staging(), defaultHeaders: [{ name: 'X-Tenant', value: 'old' }] }
    applySetupPlan(planFor(staging(), local), { envStore: store, env: local })
    expect(local.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'old' }])
  })

  it('carries the plan sensitivity to each written variable', () => {
    const store = fakeStore()
    applySetupPlan(planFor(staging(), null), { envStore: store, env: null })
    expect(store.calls.variables).toEqual([
      ['new-1', 'auth.bearerAuth', 'tok-123', { sensitive: true }],
      ['new-1', 'tenant', 'acme', { sensitive: false }],
    ])
  })
})
