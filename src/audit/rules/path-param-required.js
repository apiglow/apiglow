// The spec makes `required: true` mandatory on a path parameter. Normalization
// forces it anyway, so the app behaves correctly — but any other consumer of
// the schema (codegen, validators) is entitled to reject the document.
export const pathParamRequired = {
  id: 'path-param-required',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        if (param.in !== 'path') continue
        check(param.required === true, { op: entry, dataPath, params: { name: param.name } })
      }
    }
  },
}
