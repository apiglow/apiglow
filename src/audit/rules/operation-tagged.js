// Docs readiness: an untagged operation lands in the nav's fallback group,
// alongside every other untagged one — the reader has no way to tell what
// family it belongs to.
//
// Webhooks are out: the nav lists them flat, under their own section, and
// never groups them by tag (`components/api-nav.js`). Tagging one changes
// nothing a reader can see, so demanding it would be a finding with no fix.
//
// Same reason 3.2 label tags do not count: a tag whose `kind` is not
// navigational badges the operation instead of filing it, so an operation
// carrying only those lands in the fallback group like an untagged one.
export const operationTagged = {
  id: 'operation-tagged',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const labels = new Set(
      (ctx.document.tags ?? [])
        .filter((tag) => typeof tag?.kind === 'string' && tag.kind && tag.kind !== 'nav')
        .map((tag) => tag.name),
    )
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      const tags = entry.op.tags
      check(
        Array.isArray(tags) &&
          tags.some((tag) => typeof tag === 'string' && tag.trim() && !labels.has(tag)),
        { op: entry },
      )
    }
  },
}
