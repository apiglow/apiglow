// Docs readiness: an untagged operation lands in the nav's fallback group,
// alongside every other untagged one — the reader has no way to tell what
// family it belongs to.
//
// Webhooks are out: the nav lists them flat, under their own section, and
// never groups them by tag (`components/api-nav.js`). Tagging one changes
// nothing a reader can see, so demanding it would be a finding with no fix.
export const operationTagged = {
  id: 'operation-tagged',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      const tags = entry.op.tags
      check(Array.isArray(tags) && tags.some((tag) => typeof tag === 'string' && tag.trim()), {
        op: entry,
      })
    }
  },
}
