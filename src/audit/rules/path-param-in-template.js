import { templateNames } from '../path-template.js'

// The mirror case of `path-param-declared`: a declared `in: path` parameter
// whose name appears nowhere in the template. It is rendered as a required
// field that goes nowhere — usually a rename that stopped halfway.
export const pathParamInTemplate = {
  id: 'path-param-in-template',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      const templates = new Set(templateNames(entry.path))
      for (const { param, dataPath } of entry.parameters) {
        if (param.in !== 'path') continue
        check(templates.has(param.name), { op: entry, dataPath, params: { name: param.name } })
      }
    }
  },
}
