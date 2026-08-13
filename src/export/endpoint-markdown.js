// Full Markdown of an operation, generated from the normalized model:
// "Copy page" and LLM prompts (the doc is a hash-based SPA, an LLM can't
// fetch it by URL — the content has to travel with the prompt). Pure
// function, tested by snapshot. Labels in English like the other exports:
// these are technical artifacts, not UI.

import { displayableExample } from '../openapi/examples.js'

const MAX_DEPTH = 3

function typeOf(node) {
  if (!node) return 'any'
  if (node.circular) return 'recursive'
  if (node.kind === 'composite') return node.composite.keyword
  if (node.kind === 'never') return 'never'
  let base = node.types
    ? node.types.join(' | ')
    : (node.type ?? (node.kind === 'object' ? 'object' : 'any'))
  if (node.kind === 'array') base = `array<${typeOf(node.items)}>`
  if (node.format) base += ` (${node.format})`
  if (node.nullable) base += ' | null'
  return base
}

function constraintText(s) {
  const parts = []
  if (s.enum) parts.push(`values: ${s.enum.map((v) => JSON.stringify(v)).join(', ')}`)
  if (s.default !== undefined) parts.push(`default: ${JSON.stringify(s.default)}`)
  if (s.minimum !== undefined) parts.push(`min: ${s.minimum}`)
  if (s.maximum !== undefined) parts.push(`max: ${s.maximum}`)
  if (s.minLength !== undefined || s.maxLength !== undefined) {
    parts.push(`length: ${s.minLength ?? 0}–${s.maxLength ?? '∞'}`)
  }
  if (s.pattern) parts.push(`pattern: /${s.pattern}/`)
  if (s.readOnly) parts.push('read-only')
  if (s.writeOnly) parts.push('write-only')
  return parts.join(', ')
}

function oneLine(value) {
  return String(value ?? '')
    .replaceAll('\n', ' ')
    .trim()
}

function bulletFor(name, schema, required, depth) {
  const bits = [typeOf(schema)]
  if (required) bits.push('required')
  let line = `${'  '.repeat(depth)}- \`${name}\` (${bits.join(', ')})`
  const desc = oneLine(schema?.description)
  if (desc) line += ` — ${desc}`
  const constraints = schema ? constraintText(schema) : ''
  if (constraints) line += ` [${constraints}]`
  return line
}

// Nested bullet list of a schema: bounded depth, cycles cut off by the
// `circular` flag set at normalization (rule 7).
function schemaBullets(schema, depth = 0) {
  if (!schema || depth > MAX_DEPTH || schema.circular) return []
  const lines = []
  if (schema.kind === 'object') {
    for (const prop of schema.properties ?? []) {
      const s = prop.schema
      lines.push(bulletFor(prop.name, s, prop.required, depth))
      if (!s || s.circular) continue
      if (s.kind === 'object' || s.kind === 'composite') lines.push(...schemaBullets(s, depth + 1))
      else if (
        s.kind === 'array' &&
        (s.items?.kind === 'object' || s.items?.kind === 'composite')
      ) {
        lines.push(...schemaBullets(s.items, depth + 1))
      }
    }
  } else if (schema.kind === 'composite') {
    schema.composite.variants.forEach((variant, i) => {
      // Schema name when it has one (title, otherwise originating component):
      // "variant 2" alone says nothing about what the LLM needs to send.
      const name = variant?.title ?? variant?.schemaName
      const label = `${schema.composite.keyword} variant ${i + 1}${name ? `: ${name}` : ''}`
      lines.push(`${'  '.repeat(depth)}- ${label} (${typeOf(variant)})`)
      lines.push(...schemaBullets(variant, depth + 1))
    })
  } else if (schema.kind === 'array') {
    lines.push(...schemaBullets(schema.items, depth))
  }
  return lines
}

function exampleBlock(content) {
  const example = displayableExample(content.examples)
  if (!example) return []
  const value =
    typeof example.value === 'string' ? example.value : JSON.stringify(example.value, null, 2)
  return ['', 'Example:', '', '```json', value, '```']
}

function contentBlock(content) {
  // Sequential media type (3.2): `itemSchema` describes one element of the
  // stream, which is the useful information — the whole body's schema is
  // often absent.
  const lines = []
  if (content.itemSchema) {
    lines.push('Stream item:', '')
    const itemBullets = schemaBullets(content.itemSchema)
    lines.push(...(itemBullets.length ? itemBullets : [`Type: ${typeOf(content.itemSchema)}`]), '')
  }
  if (!content.itemSchema || content.schema?.kind !== 'any') {
    const bullets = schemaBullets(content.schema)
    lines.push(
      ...(bullets.length ? bullets : content.schema ? [`Type: ${typeOf(content.schema)}`] : []),
    )
  }
  return [...lines, ...exampleBlock(content)]
}

export function toEndpointMarkdown(op, { baseUrl = '' } = {}) {
  const lines = []
  if (op.kind === 'webhook') {
    // Reversed direction: no URL to display, the API calls the integrator's
    // server — the event name replaces the path.
    lines.push(`# Webhook: ${op.summary || op.name}`)
    lines.push(
      '',
      `> Event "${op.name}" sent by the API to your webhook endpoint via ${op.method.toUpperCase()}.`,
    )
  } else {
    lines.push(`# ${op.summary || `${op.method.toUpperCase()} ${op.path}`}`)
    lines.push('')
    const base = String(baseUrl ?? '').replace(/\/+$/, '')
    lines.push('```http')
    lines.push(`${op.method.toUpperCase()} ${base}${op.path}`)
    lines.push('```')
  }
  if (op.deprecated) lines.push('', '> Deprecated')

  // Identity and provenance, as a block rather than prose: `operationId` is
  // how links, callbacks and Arazzo workflows name this operation, so a
  // reader that only ever sees the Markdown still has the handle they need.
  const meta = []
  if (op.operationId) meta.push(`- Operation ID: \`${op.operationId}\``)
  if (op.tags?.length) meta.push(`- Tags: ${op.tags.join(', ')}`)
  if (op.externalDocs?.url) {
    const label = oneLine(op.externalDocs.description)
    meta.push(`- More: ${op.externalDocs.url}${label ? ` — ${label}` : ''}`)
  }
  if (meta.length) lines.push('', ...meta)

  if (op.description) lines.push('', op.description.trim())

  // An operation-level `servers` overrides the document's base URL, so the
  // `http` block above is wrong for this one operation unless it says so.
  if (op.servers?.length) {
    lines.push('', '## Servers', '', 'These override the base URL above for this operation:', '')
    for (const server of op.servers) {
      lines.push(
        `- ${server.url}${oneLine(server.description) ? ` — ${oneLine(server.description)}` : ''}`,
      )
    }
  }

  // `security` present = the operation overrides the document's requirement.
  // An empty array is not "unspecified": it is an explicit opt-out, and a
  // reader who cannot tell the two apart sends a pointless credential.
  if (op.security) {
    lines.push('', '## Authentication', '')
    if (!op.security.length) {
      lines.push('None — this operation explicitly opts out of the document-wide requirement.')
    } else {
      lines.push('One of the following (each line = every scheme in it):', '')
      for (const requirement of op.security) {
        const schemes = Object.entries(requirement).map(
          ([name, scopes]) =>
            `\`${name}\`${scopes?.length ? ` (scopes: ${scopes.join(', ')})` : ''}`,
        )
        lines.push(`- ${schemes.join(' + ') || 'none'}`)
      }
    }
  }

  const LOCATION_TITLE = {
    path: 'Path parameters',
    query: 'Query parameters',
    querystring: 'Query string',
    header: 'Header parameters',
    cookie: 'Cookie parameters',
  }
  for (const [location, title] of Object.entries(LOCATION_TITLE)) {
    const params = op.parameters.filter((p) => p.in === location)
    if (!params.length) continue
    lines.push('', `## ${title}`, '')
    for (const p of params) {
      let line = bulletFor(p.name, p.schema, p.required, 0)
      const desc = oneLine(p.description)
      // The parameter's description takes precedence over the schema's (already included).
      if (desc && !line.includes(desc)) line += ` — ${desc}`
      lines.push(line)
    }
  }

  for (const content of op.requestBody?.contents ?? []) {
    lines.push(
      '',
      `## Request body — \`${content.mediaType}\`${op.requestBody.required ? ' (required)' : ''}`,
      '',
    )
    if (op.requestBody.description) lines.push(oneLine(op.requestBody.description), '')
    lines.push(...contentBlock(content))
  }

  if (op.responses?.length) {
    lines.push('', '## Responses')
    for (const response of op.responses) {
      // `summary` (3.2) takes precedence over `description`, which became optional.
      const desc = response.summary ? oneLine(response.summary) : oneLine(response.description)
      lines.push('', `### ${response.status}${desc ? ` — ${desc}` : ''}`)
      if (response.headers?.length) {
        lines.push('', 'Headers:', '')
        for (const h of response.headers) {
          lines.push(
            `- \`${h.name}\` (${typeOf(h.schema)})${oneLine(h.description) ? ` — ${oneLine(h.description)}` : ''}`,
          )
        }
      }
      for (const content of response.contents ?? []) {
        lines.push('', `Body \`${content.mediaType}\`:`, '')
        lines.push(...contentBlock(content))
      }
    }
  }

  if (op.callbacks?.length) {
    lines.push('', '## Callbacks')
    for (const callback of op.callbacks) {
      for (const { expression, operations } of callback.expressions) {
        for (const cbOp of operations) {
          lines.push('', `### ${callback.name} — ${cbOp.method.toUpperCase()} ${expression}`)
          if (cbOp.description) lines.push('', oneLine(cbOp.description))
          for (const content of cbOp.requestBody?.contents ?? []) {
            lines.push('', `Payload \`${content.mediaType}\`:`, '')
            lines.push(...contentBlock(content))
          }
          if (cbOp.responses?.length) {
            lines.push('', 'Expected responses from your server:', '')
            for (const response of cbOp.responses) {
              lines.push(
                `- ${response.status}${oneLine(response.description) ? ` — ${oneLine(response.description)}` : ''}`,
              )
            }
          }
        }
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}
