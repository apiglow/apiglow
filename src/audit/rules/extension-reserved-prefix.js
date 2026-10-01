import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A specification extension whose name starts with `x-oai-` or `x-oas-`. From
// 3.1, those prefixes "are reserved for uses defined by the OpenAPI
// Initiative" (Specification Extensions): an extension of yours under them can
// collide with one the specification defines later, and a tool that knows the
// official one will read your data as its own. Read wherever an extension can
// sit — every object the walk types, schemas and patterned maps included; a
// Reference Object's extra keys are `ref-siblings`'. One check per extension.
const RESERVED = /^x-(oai|oas)-/

export const extensionReservedPrefix = {
  id: 'extension-reserved-prefix',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    if (ctx.version.minor < 1) return
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Reference') continue
      for (const field of Object.keys(node)) {
        if (!RESERVED.test(field)) continue
        const at = `${dataPath}${pointer(field)}`
        check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { field } })
      }
    }
  },
}
