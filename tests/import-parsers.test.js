import { describe, expect, it } from 'vitest'
import { parseCurl } from '../src/import/curl.js'
import { parseHar } from '../src/import/har.js'
import { detectFormat, parseImport } from '../src/import/index.js'
import { parsePostman } from '../src/import/postman.js'

// The three importers, read as parsers only: what each format says, turned into
// the one draft shape. Which OPERATION a draft belongs to is `import-match`'s
// business — nothing here knows a model exists.

const one = (result) => {
  expect(result.errors).toEqual([])
  expect(result.requests).toHaveLength(1)
  return result.requests[0]
}

describe('parseCurl — quoting', () => {
  it('reads a multiline command with continuations', () => {
    const draft = one(
      parseCurl(`curl -X POST 'https://api.test/v1/pets' \\
  -H 'Content-Type: application/json' \\
  --data '{"name":"Rex"}'`),
    )
    expect(draft.method).toBe('POST')
    expect(draft.url).toBe('https://api.test/v1/pets')
    expect(draft.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }])
    expect(draft.body).toBe('{"name":"Rex"}')
    expect(draft.bodyMode).toBe('raw')
  })

  it("undoes the POSIX '\\'' escape our own export writes", () => {
    // shellQuote('it's') === "'it'\''s'" — the exact string that comes back.
    const draft = one(parseCurl(`curl 'https://api.test/pets' -H 'X-Note: it'\\''s fine'`))
    expect(draft.headers).toEqual([{ name: 'X-Note', value: "it's fine" }])
  })

  it('honours double-quote escapes and leaves the rest alone', () => {
    const draft = one(parseCurl(`curl "https://api.test/pets" -d "{\\"a\\":\\"b\\\\c\\"}"`))
    expect(draft.body).toBe('{"a":"b\\c"}')
  })

  it('takes an unterminated quote for what is left of the line', () => {
    const draft = one(parseCurl(`curl 'https://api.test/pets`))
    expect(draft.url).toBe('https://api.test/pets')
  })
})

describe('parseCurl — flags', () => {
  it('reads attached short arguments and long ones with =', () => {
    const draft = one(parseCurl(`curl -XPUT --url=https://api.test/pets/7 -H'X-A: 1'`))
    expect(draft.method).toBe('PUT')
    expect(draft.url).toBe('https://api.test/pets/7')
    expect(draft.headers).toEqual([{ name: 'X-A', value: '1' }])
  })

  it('repeats headers and concatenates data the way curl does', () => {
    const draft = one(parseCurl(`curl https://api.test/pets -H 'A: 1' -H 'B: 2' -d a=1 -d b=2`))
    expect(draft.headers).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ])
    expect(draft.body).toBe('a=1&b=2')
    // No -X and something to send: curl's own default.
    expect(draft.method).toBe('POST')
  })

  it('url-encodes only the value of --data-urlencode', () => {
    const draft = one(parseCurl(`curl https://api.test/pets --data-urlencode 'note=a b&c'`))
    expect(draft.body).toBe('note=a%20b%26c')
  })

  it('moves the data into the query for -G', () => {
    const draft = one(parseCurl(`curl -G https://api.test/pets -d status=sold`))
    expect(draft.url).toBe('https://api.test/pets?status=sold')
    expect(draft.body).toBeNull()
    expect(draft.method).toBe('GET')
  })

  it('reads form fields, files included', () => {
    const draft = one(
      parseCurl(`curl https://api.test/upload -F name=Rex -F 'photo=@dog.png;type=image/png'`),
    )
    expect(draft.fields).toEqual([
      { name: 'name', value: 'Rex', fileName: undefined },
      { name: 'photo', value: '', fileName: 'dog.png' },
    ])
    expect(draft.bodyMode).toBe('formdata')
  })

  it('turns -u into a basic credential', () => {
    const draft = one(parseCurl(`curl https://api.test/pets -u alice:s3cret`))
    expect(draft.auth).toEqual({ scheme: 'basic', username: 'alice', password: 's3cret' })
  })

  it('swallows a no-argument cluster and warns about what it does not know', () => {
    const draft = one(parseCurl(`curl -sSL --compressed --frobnicate https://api.test/pets`))
    expect(draft.warnings).toEqual([{ code: 'curl-flag-ignored', flag: '--frobnicate' }])
    expect(draft.url).toBe('https://api.test/pets')
  })

  it('drops cookies with a warning rather than building a request the browser strips', () => {
    const draft = one(parseCurl(`curl https://api.test/pets -b 'session=abc'`))
    expect(draft.warnings).toEqual([{ code: 'import-cookie-dropped', value: 'session=abc' }])
  })

  it("does not mistake an unknown flag's argument for the URL", () => {
    const draft = one(parseCurl(`curl --frobnicate later https://api.test/pets`))
    expect(draft.url).toBe('https://api.test/pets')
  })

  it('reports an unusable command instead of throwing', () => {
    expect(parseCurl('curl -X POST').errors).toEqual([{ code: 'curl-no-url' }])
    expect(parseCurl('   ').errors).toEqual([{ code: 'import-empty' }])
    expect(parseCurl(null).errors).toEqual([{ code: 'import-empty' }])
  })
})

describe('parsePostman', () => {
  const collection = (items, extra = {}) => ({
    info: {
      name: 'C',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    ...extra,
  })

  it('flattens the folder tree and reads a raw body', () => {
    const result = parsePostman(
      collection([
        {
          name: 'Folder',
          item: [
            {
              name: 'Create',
              request: {
                method: 'post',
                url: { raw: 'https://api.test/v1/pets' },
                header: [
                  { key: 'Content-Type', value: 'application/json' },
                  { key: 'X-Off', value: '1', disabled: true },
                ],
                body: { mode: 'raw', raw: '{"name":"Rex"}' },
              },
            },
          ],
        },
      ]),
    )
    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    const draft = result.requests[0]
    expect(draft.name).toBe('Create')
    expect(draft.method).toBe('POST')
    expect(draft.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }])
    expect(draft.body).toBe('{"name":"Rex"}')
  })

  it('rebuilds a URL from its parts when there is no raw', () => {
    const draft = one(
      parsePostman(
        collection([
          {
            name: 'List',
            request: {
              method: 'GET',
              url: {
                protocol: 'https',
                host: ['api', 'test'],
                path: ['v1', 'pets'],
                query: [
                  { key: 'status', value: 'sold' },
                  { key: 'skip', value: '1', disabled: true },
                ],
              },
            },
          },
        ]),
      ),
    )
    expect(draft.url).toBe('https://api.test/v1/pets?status=sold')
  })

  it('substitutes the path variables it carries values for', () => {
    const draft = one(
      parsePostman(
        collection([
          {
            name: 'Read',
            request: {
              method: 'GET',
              url: {
                raw: 'https://api.test/v1/pets/:petId',
                variable: [{ key: 'petId', value: '7' }],
              },
            },
          },
        ]),
      ),
    )
    expect(draft.url).toBe('https://api.test/v1/pets/7')
  })

  it('reads each body mode', () => {
    const modes = parsePostman(
      collection([
        {
          name: 'urlencoded',
          request: {
            method: 'POST',
            url: 'https://api.test/a',
            body: { mode: 'urlencoded', urlencoded: [{ key: 'name', value: 'Rex' }] },
          },
        },
        {
          name: 'formdata',
          request: {
            method: 'POST',
            url: 'https://api.test/b',
            body: {
              mode: 'formdata',
              formdata: [{ key: 'photo', type: 'file', src: '/home/me/dog.png' }],
            },
          },
        },
        {
          name: 'file',
          request: {
            method: 'POST',
            url: 'https://api.test/c',
            body: { mode: 'file', file: { src: 'x.bin' } },
          },
        },
        {
          name: 'graphql',
          request: {
            method: 'POST',
            url: 'https://api.test/d',
            body: { mode: 'graphql', graphql: { query: '{ pets { id } }' } },
          },
        },
      ]),
    ).requests
    expect(modes[0].fields).toEqual([{ name: 'name', value: 'Rex', fileName: undefined }])
    expect(modes[0].bodyMode).toBe('urlencoded')
    expect(modes[1].fields).toEqual([{ name: 'photo', value: '', fileName: 'dog.png' }])
    expect(modes[2].warnings).toEqual([{ code: 'import-file-body', name: 'x.bin' }])
    expect(modes[3].body).toBe('{"query":"{ pets { id } }"}')
  })

  it('maps the three auth types and warns about the others', () => {
    const drafts = parsePostman(
      collection([
        {
          name: 'basic',
          request: {
            url: 'https://api.test/a',
            auth: {
              type: 'basic',
              basic: [
                { key: 'username', value: 'alice' },
                { key: 'password', value: 'pw' },
              ],
            },
          },
        },
        {
          name: 'bearer',
          request: {
            url: 'https://api.test/b',
            auth: { type: 'bearer', bearer: [{ key: 'token', value: 'tok' }] },
          },
        },
        {
          name: 'apikey',
          request: {
            url: 'https://api.test/c',
            auth: {
              type: 'apikey',
              apikey: [
                { key: 'key', value: 'X-Key' },
                { key: 'value', value: 'k-1' },
                { key: 'in', value: 'header' },
              ],
            },
          },
        },
        {
          name: 'awsv4',
          request: { url: 'https://api.test/d', auth: { type: 'awsv4', awsv4: [] } },
        },
      ]),
    ).requests
    expect(drafts[0].auth).toEqual({ scheme: 'basic', username: 'alice', password: 'pw' })
    expect(drafts[1].auth).toEqual({ scheme: 'bearer', token: 'tok' })
    expect(drafts[2].auth).toEqual({ scheme: 'apikey', name: 'X-Key', value: 'k-1', in: 'header' })
    expect(drafts[3].auth).toBeNull()
    expect(drafts[3].warnings).toEqual([{ code: 'import-auth-unsupported', scheme: 'awsv4' }])
  })

  it('surfaces collection variables instead of creating environments', () => {
    const result = parsePostman(
      collection([{ name: 'a', request: { url: 'https://api.test/a' } }], {
        variable: [{ key: 'baseUrl', value: 'https://api.test' }],
      }),
    )
    expect(result.warnings).toEqual([{ code: 'postman-variable', name: 'baseUrl' }])
  })

  it('reads a collection declaring another schema, and says so', () => {
    const result = parsePostman({
      info: { schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' },
      item: [{ name: 'a', request: { url: 'https://api.test/a' } }],
    })
    expect(result.requests).toHaveLength(1)
    expect(result.warnings[0].code).toBe('postman-schema-unknown')
  })

  it('reports bad input rather than throwing', () => {
    expect(parsePostman('{oops').errors).toEqual([{ code: 'import-invalid-json' }])
    expect(parsePostman({ hello: 1 }).errors).toEqual([{ code: 'postman-invalid' }])
    expect(parsePostman(collection([])).errors).toEqual([{ code: 'import-no-request' }])
  })
})

describe('parseHar', () => {
  const har = (requests) => ({
    log: { version: '1.2', entries: requests.map((request) => ({ request })) },
  })

  it('reads entries, headers and a text body', () => {
    const draft = one(
      parseHar(
        har([
          {
            method: 'POST',
            url: 'https://api.test/v1/pets?dry=1',
            headers: [
              { name: ':authority', value: 'api.test' },
              { name: 'content-type', value: 'application/json' },
            ],
            postData: { mimeType: 'application/json', text: '{"name":"Rex"}' },
          },
        ]),
      ),
    )
    expect(draft.method).toBe('POST')
    expect(draft.name).toBe('POST /v1/pets?dry=1')
    // Pseudo-headers survive the parser; `match.js` is what drops them.
    expect(draft.headers.map((h) => h.name)).toEqual([':authority', 'content-type'])
    expect(draft.body).toBe('{"name":"Rex"}')
  })

  it('prefers the recorded params over the recorded text', () => {
    const draft = one(
      parseHar(
        har([
          {
            method: 'POST',
            url: 'https://api.test/a',
            postData: {
              mimeType: 'multipart/form-data',
              params: [
                { name: 'name', value: 'Rex' },
                { name: 'photo', fileName: 'dog.png' },
              ],
              text: 'ignored',
            },
          },
        ]),
      ),
    )
    expect(draft.bodyMode).toBe('formdata')
    expect(draft.fields).toEqual([
      { name: 'name', value: 'Rex', fileName: undefined },
      { name: 'photo', value: '', fileName: 'dog.png' },
    ])
  })

  it('drops the session cookies with a warning', () => {
    const draft = one(
      parseHar(
        har([{ method: 'GET', url: 'https://api.test/a', cookies: [{ name: 'sid', value: 'x' }] }]),
      ),
    )
    expect(draft.warnings).toEqual([{ code: 'import-cookie-dropped', value: 'sid' }])
  })

  it('reports bad input rather than throwing', () => {
    expect(parseHar({ log: {} }).errors).toEqual([{ code: 'har-invalid' }])
    expect(parseHar('nope').errors).toEqual([{ code: 'import-invalid-json' }])
    expect(parseHar(har([])).errors).toEqual([{ code: 'import-no-request' }])
  })
})

describe('detectFormat / parseImport', () => {
  it('reads the content, never the extension', () => {
    expect(detectFormat('curl https://api.test/a')).toBe('curl')
    expect(detectFormat('{"log":{"entries":[]}}')).toBe('har')
    expect(detectFormat('{"item":[]}')).toBe('postman')
    expect(detectFormat('{"hello":1}')).toBeNull()
    expect(detectFormat('  ')).toBeNull()
  })

  it('dispatches and keeps the format it chose', () => {
    const result = parseImport('curl https://api.test/pets')
    expect(result.format).toBe('curl')
    expect(result.requests[0].url).toBe('https://api.test/pets')
    expect(parseImport('{"hello":1}').errors).toEqual([{ code: 'import-format-unknown' }])
    expect(parseImport('').errors).toEqual([{ code: 'import-empty' }])
  })
})
