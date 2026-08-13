// A Security Requirement names a scheme that `components.securitySchemes`
// does not define: the operation looks protected, but the app has no scheme to
// build a credentials cartouche from, and nothing is ever sent.
export const securitySchemeDeclared = {
  id: 'security-scheme-declared',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const declared = new Set(Object.keys(ctx.document.components?.securitySchemes ?? {}))
    for (const name of requirementNames(ctx.document.security)) {
      check(declared.has(name), {
        location: 'security',
        dataPath: '/security',
        params: { name },
      })
    }
    for (const entry of ctx.operations) {
      for (const name of requirementNames(entry.op.security)) {
        check(declared.has(name), {
          op: entry,
          dataPath: `${entry.pointer}/security`,
          params: { name },
        })
      }
    }
  },
}

function* requirementNames(security) {
  for (const requirement of Array.isArray(security) ? security : []) {
    // `{}` is the legal way to say "auth optional here": no name, no check.
    if (!requirement || typeof requirement !== 'object') continue
    yield* Object.keys(requirement)
  }
}
