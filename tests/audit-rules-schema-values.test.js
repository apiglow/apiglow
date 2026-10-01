import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { arrayItems } from '../src/audit/rules/array-items.js'
import { constraintTypeMismatch } from '../src/audit/rules/constraint-type-mismatch.js'
import { enumValid } from '../src/audit/rules/enum-valid.js'
import { formatValid } from '../src/audit/rules/format-valid.js'
import { nullableEnumNull } from '../src/audit/rules/nullable-enum-null.js'
import { patternValid } from '../src/audit/rules/pattern-valid.js'
import { rangeContradiction } from '../src/audit/rules/range-contradiction.js'
import { schemaKeywordTypo } from '../src/audit/rules/schema-keyword-typo.js'
import { auditContext, doc } from './audit-context.js'

// The schema-value rules of docs/audit.md §4.1: what a schema's own keywords
// make impossible, ignored or unreadable.

const run = (rule, schemas, openapi = '3.1.0') =>
  runRule(rule, auditContext(doc({ openapi, components: { schemas } })))
const details = (result) => result.findings.map((f) => [f.dataPath, f.params])

describe('enum-valid', () => {
  it('passes an enum of distinct values its type accepts', () => {
    const result = run(enumValid, { Status: { type: 'string', enum: ['open', 'closed'] } })
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags an empty enum, a value of the wrong type, and a duplicate', () => {
    const result = run(enumValid, {
      Empty: { type: 'string', enum: [] },
      Level: { type: 'integer', enum: [1, '2', 1] },
      Shape: { enum: 'circle' },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/Empty/enum', { detail: '[]' }],
      ['/components/schemas/Level/enum/1', { detail: '"2" ≠ type: integer' }],
      ['/components/schemas/Level/enum/2', { detail: '1 ×2' }],
      ['/components/schemas/Shape/enum', { detail: '"circle"' }],
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'error',
      location: 'components.schemas.Empty',
    })
  })

  it('accepts null in a 3.0 enum the schema declares nullable', () => {
    const result = run(
      enumValid,
      { S: { type: 'string', nullable: true, enum: ['a', null] } },
      '3.0.3',
    )
    expect(result.findings).toEqual([])
  })
})

describe('nullable-enum-null', () => {
  it('passes when the enum lists null, or null is not allowed', () => {
    const result = run(nullableEnumNull, {
      A: { type: ['string', 'null'], enum: ['a', null] },
      B: { type: 'string', enum: ['a'] },
    })
    expect(result.findings).toEqual([])
  })

  it('flags 3.1 null in the type, and 3.0 nullable next to a type, with no null in the enum', () => {
    const later = run(nullableEnumNull, { A: { type: ['string', 'null'], enum: ['a'] } })
    expect(details(later)).toEqual([
      ['/components/schemas/A/enum', { declared: 'type: ["string", "null"]' }],
    ])
    const older = run(
      nullableEnumNull,
      {
        A: { type: 'string', nullable: true, enum: ['a'] },
        NoType: { nullable: true, enum: ['a'] },
      },
      '3.0.3',
    )
    expect(details(older)).toEqual([['/components/schemas/A/enum', { declared: 'nullable: true' }]])
  })

  it('ignores nullable in a 3.1 document, where it is no keyword', () => {
    const result = run(nullableEnumNull, { A: { type: 'string', nullable: true, enum: ['a'] } })
    expect(result.findings).toEqual([])
  })
})

describe('array-items', () => {
  it('passes an array that says what it holds', () => {
    const result = run(arrayItems, {
      A: { type: 'array', items: { type: 'string' } },
      Tuple: { type: 'array', prefixItems: [{ type: 'string' }] },
    })
    expect(result.findings).toEqual([])
  })

  it('flags an array without items, a type list included', () => {
    const result = run(arrayItems, { A: { type: 'array' }, B: { type: ['array', 'null'] } })
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/components/schemas/A',
      '/components/schemas/B',
    ])
    expect(result.findings[0].severity).toBe('warning')
  })
})

describe('constraint-type-mismatch', () => {
  it('passes keywords that apply to a declared type, and schemas with no type', () => {
    const result = run(constraintTypeMismatch, {
      A: { type: ['string', 'integer'], maxLength: 3, maximum: 9 },
      B: { minLength: 1, minimum: 0 },
      C: { type: 'integer', minimum: 0, multipleOf: 2 },
    })
    expect(result.findings).toEqual([])
  })

  it('flags a keyword none of the declared types takes', () => {
    const result = run(constraintTypeMismatch, {
      Count: { type: 'integer', maxLength: 3 },
      Name: { type: 'string', minimum: 1, items: { type: 'string' } },
      Tags: { type: 'array', items: { type: 'string' }, required: ['x'] },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/Count/maxLength', { keyword: 'maxLength', type: 'integer' }],
      ['/components/schemas/Name/minimum', { keyword: 'minimum', type: 'string' }],
      ['/components/schemas/Name/items', { keyword: 'items', type: 'string' }],
      ['/components/schemas/Tags/required', { keyword: 'required', type: 'array' }],
    ])
  })
})

describe('constraint-type-mismatch — nullable without a type', () => {
  it('flags a 3.0 nullable with no type where the rest of the schema rejects null', () => {
    const result = run(
      constraintTypeMismatch,
      {
        Ref: { nullable: true, allOf: [{ type: 'object' }] },
        Either: { nullable: true, oneOf: [{ type: 'string' }, { type: 'integer' }] },
        Anything: { nullable: true, description: 'Free' },
        Typed: { type: 'string', nullable: true },
      },
      '3.0.3',
    )
    expect(details(result)).toEqual([
      ['/components/schemas/Ref/nullable', { keyword: 'nullable' }],
      ['/components/schemas/Either/nullable', { keyword: 'nullable' }],
    ])
  })

  it('leaves it to version-legacy from 3.1 on', () => {
    const result = run(constraintTypeMismatch, {
      Ref: { nullable: true, allOf: [{ type: 'object' }] },
    })
    expect(result.findings).toEqual([])
  })
})

describe('range-contradiction', () => {
  it('passes bounds some value satisfies, an equal pair included', () => {
    const result = run(rangeContradiction, {
      A: { type: 'integer', minimum: 1, maximum: 1 },
      B: { type: 'string', minLength: 2, maxLength: 2 },
      C: { type: 'number', exclusiveMinimum: 0, maximum: 1, multipleOf: 0.5 },
    })
    expect(result.findings).toEqual([])
  })

  it('flags bounds no value satisfies, in both spellings of exclusivity', () => {
    const result = run(rangeContradiction, {
      Inverted: { type: 'integer', minimum: 5, maximum: 1 },
      Exclusive: { type: 'number', exclusiveMinimum: 1, maximum: 1 },
      Lengths: { type: 'string', minLength: 3, maxLength: 2 },
      Step: { type: 'number', multipleOf: 0 },
      Negative: { type: 'array', items: {}, minItems: -1 },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/Inverted/minimum', { bounds: 'minimum: 5, maximum: 1' }],
      [
        '/components/schemas/Exclusive/exclusiveMinimum',
        { bounds: 'exclusiveMinimum: 1, maximum: 1' },
      ],
      ['/components/schemas/Lengths/minLength', { bounds: 'minLength: 3, maxLength: 2' }],
      ['/components/schemas/Step/multipleOf', { bounds: 'multipleOf: 0' }],
      ['/components/schemas/Negative/minItems', { bounds: 'minItems: -1' }],
    ])
  })

  it('reads 3.0 boolean exclusive bounds', () => {
    const result = run(
      rangeContradiction,
      { A: { type: 'number', minimum: 2, maximum: 2, exclusiveMaximum: true } },
      '3.0.3',
    )
    expect(details(result)).toEqual([
      [
        '/components/schemas/A/minimum',
        { bounds: 'minimum: 2, maximum: 2, exclusiveMaximum: true' },
      ],
    ])
  })
})

describe('pattern-valid', () => {
  it('passes regular expressions either reading accepts', () => {
    const result = run(patternValid, {
      A: { type: 'string', pattern: '^\\d{3}-[a-z]+$' },
      // Valid without the `u` flag only: left alone.
      B: { type: 'string', pattern: '^\\-\\d$' },
      C: { type: 'object', patternProperties: { '^x-': {} } },
    })
    expect(result.findings).toEqual([])
  })

  it('flags a pattern and a patternProperties key that compile nowhere', () => {
    const result = run(patternValid, {
      A: { type: 'string', pattern: '^(abc$' },
      B: { type: 'object', patternProperties: { '[a-z': {} } },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/A/pattern', { pattern: '^(abc$' }],
      ['/components/schemas/B/patternProperties/[a-z', { pattern: '[a-z' }],
    ])
  })
})

describe('format-valid', () => {
  it('passes registered formats on their type, and unknown custom formats', () => {
    const result = run(formatValid, {
      A: { type: 'string', format: 'date-time' },
      B: { type: 'integer', format: 'int64' },
      C: { type: 'string', format: 'phone-number' },
      D: { format: 'date' },
    })
    expect(result.findings).toEqual([])
  })

  it('flags a format its type cannot carry, and a known misspelling', () => {
    const result = run(formatValid, {
      A: { type: 'integer', format: 'date-time' },
      B: { type: ['string', 'null'], format: 'int32' },
      C: { type: 'string', format: 'datetime' },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/A/format', { format: 'date-time', expected: 'type: string' }],
      ['/components/schemas/B/format', { format: 'int32', expected: 'type: number' }],
      ['/components/schemas/C/format', { format: 'datetime', expected: 'format: date-time' }],
    ])
  })
})

describe('schema-keyword-typo', () => {
  it('passes keywords of any version, extensions and far-off annotations', () => {
    const result = run(schemaKeywordTypo, {
      A: { type: 'string', nullable: true, 'x-go-type': 'string', unit: 'cm', $comment: 'ok' },
    })
    expect(result.findings).toEqual([])
  })

  it('flags a near miss of a keyword, and required: true on a property', () => {
    const result = run(schemaKeywordTypo, {
      Pet: {
        type: 'object',
        descripton: 'A pet',
        properties: {
          name: { type: 'string', maxLenght: 20, readonly: true },
          id: { type: 'string', required: true },
        },
      },
    })
    expect(details(result)).toEqual([
      ['/components/schemas/Pet/descripton', { written: 'descripton', suggestion: 'description' }],
      [
        '/components/schemas/Pet/properties/name/maxLenght',
        { written: 'maxLenght', suggestion: 'maxLength' },
      ],
      [
        '/components/schemas/Pet/properties/name/readonly',
        { written: 'readonly', suggestion: 'readOnly' },
      ],
      [
        '/components/schemas/Pet/properties/id/required',
        { written: 'required: true', suggestion: 'required: ["id"]' },
      ],
    ])
    expect(result.findings[0]).toMatchObject({
      location: 'components.schemas.Pet',
      severity: 'warning',
    })
  })
})
