import { listOf } from '../../openapi/model.js'
import { componentNames, placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'
import { isObject } from '../value-check.js'

// A request input the API both deprecates and requires. A deprecated
// parameter "SHOULD be transitioned out of usage" (OpenAPI, Parameter Object);
// a deprecated property tells applications they "SHOULD refrain from usage"
// (JSON Schema 2020-12 §9.3). Required says the request is rejected without
// it. A client that follows the deprecation breaks its own calls; one that
// keeps sending it is told it is doing wrong. One of the two flags is stale.
//
// The inputs a client sends to a paths operation: a parameter with
// `required: true` (a path parameter is skipped — it cannot be optional, so
// its deprecation is the operation's), and a writable property of a request
// body schema listed in its own schema's `required`. A response property is
// fine: the server keeps sending it until removal. Webhooks and callbacks are
// requests the API sends, not ones it receives. One check per deprecated
// input — a shared parameter at its component, a shared schema's property at
// the component.
export const deprecatedButRequired = {
  id: 'deprecated-but-required',
  category: 'deprecation',
  severity: 'warning',
  run(ctx, check) {
    const components = componentNames(ctx.document, 'parameters')
    const seenParameters = new Set()
    const requestSchemas = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const { param, dataPath } of entry.parameters) {
        if (param.deprecated !== true || param.in === 'path' || seenParameters.has(param)) continue
        seenParameters.add(param)
        const name = components.get(param)
        const at = name === undefined ? dataPath : pointer('components', 'parameters', name)
        const target = name === undefined ? { op: entry } : placeOf(ctx.operations, at)
        check(param.required !== true, {
          ...target,
          dataPath: at,
          params: { name: typeof param.name === 'string' ? param.name : '' },
        })
      }
      // The walk's own visited set is the collection: each schema object
      // once across every operation.
      for (const input of toolInputs(entry)) {
        if (input.kind === 'body') walkInputSchema(input.schema, '', () => {}, requestSchemas)
      }
    }

    // `ctx.schemas` places each schema where it is written, a component's at
    // the component.
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!requestSchemas.has(schema) || !isObject(schema.properties)) continue
      const required = new Set(listOf(schema.required))
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!isObject(property) || property.deprecated !== true) continue
        if (property.readOnly === true) continue
        check(!required.has(name), {
          op,
          location,
          dataPath: `${dataPath}${pointer('properties', name)}`,
          params: { name },
        })
      }
    }
  },
}
