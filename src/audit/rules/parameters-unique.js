import { resolvePointer } from '../../scenarios/pointer.js'
import { placeOf } from '../locate.js'

// A parameter list naming the same parameter twice — same `name`, same `in`
// (OAS 3.x, Operation and Path Item `parameters`, MUST NOT). Which declaration
// counts is up to whoever reads it: this documentation keeps the last one, a
// generator may keep the first, or emit two arguments of one name and fail to
// compile. Header names are compared without case, as HTTP compares them.
//
// Each list on its own: an operation redeclaring a Path Item parameter
// overrides it, which is what that pairing is for. Lists are read dereferenced
// — two `$ref`s to one component are a duplicate too. One finding per extra
// occurrence.
export const parametersUnique = {
  id: 'parameters-unique',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, dataPath } of ctx.objects) {
      if (type !== 'PathItem' && type !== 'Operation') continue
      const { value: list } = resolvePointer(ctx.document, `${dataPath}/parameters`)
      if (!Array.isArray(list)) continue
      const seen = new Set()
      for (const [index, param] of list.entries()) {
        if (!param || typeof param !== 'object') continue
        if (typeof param.name !== 'string' || typeof param.in !== 'string') continue
        const name = param.in === 'header' ? param.name.toLowerCase() : param.name
        const key = `${param.in}\n${name}`
        if (!seen.has(key)) {
          seen.add(key)
          continue
        }
        const at = `${dataPath}/parameters/${index}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { name: param.name, in: param.in },
        })
      }
    }
  },
}
