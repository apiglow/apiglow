import { describe, expect, it } from 'vitest'
import {
  applyExtracts,
  evaluateExpect,
  headerValue,
  statusMatches,
} from '../src/scenarios/evaluate.js'

const response = (over = {}) => ({
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'application/json']],
  body: '{"id":7,"token":"abc","nested":{"list":[1,2]},"nil":null,"blank":""}',
  ...over,
})

describe('statusMatches', () => {
  it('requires 2xx by default', () => {
    expect(statusMatches(undefined, 201)).toBe(true)
    expect(statusMatches(undefined, 404)).toBe(false)
    expect(statusMatches(undefined, 302)).toBe(false)
  })

  it('accepts an exact code or a class', () => {
    expect(statusMatches(201, 201)).toBe(true)
    expect(statusMatches(201, 200)).toBe(false)
    expect(statusMatches('4xx', 422)).toBe(true)
    expect(statusMatches('4xx', 500)).toBe(false)
  })
})

describe('evaluateExpect', () => {
  it('validates a 2xx with no declared criteria', () => {
    const verdict = evaluateExpect(null, response())
    expect(verdict.ok).toBe(true)
    expect(verdict.checks).toHaveLength(1)
    expect(verdict.checks[0]).toMatchObject({ kind: 'status', expected: '2xx', actual: 200 })
  })

  it('reports the expected and actual value on an unexpected status', () => {
    const verdict = evaluateExpect({ status: 201 }, response({ status: 500 }))
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[0]).toMatchObject({ ok: false, expected: 201, actual: 500 })
  })

  it('evaluates exists and equals on the JSON body', () => {
    const verdict = evaluateExpect(
      {
        assertions: [
          { pointer: '/token', op: 'exists' },
          { pointer: '/id', op: 'equals', value: 7 },
          { pointer: '/nested/list/1', op: 'equals', value: 2 },
        ],
      },
      response(),
    )
    expect(verdict.ok).toBe(true)
    expect(verdict.checks).toHaveLength(4)
  })

  it('loosely compares the entered text and the typed JSON', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/id', op: 'equals', value: '7' }] },
      response(),
    )
    expect(verdict.ok).toBe(true)
  })

  it('ignores a criteria row whose pointer is not filled in', () => {
    const verdict = evaluateExpect(
      {
        assertions: [
          { pointer: '', op: 'equals', value: '' },
          { pointer: '  ', op: 'exists' },
        ],
      },
      response(),
    )
    expect(verdict.ok).toBe(true)
    expect(verdict.checks).toHaveLength(1)
  })

  it('checks a null value the way the ✓ writes it', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/nil', op: 'equals', value: 'null' }] },
      response(),
    )
    expect(verdict.ok).toBe(true)
  })

  it('fails explicitly when the pointer leads nowhere', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/absent', op: 'exists' }] },
      response(),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[1]).toMatchObject({ ok: false, code: 'pointer-not-found' })
  })

  it('passes a jsonpath assertion that selects at least one node', () => {
    const assertions = [{ op: 'matches', query: '$.pets[*]' }]
    expect(evaluateExpect({ assertions }, response({ body: '{"pets":[{"id":1}]}' })).ok).toBe(true)
    expect(evaluateExpect({ assertions }, response({ body: '{"pets":[]}' })).ok).toBe(false)
  })

  it("runs the spec's own example, with RFC 9535 semantics for count()", () => {
    // `$[?count(@.pets) > 0]` (spec.openapis.org/arazzo/v1.1.0.html) filters
    // the root's children on "has a `pets` member" — `count()` sizes the
    // nodelist `@.pets` selects, not the array it may hold. An empty `pets`
    // still passes; no `pets` at all is what fails.
    const assertions = [{ op: 'matches', query: '$[?count(@.pets) > 0]' }]
    expect(evaluateExpect({ assertions }, response({ body: '{"store":{"pets":[]}}' })).ok).toBe(
      true,
    )
    expect(evaluateExpect({ assertions }, response({ body: '{"store":{}}' })).ok).toBe(false)
  })

  it('fails a jsonpath assertion whose nodelist is empty, with no code', () => {
    const verdict = evaluateExpect(
      { assertions: [{ op: 'matches', query: '$.absent' }] },
      response(),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[1]).toMatchObject({ ok: false, op: 'matches', query: '$.absent' })
    expect(verdict.checks[1].code).toBeUndefined()
  })

  it('fails a malformed query instead of throwing', () => {
    const verdict = evaluateExpect({ assertions: [{ op: 'matches', query: '$[' }] }, response())
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[1]).toMatchObject({ ok: false, code: 'query-invalid' })
  })

  it('ignores a jsonpath row whose query is not filled in', () => {
    const verdict = evaluateExpect({ assertions: [{ op: 'matches', query: '  ' }] }, response())
    expect(verdict.ok).toBe(true)
    expect(verdict.checks).toHaveLength(1)
  })

  it('matches a regex assertion against the pointed-at value, unanchored', () => {
    const at = (value) => ({ assertions: [{ pointer: '/token', op: 'regex', value }] })
    expect(evaluateExpect(at('^abc$'), response()).ok).toBe(true)
    // Unanchored is the spec's semantics: a scenario wanting anchors writes them.
    expect(evaluateExpect(at('b'), response()).ok).toBe(true)
    expect(evaluateExpect(at('^b'), response()).ok).toBe(false)
  })

  it('tests a value as the same text equals would compare', () => {
    // The JSON number 7 and the serialized object, not "[object Object]".
    expect(
      evaluateExpect({ assertions: [{ pointer: '/id', op: 'regex', value: '^7$' }] }, response())
        .ok,
    ).toBe(true)
    expect(
      evaluateExpect(
        { assertions: [{ pointer: '/nested', op: 'regex', value: '"list":\\[1,2\\]' }] },
        response(),
      ).ok,
    ).toBe(true)
  })

  it('fails an invalid pattern instead of throwing', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/token', op: 'regex', value: '[' }] },
      response(),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[1]).toMatchObject({ ok: false, code: 'pattern-invalid' })
  })

  it('refuses to match against a value too long to be safe', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/big', op: 'regex', value: '(a+)+b' }] },
      response({ body: JSON.stringify({ big: 'a'.repeat(100_001) }) }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.checks[1]).toMatchObject({ ok: false, code: 'value-too-long' })
  })

  it('ignores a regex row whose pattern is not filled in', () => {
    // The empty pattern is a valid RegExp matching everything: left active, a
    // half-filled row would make the step pass while checking nothing.
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/token', op: 'regex', value: '' }] },
      response(),
    )
    expect(verdict.ok).toBe(true)
    expect(verdict.checks).toHaveLength(1)
  })

  it('fails explicitly when the body is not JSON', () => {
    const verdict = evaluateExpect(
      { assertions: [{ pointer: '/id', op: 'exists' }] },
      response({ body: '<html>oops</html>' }),
    )
    expect(verdict.checks[1]).toMatchObject({ ok: false, code: 'body-not-json' })
  })
})

describe('headerValue', () => {
  it('looks up case-insensitively', () => {
    const res = response({ headers: [['Location', '/pets/7']] })
    expect(headerValue(res, 'location')).toEqual({ found: true, value: '/pets/7' })
    expect(headerValue(res, 'LOCATION').found).toBe(true)
    expect(headerValue(res, 'etag').found).toBe(false)
  })
})

describe('applyExtracts', () => {
  it('produces the run-scope variables', () => {
    const { values, results, ok } = applyExtracts(
      [
        { name: 'petId', source: 'body', pointer: '/id' },
        { name: 'auth.token', source: 'body', pointer: '/token', persist: true, sensitive: true },
      ],
      response(),
    )
    expect(ok).toBe(true)
    // Always strings: that is what interpolation substitutes.
    expect(values).toEqual({
      petId: { value: '7', sensitive: false },
      'auth.token': { value: 'abc', sensitive: true },
    })
    expect(results[0]).toMatchObject({ ok: true, raw: 7, value: '7' })
  })

  it('serializes an extracted object', () => {
    const { values } = applyExtracts([{ name: 'nested', pointer: '/nested' }], response())
    expect(values.nested.value).toBe('{"list":[1,2]}')
  })

  it('reads a header', () => {
    const { values } = applyExtracts(
      [{ name: 'loc', source: 'header', pointer: 'Location' }],
      response({ headers: [['location', '/pets/7']] }),
    )
    expect(values.loc.value).toBe('/pets/7')
  })

  it('reports the failed extraction and leaves the variable missing', () => {
    const { values, results, ok } = applyExtracts(
      [
        { name: 'a', pointer: '/absent' },
        { name: 'b', pointer: '/nil' },
        { name: 'c', pointer: '/blank' },
        { name: 'd', source: 'header', pointer: 'etag' },
      ],
      response(),
    )
    expect(ok).toBe(false)
    expect(values).toEqual({})
    expect(results.map((r) => r.code)).toEqual([
      'pointer-not-found',
      'value-empty',
      'value-empty',
      'header-missing',
    ])
  })

  it('extracts the first node a query selects', () => {
    const body = '{"pets":[{"id":7},{"id":9}]}'
    const { values } = applyExtracts(
      [{ name: 'petId', source: 'body', query: '$.pets[*].id' }],
      response({ body }),
    )
    // First wins — the same rule the Overlay resolution applies when it needs
    // one node from a query.
    expect(values.petId.value).toBe('7')
  })

  it('fails a query that selects nothing, and one that cannot compile', () => {
    const { results, values } = applyExtracts(
      [
        { name: 'a', source: 'body', query: '$.absent' },
        { name: 'b', source: 'body', query: '$[' },
      ],
      response(),
    )
    expect(results.map((r) => r.code)).toEqual(['query-no-match', 'query-invalid'])
    expect(values).toEqual({})
  })

  it('serializes a query-extracted object the way a pointer-extracted one is', () => {
    const { values } = applyExtracts(
      [
        { name: 'byQuery', source: 'body', query: '$.nested' },
        { name: 'byPointer', source: 'body', pointer: '/nested' },
      ],
      response(),
    )
    expect(values.byQuery.value).toBe(values.byPointer.value)
  })

  it('reports a non-JSON body once per extraction', () => {
    const { results } = applyExtracts([{ name: 'a', pointer: '/id' }], response({ body: 'oops' }))
    expect(results[0]).toMatchObject({ ok: false, code: 'body-not-json' })
  })

  it('does nothing with no declared extraction', () => {
    expect(applyExtracts(undefined, response())).toEqual({ values: {}, results: [], ok: true })
  })
})
