import { describe, expect, it } from 'vitest'
import { isXmlMedia, xmlSample } from '../src/openapi/sample-xml.js'

// `xmlSample` had no test file of its own: it was exercised only where an XML
// construct happened to appear in the request-fidelity fixture, and a snapshot
// froze the whole document rather than the rules that built it. Here every rule
// of the XML Object gets a case built from a normalized node directly — the
// same input `model.js` produces, minus the fixture's incidental shape.

const leaf = (value, xml) => ({ kind: 'primitive', type: 'string', examples: [value], xml })
const bare = (schema) => xmlSample(schema, { declaration: false })

describe('media types', () => {
  it('recognizes the registered spellings and the structured suffix', () => {
    expect(isXmlMedia('application/xml')).toBe(true)
    expect(isXmlMedia('TEXT/XML')).toBe(true)
    expect(isXmlMedia('application/vnd.acme+xml; charset=utf-8')).toBe(true)
    expect(isXmlMedia('application/json')).toBe(false)
    expect(isXmlMedia('application/xml-dtd')).toBe(false)
    expect(isXmlMedia(undefined)).toBe(false)
  })
})

describe('the root element', () => {
  it('prefers the XML name, then the component name, then a neutral wrapper', () => {
    const props = [{ name: 'id', schema: leaf('1') }]
    expect(bare({ kind: 'object', properties: props, xml: { name: 'pet' } })).toContain('<pet>')
    expect(bare({ kind: 'object', properties: props, schemaName: 'Pet' })).toContain('<Pet>')
    expect(bare({ kind: 'object', properties: props })).toContain('<root>')
  })

  it('emits the declaration unless the caller asks for a fragment', () => {
    const schema = { kind: 'object', properties: [{ name: 'id', schema: leaf('1') }] }
    expect(xmlSample(schema)).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<root>/)
    expect(bare(schema).startsWith('<root>')).toBe(true)
  })

  it('renders nothing at all for a schema that describes nothing', () => {
    expect(xmlSample(null)).toBe('')
    expect(xmlSample({ kind: 'never' })).toBe('')
  })
})

describe('nodeType', () => {
  const doc = (propXml) =>
    bare({
      kind: 'object',
      xml: { name: 'note' },
      properties: [{ name: 'body', schema: leaf('hello', propXml) }],
    })

  it('puts an attribute on the parent tag instead of in a child element', () => {
    expect(doc({ nodeType: 'attribute' })).toBe('<note body="hello" />')
  })

  it('writes text and none as bare text, cdata inside its section', () => {
    expect(doc({ nodeType: 'text' })).toBe('<note>\n  hello\n</note>')
    expect(doc({ nodeType: 'none' })).toBe('<note>\n  hello\n</note>')
    expect(doc({ nodeType: 'cdata' })).toBe('<note>\n  <![CDATA[hello]]>\n</note>')
  })

  it('splits a CDATA section that would close itself early', () => {
    const out = doc({ nodeType: 'cdata' }).replace('hello', 'x')
    expect(out).toContain('<![CDATA[x]]>')
    const nested = bare({
      kind: 'object',
      xml: { name: 'note' },
      properties: [{ name: 'body', schema: leaf('a]]>b', { nodeType: 'cdata' }) }],
    })
    // The payload keeps its bytes; only the section is cut so the terminator
    // cannot end it early.
    expect(nested).toContain('<![CDATA[a]]]]><![CDATA[>b]]>')
  })
})

describe('names, namespaces and prefixes', () => {
  it('qualifies the element that declares the prefix and declares its namespace there', () => {
    const out = bare({
      kind: 'object',
      xml: { name: 'book', namespace: 'https://example.com/ns', prefix: 'b' },
      properties: [{ name: 'title', schema: leaf('Dune') }],
    })
    expect(out).toBe('<b:book xmlns:b="https://example.com/ns">\n  <title>Dune</title>\n</b:book>')
  })

  it('declares a default namespace when there is no prefix', () => {
    const out = bare({
      kind: 'object',
      xml: { name: 'book', namespace: 'https://example.com/ns' },
      properties: [{ name: 'title', schema: leaf('Dune') }],
    })
    expect(out).toContain('<book xmlns="https://example.com/ns">')
  })

  it('lets a property rename its own element', () => {
    const out = bare({
      kind: 'object',
      xml: { name: 'book' },
      properties: [{ name: 'title', schema: leaf('Dune', { name: 'heading' }) }],
    })
    expect(out).toContain('<heading>Dune</heading>')
  })
})

describe('arrays', () => {
  const tags = (xml, extra = {}) => ({
    kind: 'object',
    xml: { name: 'book' },
    properties: [
      {
        name: 'tags',
        schema: { kind: 'array', items: leaf('scifi'), xml, ...extra },
      },
    ],
  })

  it('splices an unwrapped array into its parent, repeating the item element', () => {
    expect(bare(tags(undefined))).toBe('<book>\n  <tags>scifi</tags>\n</book>')
  })

  it('wraps when the model says the array is an element of its own', () => {
    expect(bare(tags({ nodeType: 'element' }))).toBe(
      '<book>\n  <tags>\n    <tags>scifi</tags>\n  </tags>\n</book>',
    )
  })

  it("lets the item's own name win over the array's", () => {
    const schema = tags({ nodeType: 'element', name: 'tags' })
    schema.properties[0].schema.items = leaf('scifi', { name: 'tag' })
    expect(bare(schema)).toContain('<tags>\n    <tag>scifi</tag>\n  </tags>')
  })

  it('repeats up to the item budget, honouring minItems', () => {
    const out = bare(tags(undefined, { minItems: 5 }))
    expect(out.match(/<tags>scifi<\/tags>/g)).toHaveLength(2)
  })

  it('names each position of a tuple from its own schema', () => {
    const out = bare({
      kind: 'object',
      xml: { name: 'point' },
      properties: [
        {
          name: 'coords',
          schema: {
            kind: 'array',
            tupleItems: [leaf('1', { name: 'x' }), leaf('2', { name: 'y' })],
          },
        },
      ],
    })
    expect(out).toBe('<point>\n  <x>1</x>\n  <y>2</y>\n</point>')
  })

  it('renders an empty wrapper rather than nothing when the items say nothing', () => {
    const empty = {
      kind: 'array',
      xml: { name: 'tags', nodeType: 'element' },
      items: { kind: 'object', circular: true, properties: [] },
    }
    expect(bare(empty)).toBe('<tags />')
    // Unwrapped, the same emptiness leaves no trace: there is no element of
    // its own to stand for the array.
    expect(bare({ ...empty, xml: { name: 'tags' } })).toBe('')
  })
})

describe('composites', () => {
  const dog = {
    kind: 'object',
    schemaName: 'Dog',
    properties: [{ name: 'bark', schema: leaf('woof') }],
  }
  const cat = {
    kind: 'object',
    schemaName: 'Cat',
    properties: [{ name: 'purr', schema: leaf('rrr') }],
  }

  it('shows the discriminated variant and pins the discriminator value', () => {
    const out = bare({
      kind: 'composite',
      xml: { name: 'pet' },
      composite: { keyword: 'oneOf', variants: [dog, cat] },
      discriminator: {
        propertyName: 'petType',
        mapping: [
          { key: 'dog', variantIndex: 0 },
          { key: 'cat', variantIndex: 1 },
        ],
      },
    })
    expect(out).toContain('<bark>woof</bark>')
    expect(out).toContain('<petType>dog</petType>')
    expect(out).not.toContain('purr')
  })

  it("keeps the composite's own element name over the variant's", () => {
    const out = bare({
      kind: 'composite',
      xml: { name: 'pet' },
      composite: { keyword: 'oneOf', variants: [{ ...dog, xml: { name: 'hound' } }] },
    })
    expect(out.startsWith('<pet>')).toBe(true)
  })
})

describe('bounds and directions', () => {
  it('drops readOnly properties from a request and writeOnly ones from a response', () => {
    const schema = {
      kind: 'object',
      xml: { name: 'pet' },
      properties: [
        { name: 'id', schema: { ...leaf('1'), readOnly: true } },
        { name: 'name', schema: { ...leaf('Rex'), writeOnly: true } },
      ],
    }
    expect(bare(schema)).toBe('<pet>\n  <name>Rex</name>\n</pet>')
    expect(xmlSample(schema, { declaration: false, forResponse: true })).toBe(
      '<pet>\n  <id>1</id>\n</pet>',
    )
  })

  it('stops expanding past the depth budget instead of recursing (rule 7)', () => {
    const deep = (level) =>
      level === 0
        ? leaf('bottom')
        : { kind: 'object', properties: [{ name: `l${level}`, schema: deep(level - 1) }] }
    const out = bare(deep(6))
    // Bounded: the deepest levels are omitted rather than rendered.
    expect(out).not.toContain('bottom')
    expect(out.split('\n').length).toBeLessThan(10)
  })

  it('renders nothing for a cyclic node', () => {
    const cyclic = { kind: 'object', properties: [] }
    cyclic.properties.push({ name: 'self', schema: { ...cyclic, circular: true } })
    expect(bare(cyclic)).toBe('<root />')
  })
})

describe('escaping', () => {
  it('escapes markup in text and quotes in attributes', () => {
    const out = bare({
      kind: 'object',
      xml: { name: 'book' },
      properties: [
        { name: 'title', schema: leaf('Dune & Sons <best>') },
        { name: 'note', schema: leaf('say "hi" & <bye>', { nodeType: 'attribute' }) },
      ],
    })
    expect(out).toContain('<title>Dune &amp; Sons &lt;best&gt;</title>')
    expect(out).toContain('note="say &quot;hi&quot; &amp; &lt;bye&gt;"')
  })
})
