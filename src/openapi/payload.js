// Where an OpenAPI document holds payloads — values its author wrote as data:
// examples, defaults, enums, a Link's parameters — rather than OpenAPI
// structure. A `$ref` there is data too: an API about JSON Schemas has
// examples full of them, and resolving one would rewrite the example into the
// schema it names.
//
// Positions are tracked by what led to a node, not by what it contains: a
// property NAMED `example` (under `properties`) is a schema, while the
// `example` OF a schema is a payload. One step of that state machine is
// `childPosition(position, key, value)`; `PAYLOAD` is where a walk stops.

export const PAYLOAD = 'payload'
const OBJECT = 'object'
const MAP = 'map'
const CALLBACKS = 'callbacks'
const EXAMPLES = 'examples'
const EXAMPLE = 'example'
const LINKS = 'links'
const LINK = 'link'

export const ROOT = OBJECT

// Fields whose value is a map: its keys are names chosen by the author, never
// keywords — a property, a status code, a media type, a component.
const MAPS = new Set([
  'paths',
  'webhooks',
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'schemas',
  'responses',
  'parameters',
  'headers',
  'content',
  'requestBodies',
  'securitySchemes',
  'pathItems',
  'mediaTypes',
  'variables',
  'encoding',
  'mapping',
  'scopes',
])

// Payload fields of any object (Schema, Parameter, Header, Media Type, Server
// Variable…).
const PAYLOAD_FIELDS = new Set(['example', 'default', 'const', 'enum'])
const EXAMPLE_PAYLOAD = new Set(['value', 'dataValue', 'serializedValue'])
const LINK_PAYLOAD = new Set(['parameters', 'requestBody'])

export function childPosition(position, key, value) {
  switch (position) {
    case MAP:
      return OBJECT
    // A Callback Object is itself a map: runtime expression → Path Item.
    case CALLBACKS:
      return MAP
    case EXAMPLES:
      return EXAMPLE
    case LINKS:
      return LINK
    case EXAMPLE:
      if (EXAMPLE_PAYLOAD.has(key)) return PAYLOAD
      break
    case LINK:
      if (LINK_PAYLOAD.has(key)) return PAYLOAD
      break
  }
  if (PAYLOAD_FIELDS.has(key)) return PAYLOAD
  // A Schema's `examples` is a list of payloads; elsewhere it is a map of
  // Example Objects. An index after it says which, for a walk with no value.
  if (key === 'examples') return Array.isArray(value) ? PAYLOAD : EXAMPLES
  if (key === 'callbacks') return CALLBACKS
  if (key === 'links') return LINKS
  return MAPS.has(key) ? MAP : OBJECT
}

// The same verdict for a pointer, without the document: what ref-parser's
// `excludedPathMatcher` hands over. `#/a/b` → is it at or under a payload?
export function isPayloadPointer(path) {
  const hash = path.indexOf('#')
  const fragment = hash < 0 ? '' : path.slice(hash + 1)
  if (!fragment.startsWith('/')) return false
  const segments = fragment
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
  let position = ROOT
  for (const [index, key] of segments.entries()) {
    const next = segments[index + 1]
    position = childPosition(position, key, next !== undefined && /^\d+$/.test(next) ? [] : null)
    if (position === PAYLOAD) return true
  }
  return false
}
