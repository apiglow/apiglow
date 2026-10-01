import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readDocument } from '../src/openapi/read-document.js'

// The tolerant reader (docs/architecture.md §14.21): whatever state a text is
// in, the best document it holds and what is wrong with it, line and column.

// What the reader says of a text; its `ast` is the CLI's positions' business.
const read = (name) => {
  const { document, problems } = readDocument(
    readFileSync(new URL(`fixtures/broken/${name}`, import.meta.url), 'utf8'),
  )
  return { document, problems }
}
const at = ({ problems }) => problems.map(({ code, line, column }) => [code, line, column])

const DOC = { openapi: '3.1.0', info: { title: 'T', version: '1' } }

describe('readDocument on broken files', () => {
  it('reads a duplicate key with the last value winning, and says where', () => {
    const result = read('dup-key.yaml')
    expect(result.document.paths['/a'].get.summary).toBe('B')
    expect(result.problems).toEqual([
      { code: 'DUPLICATE_KEY', line: 9, column: 7, detail: 'Map keys must be unique' },
    ])
  })

  it('reads JSON with a trailing comma through YAML, reporting the JSON error', () => {
    const result = read('trailing-comma.json')
    expect(result.document).toEqual({ ...DOC, paths: {} })
    expect(at(result)).toEqual([['json', 1, 66]])
    expect(result.problems[0].detail).toMatch(/double-quoted property name/)
  })

  it('reads a JSON file cut short, at the end of the text', () => {
    const result = read('truncated.json')
    expect(result.document.paths['/a'].get.responses['200'].description).toBe('ok')
    expect(at(result)).toEqual([['json', 2, 1]])
  })

  it('reads past a tab used as indentation', () => {
    const result = read('tab.yaml')
    expect(result.document.paths['/a']).toBeDefined()
    expect(at(result)).toEqual([['TAB_AS_INDENT', 5, 1]])
  })

  it('reports one problem per place, however many ways the parser trips on it', () => {
    const result = read('bad-indent.yaml')
    expect(result.document.openapi).toBe('3.1.0')
    expect(at(result)).toEqual([['BLOCK_AS_IMPLICIT_KEY', 3, 10]])
  })

  it('reads an alias to no anchor as null', () => {
    const result = read('bad-alias.yaml')
    expect(result.document.paths['/a'].get.responses['200']).toBeNull()
    expect(at(result)).toEqual([['BAD_ALIAS', 7, 16]])
    expect(result.problems[0].detail).toContain('nope')
  })

  it('reads a valid file js-yaml refused, without a problem', () => {
    // A `|+` block whose only line is blank: valid YAML, and the shape the
    // OpenAI description has.
    const result = read('keep-chomp.yaml')
    expect(result.document.paths['/a'].get.description).toBe('\n')
    expect(result.problems).toEqual([])
  })

  it('strips a byte-order mark silently', () => {
    expect(read('bom.json')).toEqual({ document: { ...DOC, paths: {} }, problems: [] })
  })

  it('gives what a well-formed file holds, mapping or not, without a problem', () => {
    expect(read('empty.yaml')).toEqual({ document: undefined, problems: [] })
    expect(read('list.yaml')).toEqual({ document: ['a', 'b'], problems: [] })
    expect(read('text.yaml')).toEqual({ document: 'hello world', problems: [] })
    for (const name of ['no-version.json', 'swagger12.json', 'v4.json', 'ext-ref.json']) {
      expect(read(name).problems, name).toEqual([])
    }
    expect(read('ref-loop.yaml').document.components.schemas.A).toEqual({
      $ref: '#/components/schemas/B',
    })
  })
})

describe('readDocument', () => {
  it('reads the first document of a stream, and says there is another', () => {
    const result = readDocument('a: 1\n---\nb: 2\n')
    expect(result.document).toEqual({ a: 1 })
    expect(at(result)).toEqual([['MULTIPLE_DOCS', 2, 1]])
  })

  it('reads merge keys as a healthy read would', () => {
    const result = readDocument('base: &b { x: 1 }\nmore:\n  <<: *b\n  y: 2\n')
    expect(result.document.more).toEqual({ x: 1, y: 2 })
    expect(result.problems).toEqual([])
  })

  it('bounds alias expansion, reading every alias as null past the cap', () => {
    const levels = ['a: &a [x, x, x, x, x, x, x, x, x, x]']
    for (let i = 1; i < 9; i += 1) {
      const name = String.fromCharCode(97 + i)
      const previous = String.fromCharCode(96 + i)
      levels.push(`${name}: &${name} [${Array(10).fill(`*${previous}`).join(', ')}]`)
    }
    const result = readDocument(levels.join('\n'))
    expect(at(result)).toEqual([['ALIAS_COUNT', 2, 8]])
    expect(result.document.i).toEqual(Array(10).fill(null))
  })

  it('lets an anchor be reused far more than a hundred times', () => {
    const uses = Array.from({ length: 500 }, (_, i) => `u${i}: *e`).join('\n')
    const result = readDocument(`e: &e { description: shared }\n${uses}\n`)
    expect(result.problems).toEqual([])
    expect(result.document.u499).toEqual({ description: 'shared' })
  })

  it('reads JSON strictly when it is valid', () => {
    expect(readDocument('{"a": [1, 2]}')).toEqual({ document: { a: [1, 2] }, problems: [] })
  })
})
