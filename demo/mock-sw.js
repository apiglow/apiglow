// In-browser mock of the demo petstore API. The demo pages declare a
// same-origin server (/demo-api/v3) and this worker answers it from memory:
// no backend to host, no CORS, no proxy — which is what the try-it panel
// then honestly reports.
//
// Deliberately NOT used by the e2e suite: those tests validate the app, not
// the demo, and keep intercepting at the Playwright level.
//
// State lives in the worker's memory only. The browser terminates an idle
// service worker whenever it likes and the next request reseeds from
// scratch — this is a playground, not a database, and a pet created ten
// minutes ago may be gone. Persisting it would mean a second storage layer
// to explain in a file whose whole point is to need no explanation.

const API_PREFIX = '/demo-api/v3'
const OAUTH_PREFIX = '/demo-api/oauth'
// Enough round-trip for the send meter to have something to show; small
// enough that the shipped three-step scenario still finishes instantly.
const LATENCY_MS = 120

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Everything else — the app bundle, app.css, i18n/*.json, the schemas —
  // must reach the network untouched.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith(`${OAUTH_PREFIX}/`)) {
    event.respondWith(handleOauth(event.request, url))
    return
  }
  if (!url.pathname.startsWith(`${API_PREFIX}/`)) return
  event.respondWith(handle(event.request, url))
})

// --- OAuth authorization server ---------------------------------------------
//
// The four flows the demo schema declares run against these same-origin
// endpoints, all served from this worker — a hosted demo needs no
// authorization server anywhere. The consent step is a top-level navigation,
// which a service worker intercepts like any other in-scope request, so even
// that page comes from here. Any client is accepted, every token is fanciful.

async function handleOauth(request, url) {
  const path = url.pathname.slice(OAUTH_PREFIX.length)
  await sleep(LATENCY_MS)
  if (request.method === 'GET' && path === '/authorize') return oauthAuthorize(url)
  if (request.method === 'POST' && path === '/token') return oauthToken(request)
  if (request.method === 'POST' && path === '/device_authorization') return oauthDevice(url)
  if (request.method === 'GET' && path === '/.well-known/oauth-authorization-server')
    return oauthMetadata(url)
  return problem(404, `No such OAuth endpoint: ${path}`)
}

function demoToken(kind) {
  return `demo-${kind}-${crypto.randomUUID().slice(0, 12)}`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

// Consent page: "Authorize" sends the browser back to redirect_uri with a
// code (authorization code flow) or a token fragment (implicit) — plus the
// caller's `state`, echoed verbatim, since the app verifies it.
function oauthAuthorize(url) {
  const query = url.searchParams
  const redirect = query.get('redirect_uri')
  if (!redirect) return problem(400, 'missing redirect_uri')
  const implicit = query.get('response_type') === 'token'
  const back = (params, fragment = null) => {
    const target = new URL(redirect)
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
    if (query.get('state') && !fragment) target.searchParams.set('state', query.get('state'))
    if (fragment) target.hash = fragment
    return target.href
  }
  const grantUrl = implicit
    ? back(
        {},
        new URLSearchParams({
          access_token: demoToken('implicit'),
          token_type: 'Bearer',
          expires_in: '3600',
          ...(query.get('state') ? { state: query.get('state') } : {}),
        }).toString(),
      )
    : back({ code: `demo-code-${crypto.randomUUID().slice(0, 16)}` })
  const denyUrl = back({ error: 'access_denied', error_description: 'The user denied the request' })
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Demo OAuth</title>
<style>body{font-family:system-ui;max-width:26rem;margin:15vh auto;padding:0 1rem}
a{display:inline-block;padding:.5rem 1.25rem;border-radius:.5rem;text-decoration:none;border:1px solid #ccc;color:#333}
a.grant{background:#16a34a;border-color:#16a34a;color:#fff;margin-right:.5rem}</style></head><body>
<h1>Demo authorization server</h1>
<p>Served by the demo's own service worker — accepts any client, issues fake tokens.</p>
<p>Client: <code>${escapeHtml(query.get('client_id') ?? '(none)')}</code><br>
Scopes: <code>${escapeHtml(query.get('scope') || '(none)')}</code></p>
<p><a class="grant" href="${escapeHtml(grantUrl)}">Authorize</a><a href="${escapeHtml(denyUrl)}">Deny</a></p>
</body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

async function oauthToken(request) {
  const params = new URLSearchParams(await request.text())
  const grant = params.get('grant_type')
  if (grant === 'authorization_code' && !params.get('code')) {
    return json(
      { error: 'invalid_grant', error_description: 'Missing authorization code' },
      { status: 400 },
    )
  }
  if (!['authorization_code', 'client_credentials', DEVICE_GRANT].includes(grant)) {
    return json({ error: 'unsupported_grant_type' }, { status: 400 })
  }
  return json({
    access_token: demoToken(grant === DEVICE_GRANT ? 'device' : grant),
    token_type: 'Bearer',
    expires_in: 3600,
    ...(params.get('scope') ? { scope: params.get('scope') } : {}),
  })
}

// Device flow: the "user" is deemed to approve instantly — the point is that
// the endpoints answer, not that someone types a code on a second screen.
function oauthDevice(url) {
  const origin = url.origin
  const userCode = crypto.randomUUID().slice(0, 8).toUpperCase()
  return json({
    device_code: demoToken('device-code'),
    user_code: userCode,
    verification_uri: `${origin}${OAUTH_PREFIX}/authorize`,
    verification_uri_complete: `${origin}${OAUTH_PREFIX}/authorize?user_code=${userCode}`,
    expires_in: 900,
    interval: 1,
  })
}

// RFC 8414 metadata, since the schema declares `oauth2MetadataUrl` (3.2).
function oauthMetadata(url) {
  const base = `${url.origin}${OAUTH_PREFIX}`
  return json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    device_authorization_endpoint: `${base}/device_authorization`,
    response_types_supported: ['code', 'token'],
    grant_types_supported: ['authorization_code', 'client_credentials', DEVICE_GRANT],
    code_challenge_methods_supported: ['S256'],
  })
}

// --- store ------------------------------------------------------------------

const state = {}
seed()

function seed() {
  state.pets = new Map(
    [
      pet(10, 'doggie', 'available', { id: 1, name: 'Dogs' }, ['dog', 'puppy']),
      pet(11, 'Rex', 'pending', { id: 1, name: 'Dogs' }, ['dog', 'guard']),
      pet(12, 'Mittens', 'available', { id: 2, name: 'Cats' }, ['cat']),
      pet(13, 'Nemo', 'sold', { id: 3, name: 'Fish' }, ['fish', 'aquarium']),
    ].map((p) => [p.id, p]),
  )
  state.orders = new Map(
    [
      {
        id: 10,
        petId: 10,
        quantity: 7,
        shipDate: '2026-03-02T08:15:00Z',
        status: 'approved',
        complete: true,
      },
      {
        id: 11,
        petId: 13,
        quantity: 1,
        shipDate: '2026-03-04T10:00:00Z',
        status: 'placed',
        complete: false,
      },
    ].map((o) => [o.id, o]),
  )
  state.users = new Map(
    [
      user(1, 'user1', 'John', 'James', 'john@example.com'),
      user(2, 'theUser', 'Jane', 'Doe', 'jane@email.com'),
    ].map((u) => [u.username, u]),
  )
  state.subscriptions = new Map()
  state.nextPetId = 100
  state.nextOrderId = 100
  state.nextUserId = 100
}

function pet(id, name, status, category, tags) {
  return {
    id,
    name,
    category,
    photoUrls: [`https://example.com/photos/${name.toLowerCase()}.png`],
    tags: tags.map((tag, i) => ({ id: i + 1, name: tag })),
    status,
  }
}

function user(id, username, firstName, lastName, email) {
  return {
    id,
    username,
    firstName,
    lastName,
    email,
    password: 'hunter2',
    phone: '555-0100',
    userStatus: 1,
  }
}

// --- routing ----------------------------------------------------------------

const ROUTES = [
  ['POST', '/pet', addPet],
  ['PUT', '/pet', updatePet],
  ['GET', '/pet/findByStatus', findPetsByStatus],
  ['GET', '/pet/findByTags', findPetsByTags],
  ['GET', '/pet/search', filterPets],
  // OpenAPI 3.2 `query` method: a read that carries a body.
  ['QUERY', '/pet/search', searchPets],
  ['GET', '/pet/{petId}', getPetById],
  ['POST', '/pet/{petId}', updatePetWithForm],
  ['DELETE', '/pet/{petId}', deletePet],
  ['POST', '/pet/{petId}/uploadImage', uploadFile],
  ['POST', '/pet/{petId}/subscribe', subscribeToPet],
  ['GET', '/pet/{petId}/events', streamPetEvents],
  ['GET', '/failures/server-error', failServerError],
  ['GET', '/failures/unavailable', failUnavailable],
  ['GET', '/failures/rate-limit', failRateLimit],
  ['GET', '/failures/protected', failProtected],
  ['GET', '/failures/forbidden', failForbidden],
  ['POST', '/failures/validation', failValidation],
  ['GET', '/failures/slow', failSlow],
  ['GET', '/failures/malformed', failMalformed],
  ['GET', '/failures/hang', failHang],
  ['GET', '/store/inventory', getInventory],
  ['PURGE', '/store/inventory', purgeInventory],
  ['POST', '/store/order', placeOrder],
  ['GET', '/store/order/{orderId}', getOrderById],
  ['DELETE', '/store/order/{orderId}', deleteOrder],
  ['POST', '/user', createUser],
  ['POST', '/user/createWithList', createUsersWithListInput],
  ['GET', '/user/login', loginUser],
  ['GET', '/user/logout', logoutUser],
  ['GET', '/user/{username}', getUserByName],
  ['PUT', '/user/{username}', updateUser],
  ['DELETE', '/user/{username}', deleteUser],
]

async function handle(request, url) {
  const path = url.pathname.slice(API_PREFIX.length)
  const found = match(request.method.toUpperCase(), path)
  await sleep(LATENCY_MS)
  if (found === 'method') return problem(405, 'Method not allowed on this path')
  if (!found) return problem(404, `No such endpoint: ${path}`)
  try {
    return await found.handler({ request, url, params: found.params })
  } catch (err) {
    return problem(500, `Mock failure: ${err?.message ?? err}`)
  }
}

// Returns { handler, params }, the string 'method' when only the method is
// wrong, or null. Literal routes are declared before their parameterized
// siblings, so /pet/findByStatus never lands on /pet/{petId}.
function match(method, path) {
  const segments = path.split('/').filter(Boolean)
  let pathMatched = false
  for (const [routeMethod, pattern, handler] of ROUTES) {
    const patternSegments = pattern.split('/').filter(Boolean)
    if (patternSegments.length !== segments.length) continue
    const params = {}
    const matches = patternSegments.every((segment, i) => {
      const param = /^\{(.+)\}$/.exec(segment)
      if (!param) return segment === segments[i]
      params[param[1]] = decodeURIComponent(segments[i])
      return true
    })
    if (!matches) continue
    pathMatched = true
    if (routeMethod === method) return { handler, params }
  }
  return pathMatched ? 'method' : null
}

// --- responses --------------------------------------------------------------

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Same-origin, so the panel can read it without any CORS opt-in: the
      // "server time" line of the send meter has something real to show.
      'server-timing': `mock;dur=${LATENCY_MS}`,
      ...insightHeaders(),
      ...headers,
    },
  })
}

// --- showcase headers -------------------------------------------------------
//
// The insight strip (docs/network-insights.md §4) reads well-known response
// headers. A real API sends them; this mock sends them too, so the feature is
// visible in the demo instead of only in the tests. Nothing else depends on
// them — remove them and the demo still works, minus the chips.

const RATE_LIMIT = 100
const RATE_WINDOW_MS = 60_000
let quota = { remaining: RATE_LIMIT, resetAt: 0 }

function insightHeaders() {
  const now = Date.now()
  if (now >= quota.resetAt) quota = { remaining: RATE_LIMIT, resetAt: now + RATE_WINDOW_MS }
  quota.remaining = Math.max(0, quota.remaining - 1)
  return {
    'ratelimit-limit': String(RATE_LIMIT),
    'ratelimit-remaining': String(quota.remaining),
    'ratelimit-reset': String(Math.ceil((quota.resetAt - now) / 1000)),
    // What a user pastes into a support ticket.
    'x-request-id': crypto.randomUUID(),
  }
}

// Weak validator over the JSON the handler is about to send: it changes when
// the resource changes, which is all `If-None-Match` needs.
function etagOf(value) {
  const text = JSON.stringify(value)
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return `W/"${(hash >>> 0).toString(36)}"`
}

// 304 carries no body, and repeats the validator so a second replay still
// matches.
function notModified(etag) {
  return new Response(null, {
    status: 304,
    headers: { etag, 'server-timing': `mock;dur=${LATENCY_MS}`, ...insightHeaders() },
  })
}

// The 200s that declare no content in the schema (deletions, logout, updateUser).
function noBody(status = 200) {
  return new Response(null, { status, headers: { 'server-timing': `mock;dur=${LATENCY_MS}` } })
}

function problem(status, message) {
  return json({ code: status, type: 'error', message }, { status })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The demo schema declares JSON, XML and urlencoded variants of the same
// bodies. The mock accepts every variant the app can actually send — reading
// only JSON meant the urlencoded one, which the try-it offers on six
// operations, blew up on `JSON.parse`.
async function readBody(request) {
  const type = mediaEssence(request)
  if (type === 'application/x-www-form-urlencoded')
    return fromParams(new URLSearchParams(await request.text()))
  if (type === 'multipart/form-data') return fromParams(await request.formData())
  const text = await request.text()
  if (!text.trim()) return null
  if (type === 'application/xml' || type === 'text/xml') return fromXml(text)
  return JSON.parse(text)
}

// The XML variant, now that the try-it pre-fills a real XML body instead of an
// empty textarea. Deliberately a toy parser — no attributes, no namespaces, no
// entities beyond the three the app's own sampler escapes: the demo's bodies
// are the petstore's, and a service worker has no DOMParser to do better.
const XML_TAG_RE = /<([\w.-]+)>([\s\S]*?)<\/\1>/g

function fromXml(text) {
  const body = text.replace(/<\?[\s\S]*?\?>/g, '').trim()
  const root = XML_TAG_RE.exec(body)
  XML_TAG_RE.lastIndex = 0
  return root ? xmlValue(root[2]) : null
}

function xmlValue(inner) {
  const out = {}
  let matched = false
  for (const [, tag, content] of inner.matchAll(XML_TAG_RE)) {
    matched = true
    const value = /<[\w.-]+>/.test(content)
      ? xmlValue(content)
      : coerceFormValue(tag, unescapeXml(content))
    // A repeated tag is a list — that is how the sampler writes an unwrapped
    // array, and how `photoUrls`/`tags` arrive.
    if (tag in out) out[tag] = [].concat(out[tag], value)
    else out[tag] = value
  }
  if (!matched) return unescapeXml(inner)
  // A wrapper element holding a single repeated child (`<tags><tag/>…`) IS the
  // array the JSON body would have had.
  const keys = Object.keys(out)
  return keys.length === 1 && FORM_ARRAY_KEYS_PARENT[keys[0]] ? [].concat(out[keys[0]]) : out
}

// Item tag → the wrapper that means "this is an array" in the demo schema.
const FORM_ARRAY_KEYS_PARENT = { photoUrl: true, tag: true }

function unescapeXml(value) {
  return value
    .trim()
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}

function mediaEssence(request) {
  return (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
}

// Keys the demo schema types as arrays. A form body is flat, so their value
// arrives either as repeated keys or as the single comma-separated string the
// try-it's field editor produces — both come back as the array the rest of
// the mock expects. Splitting is limited to those keys on purpose: a caption
// with a comma in it is a caption, not a list.
const FORM_ARRAY_KEYS = new Set(['photoUrls', 'tags'])

function fromParams(params) {
  const out = {}
  for (const [key, raw] of params.entries()) {
    // A File part: kept as-is, there is nothing to coerce.
    const value = typeof raw === 'string' ? coerceFormValue(key, raw) : raw
    if (key in out) out[key] = [].concat(out[key], value)
    else out[key] = value
  }
  return out
}

function coerceFormValue(key, raw) {
  if (FORM_ARRAY_KEYS.has(key)) return raw.split(',').map((v) => v.trim())
  return /^-?\d+$/.test(raw) ? Number(raw) : raw
}

// --- pet --------------------------------------------------------------------

async function addPet({ request }) {
  const body = await readBody(request)
  if (!body?.name || !body?.photoUrls) return problem(400, '`name` and `photoUrls` are required')
  const created = { ...body, id: body.id ?? state.nextPetId++, status: body.status ?? 'available' }
  state.pets.set(created.id, created)
  return json(created)
}

async function updatePet({ request }) {
  const body = await readBody(request)
  if (!body?.id) return problem(400, '`id` is required to update a pet')
  if (!state.pets.has(body.id)) return problem(404, 'Pet not found')
  const updated = { ...state.pets.get(body.id), ...body }
  state.pets.set(updated.id, updated)
  return json(updated)
}

const PET_STATUSES = ['available', 'pending', 'sold']

// Paginated so the strip has `Link` rels to offer — the follow button sends
// the URL the server built, literally. The schema declares `page` too, so the
// docs' pagination guide and the rendered parameters say the same thing. One
// pet per page because the playground holds four of them in total — any
// larger and the demo would have a single page, which demonstrates nothing.
const PAGE_SIZE = 1

function findPetsByStatus({ url }) {
  const status = url.searchParams.get('status')
  if (!PET_STATUSES.includes(status)) return problem(400, 'Invalid status value')
  const all = [...state.pets.values()].filter((p) => p.status === status)
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), pages)
  const link = (rel, n) => `<${pageUrl(url, n)}>; rel="${rel}"`
  const rels = [link('first', 1), link('last', pages)]
  if (page < pages) rels.unshift(link('next', page + 1))
  if (page > 1) rels.unshift(link('prev', page - 1))
  return json(all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), {
    headers: { link: rels.join(', ') },
  })
}

function pageUrl(url, page) {
  const next = new URL(url)
  next.searchParams.set('page', String(page))
  return next.href
}

// Deprecated in the schema too — the point of the header is that the *server*
// says so, live, and names the date it goes away (RFC 9745 + RFC 8594).
const SUNSET_AT = Date.UTC(2027, 0, 1) / 1000

function findPetsByTags({ url }) {
  // `explode: true`, so repeated pairs rather than one comma-joined value.
  const wanted = url.searchParams.getAll('tags').flatMap((v) => v.split(','))
  if (!wanted.length) return problem(400, 'Invalid tag value')
  return json(
    [...state.pets.values()].filter((p) => p.tags?.some((tag) => wanted.includes(tag.name))),
    {
      headers: {
        deprecation: `@${SUNSET_AT - 365 * 24 * 3600}`,
        sunset: new Date(SUNSET_AT * 1000).toUTCString(),
      },
    },
  )
}

// `in: querystring` parameter: the raw query string is an RSQL expression, so
// it is read as-is instead of as name/value pairs. Supported subset:
// `field==value`, `field!=value`, `field=in=(a,b)`, joined by `;`.
function filterPets({ url }) {
  const raw = url.search.replace(/^\?/, '')
  if (!raw) return json([...state.pets.values()])
  // A hand-written filter is not necessarily percent-encoded, and an
  // isolated `%` makes decodeURIComponent throw.
  let expression = raw
  try {
    expression = decodeURIComponent(raw)
  } catch {
    // Read verbatim.
  }
  const constraints = []
  for (const clause of expression.split(';')) {
    const parsed = /^([a-z]+)(==|!=|=in=)(.+)$/i.exec(clause.trim())
    if (!parsed) return problem(400, `Unparsable RSQL constraint: ${clause}`)
    const [, field, operator, rawValue] = parsed
    const values = rawValue.replace(/^\(|\)$/g, '').split(',')
    constraints.push({ field, operator, values })
  }
  return json([...state.pets.values()].filter((p) => constraints.every((c) => satisfies(p, c))))
}

function satisfies(pet, { field, operator, values }) {
  const actual =
    field === 'tags'
      ? (pet.tags ?? []).map((tag) => tag.name)
      : field === 'category'
        ? [pet.category?.name]
        : [pet[field]]
  const hit = actual.some((value) => values.includes(String(value)))
  return operator === '!=' ? !hit : hit
}

async function searchPets({ request }) {
  const criteria = (await readBody(request)) ?? {}
  const wantedStatus = criteria.status ?? []
  const wantedTags = criteria.tags ?? []
  const found = [...state.pets.values()].filter((p) => {
    if (criteria.name && !p.name.toLowerCase().includes(String(criteria.name).toLowerCase()))
      return false
    if (wantedStatus.length && !wantedStatus.includes(p.status)) return false
    if (wantedTags.length && !(p.tags ?? []).some((tag) => wantedTags.includes(tag.name)))
      return false
    return true
  })
  return json(found.slice(0, criteria.limit ?? 20))
}

function findPet(params) {
  return state.pets.get(Number(params.petId))
}

// The stable resource of the demo: it carries a validator, and honours the
// conditional replay the strip offers.
function getPetById({ params, request }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  const etag = etagOf(found)
  if (request.headers.get('if-none-match') === etag) return notModified(etag)
  return json(found, { headers: { etag } })
}

function updatePetWithForm({ params, url }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  const name = url.searchParams.get('name')
  const status = url.searchParams.get('status')
  if (status && !PET_STATUSES.includes(status)) return problem(400, 'Invalid status value')
  const updated = { ...found, ...(name ? { name } : {}), ...(status ? { status } : {}) }
  state.pets.set(updated.id, updated)
  return json(updated)
}

function deletePet({ params }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  state.pets.delete(found.id)
  return noBody()
}

// The only endpoint of the demo whose body is a file, and it declares both
// spellings: raw bytes (`application/octet-stream`) or a multipart form
// carrying the same file plus a caption. The response names what actually
// arrived — that's how the demo shows the upload really happened rather than
// just returning 200 to anything.
async function uploadFile({ params, url, request }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  const type = mediaEssence(request)
  let bytes = 0
  let fileName = `${found.name}.png`
  let caption = null
  if (type === 'multipart/form-data') {
    const form = await request.formData()
    const file = form.get('file')
    // A missing part reads back as null, a text part as a string: neither is
    // the file the schema marks required.
    if (!file || typeof file === 'string') return problem(400, 'No file uploaded')
    bytes = file.size
    if (file.name) fileName = file.name
    caption = form.get('caption') || null
  } else {
    bytes = (await request.arrayBuffer()).byteLength
  }
  if (!bytes) return problem(400, 'No file uploaded')
  const metadata = url.searchParams.get('additionalMetadata')
  return json({
    code: 200,
    type: type || 'unknown',
    message: [
      metadata ? `additionalMetadata: ${metadata}` : null,
      caption ? `caption: ${caption}` : null,
      `File uploaded to ./${fileName}, ${bytes} bytes`,
    ]
      .filter(Boolean)
      .join('\n'),
  })
}

async function subscribeToPet({ params, request }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  const body = await readBody(request)
  if (!body?.callbackUrl) return problem(400, '`callbackUrl` is required')
  // Registered and echoed back, never called: a service worker delivering
  // webhooks to a third-party URL would be a surprising thing for a demo to
  // do. The webhook simulator is how deliveries are exercised.
  const subscription = {
    id: crypto.randomUUID(),
    petId: found.id,
    callbackUrl: body.callbackUrl,
    events: body.events ?? ['status.changed', 'order.placed'],
    createdAt: new Date().toISOString(),
  }
  state.subscriptions.set(subscription.id, subscription)
  return json(subscription, { status: 201 })
}

// Sequential media type (3.2 `itemSchema`): a finite SSE stream, so the
// try-it's streaming reader shows a body growing and then a completed
// request — an endless one would leave the panel spinning forever.
function streamPetEvents({ params }) {
  const found = findPet(params)
  if (!found) return problem(404, 'Pet not found')
  const encoder = new TextEncoder()
  let sent = 0
  let previousStatus = found.status
  const stream = new ReadableStream({
    async pull(controller) {
      if (sent >= PET_STATUSES.length) return controller.close()
      if (sent > 0) await sleep(400)
      const status = PET_STATUSES[sent]
      const event = {
        eventId: crypto.randomUUID(),
        petId: found.id,
        name: found.name,
        status,
        previousStatus,
        changedAt: new Date().toISOString(),
      }
      previousStatus = status
      sent++
      controller.enqueue(
        encoder.encode(`event: status.changed\ndata: ${JSON.stringify(event)}\n\n`),
      )
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  })
}

// --- failure showcase -------------------------------------------------------
//
// The `errors` tag exists to demonstrate how the app renders failure, so each
// handler here really produces what the schema declares — a 500 is a 500, not
// a 200 wearing a costume. The literal demo token below is the value the demo
// pages prefill as `auth.bearerAuth`: the first place those environment
// variables visibly matter.

const DEMO_BEARER = 'demo-bearer-token'

function bearerOf(request) {
  const header = request.headers.get('authorization') ?? ''
  return /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? null
}

function failServerError() {
  return problem(500, 'Deliberate internal error — this endpoint always breaks')
}

function failUnavailable() {
  return json(
    {
      code: 503,
      type: 'unavailable',
      message: 'Deliberately unavailable — retry after the delay below',
    },
    { status: 503, headers: { 'retry-after': '30' } },
  )
}

// Unlike the global counter (which clamps at 0 and keeps answering), this
// endpoint's quota is permanently spent: the rejection branch of rate
// limiting, actually taken.
function failRateLimit() {
  const now = Date.now()
  if (now >= quota.resetAt) quota = { remaining: RATE_LIMIT, resetAt: now + RATE_WINDOW_MS }
  quota.remaining = 0
  const resetSeconds = Math.max(1, Math.ceil((quota.resetAt - now) / 1000))
  return json(
    { code: 429, type: 'rate_limited', message: 'Out of quota for this window' },
    { status: 429, headers: { 'retry-after': String(resetSeconds) } },
  )
}

function failProtected({ request }) {
  if (bearerOf(request) !== DEMO_BEARER) {
    return json(
      { code: 401, type: 'unauthorized', message: 'Missing or invalid bearer token' },
      { status: 401, headers: { 'www-authenticate': 'Bearer' } },
    )
  }
  return json({ message: 'Authenticated as the demo token.' })
}

// Authentication is not authorization: the valid token still gets a 403.
function failForbidden({ request }) {
  if (bearerOf(request) !== DEMO_BEARER) {
    return json(
      { code: 401, type: 'unauthorized', message: 'Missing or invalid bearer token' },
      { status: 401, headers: { 'www-authenticate': 'Bearer' } },
    )
  }
  return problem(403, 'Authenticated, but this scope is granted to nobody')
}

async function failValidation({ request }) {
  let body = null
  try {
    body = await readBody(request)
  } catch {
    // Unreadable body: reported below as field errors, not as a parse crash.
  }
  const errors = []
  const email = body?.email
  const quantity = body?.quantity
  if (typeof email !== 'string' || !email.includes('@'))
    errors.push({ field: 'email', pointer: '/email', message: 'must be a valid email address' })
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1)
    errors.push({
      field: 'quantity',
      pointer: '/quantity',
      message: 'must be an integer of at least 1',
    })
  if (errors.length) {
    return json(
      { code: 422, type: 'validation', message: 'The request body is invalid.', errors },
      { status: 422 },
    )
  }
  return json({ status: 'valid' })
}

// ~4 s total: long enough for the send meter to be legible, short enough that
// nobody gives up. The base latency was already paid in handle().
async function failSlow() {
  await sleep(3900)
  return json({ message: 'Worth the wait.' })
}

// Declares JSON, ships truncated bytes: the response view's raw-body fallback.
function failMalformed() {
  return new Response('{"pets": [{"id": 10, "name": "dog', {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'server-timing': `mock;dur=${LATENCY_MS}`,
    },
  })
}

// Accepted, never answered: the cancel control's demo. (/failures/unreachable
// and /failures/cors never reach this worker — they pin operation-level
// servers on other origins, which is their whole point.)
function failHang() {
  return new Promise(() => {})
}

// --- store ------------------------------------------------------------------

function getInventory() {
  const counts = {}
  for (const p of state.pets.values()) counts[p.status] = (counts[p.status] ?? 0) + 1
  return json(counts)
}

function purgeInventory() {
  return noBody(204)
}

async function placeOrder({ request }) {
  const body = await readBody(request)
  if (!body?.petId) return problem(400, '`petId` is required')
  if (!state.pets.has(Number(body.petId))) return problem(422, `No pet with id ${body.petId}`)
  const created = {
    id: body.id ?? state.nextOrderId++,
    petId: Number(body.petId),
    quantity: body.quantity ?? 1,
    shipDate: body.shipDate ?? new Date(Date.now() + 86_400_000).toISOString(),
    status: body.status ?? 'placed',
    complete: body.complete ?? false,
  }
  state.orders.set(created.id, created)
  return json(created)
}

function getOrderById({ params }) {
  const found = state.orders.get(Number(params.orderId))
  return found ? json(found) : problem(404, 'Order not found')
}

function deleteOrder({ params }) {
  const found = state.orders.get(Number(params.orderId))
  if (!found) return problem(404, 'Order not found')
  state.orders.delete(found.id)
  return noBody()
}

// --- user -------------------------------------------------------------------

async function createUser({ request }) {
  const body = await readBody(request)
  if (!body?.username) return problem(400, '`username` is required')
  const created = { ...body, id: body.id ?? state.nextUserId++ }
  state.users.set(created.username, created)
  return json(created)
}

async function createUsersWithListInput({ request }) {
  const body = await readBody(request)
  if (!Array.isArray(body) || !body.length) return problem(400, 'Expected a non-empty user array')
  let last = null
  for (const entry of body) {
    if (!entry?.username) continue
    last = { ...entry, id: entry.id ?? state.nextUserId++ }
    state.users.set(last.username, last)
  }
  return last ? json(last) : problem(400, 'No user carried a `username`')
}

function loginUser({ url }) {
  const username = url.searchParams.get('username')
  const found = username ? state.users.get(username) : null
  if (!found) return problem(400, 'Invalid username/password supplied')
  return json(`logged in user session:${Date.now()}`, {
    headers: {
      'x-rate-limit': '5000',
      'x-expires-after': new Date(Date.now() + 3_600_000).toISOString(),
    },
  })
}

function logoutUser() {
  return noBody()
}

function getUserByName({ params }) {
  const found = state.users.get(params.username)
  return found ? json(found) : problem(404, 'User not found')
}

async function updateUser({ params, request }) {
  const found = state.users.get(params.username)
  if (!found) return problem(404, 'User not found')
  const body = (await readBody(request)) ?? {}
  const updated = { ...found, ...body }
  state.users.delete(params.username)
  state.users.set(updated.username, updated)
  return noBody()
}

function deleteUser({ params }) {
  if (!state.users.has(params.username)) return problem(404, 'User not found')
  state.users.delete(params.username)
  return noBody()
}
