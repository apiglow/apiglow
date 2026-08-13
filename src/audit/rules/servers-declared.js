// Docs readiness: with no `servers`, environment seeding has nothing to offer
// and the reader must type a base URL by hand before the first try-it call.
// One check for the whole document — this is a property of the schema, not of
// an operation.
export const serversDeclared = {
  id: 'servers-declared',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    const servers = Array.isArray(ctx.document.servers) ? ctx.document.servers : []
    const usable = servers.filter(
      (server) => typeof server?.url === 'string' && server.url.trim(),
    ).length
    check(usable > 0, { location: 'servers', dataPath: '/servers' })
  },
}
