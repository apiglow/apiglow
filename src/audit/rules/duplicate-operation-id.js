// operationId is document-wide unique per the spec, and this app makes it a
// route: two operations sharing one means one of the two deep links lands on
// the other operation.
export const duplicateOperationId = {
  id: 'duplicate-operation-id',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const counts = new Map()
    for (const entry of ctx.operations) {
      const id = operationId(entry)
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const entry of ctx.operations) {
      const id = operationId(entry)
      // An operation without operationId is not applicable here — its absence
      // is the readiness rule `operation-id-present`, not a duplicate.
      if (!id) continue
      check(counts.get(id) === 1, {
        op: entry,
        dataPath: `${entry.pointer}/operationId`,
        params: { operationId: id },
      })
    }
  },
}

function operationId(entry) {
  const id = entry.op.operationId
  return typeof id === 'string' && id.trim() ? id : null
}
