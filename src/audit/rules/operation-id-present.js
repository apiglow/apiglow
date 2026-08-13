// Docs readiness: without operationId the route falls back to
// `{method}-{path-slug}`, so every deep link shared by a reader breaks the day
// the path is renamed — and renaming a path is exactly what versioning is for.
//
// Callbacks are out: they are routed to as part of their parent's page, so
// there is no fallback route id to name and nothing for the reader to fix.
export const operationIdPresent = {
  id: 'operation-id-present',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      if (entry.kind === 'callback') continue
      const id = entry.op.operationId
      check(typeof id === 'string' && Boolean(id.trim()), {
        op: entry,
        params: { fallbackId: entry.key },
      })
    }
  },
}
