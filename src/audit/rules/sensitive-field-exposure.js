import { listOf } from '../../openapi/model.js'
import { placeInput } from '../input-shape.js'
import { pointer } from '../pointer.js'
import { operationContents, SCHEMA_DEPTH } from '../schema-walk.js'
import { payloadChildren } from '../tool-inputs.js'
import { isObject } from '../value-check.js'

// A password in a response: a schema the document itself marks `format:
// password` — "a hint to obscure the value" (OpenAPI Data Types) — reachable
// from a response body without `writeOnly: true`. OpenAPI 3.0 says a writeOnly
// property "SHOULD NOT be sent as part of the response", JSON Schema 2020-12
// §9.4 that its value "is never present when the instance is retrieved", the
// keyword meant "to mark a password input field". Without it, the schema says
// the API hands the secret back: OWASP API3:2023, an endpoint exposing
// "properties of an object that are considered sensitive". Generators type the
// response model with the field, and this documentation's response sample
// shows it filled in (`pa55w0rd`, src/openapi/sample.js), where a writeOnly
// property is left out.
//
// By the document's own word only, never by name: a `token` or `secret`
// property may be exactly what the operation exists to return (an API key
// issued once, an OAuth token), and guessing credentials from names is out of
// the audit's scope.
//
// Response bodies of the paths operations, hidden ones included — a webhook's
// or a callback's response is written by the integrator, not served by this
// API. Response headers are not walked: a header is a value, not an object
// exposing properties. Request schemas are not judged at all: a password is
// what a request carries. The subtree below a writeOnly schema is never in a
// response, so it is not walked either. One check per `format: password`
// schema (the format on it or on an `allOf` member), each schema object once
// — a component's at the component, where one `writeOnly` fixes every
// operation returning it. A schema both readOnly
// and writeOnly is `readonly-writeonly`'s.
export const sensitiveFieldExposure = {
  id: 'sensitive-field-exposure',
  category: 'security',
  severity: 'warning',
  run(ctx, check) {
    const seen = new Set()
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      for (const { kind, content, dataPath } of operationContents(entry)) {
        if (kind !== 'response') continue
        const visit = (schema, path) => {
          check(writeOnly(schema), placeInput(ctx, entry, schema, path))
        }
        walkResponseSchema(content.schema, `${dataPath}/schema`, visit, seen)
        walkResponseSchema(content.itemSchema, `${dataPath}/itemSchema`, visit, seen)
      }
    }
  },
}

// What a response carries, below and including `root`: the edges
// `payloadChildren` lists on the response side — properties (readOnly ones
// too: they are what responses are for), map and `patternProperties` values,
// array and tuple items, composition and conditional members. Each schema
// object once; `visit` is called on the passwords, and nothing under a
// writeOnly schema is in a response.
function walkResponseSchema(root, dataPath, visit, seen) {
  const walk = (schema, path, depth) => {
    if (!isObject(schema) || depth > SCHEMA_DEPTH || seen.has(schema)) return
    seen.add(schema)
    // A password is a string: nothing below it to walk, and its `allOf`
    // members are the same value, judged once, here.
    if (password(schema)) return visit(schema, path)
    if (writeOnly(schema)) return
    // `payloadChildren` leaves a writeOnly property out, being never returned;
    // a password one is still a check here, and the one that passes.
    if (isObject(schema.properties)) {
      for (const [name, sub] of Object.entries(schema.properties)) {
        if (isObject(sub) && sub.writeOnly === true && password(sub))
          walk(sub, `${path}${pointer('properties', name)}`, depth + 1)
      }
    }
    for (const [child, childPath] of payloadChildren(schema, path, 'response'))
      walk(child, childPath, depth + 1)
  }
  walk(root, dataPath, 0)
}

// `format: password`, `writeOnly`: on the schema, or on a member of its `allOf`
// — what an `allOf` member says applies to the value all the same (`{ allOf:
// [{ $ref: Password }, { writeOnly: true }] }`, the 3.0 way of adding a keyword
// to a reference).
function password(schema) {
  return saysOwnOrAllOf(schema, (part) => part.format === 'password')
}

function writeOnly(schema) {
  return saysOwnOrAllOf(schema, (part) => part.writeOnly === true)
}

function saysOwnOrAllOf(schema, test) {
  return test(schema) || listOf(schema.allOf).some((member) => isObject(member) && test(member))
}
