import { listOf } from '../../openapi/model.js'
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
//
// One check per operation; when no operation carries a tag at all, that is one
// decision about the document — one check, at `paths`, counting them.
export const operationTagged = {
  id: 'operation-tagged',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const labels = new Set(
      listOf(ctx.document.tags)
        .filter((tag) => typeof tag?.kind === 'string' && tag.kind && tag.kind !== 'nav')
        .map((tag) => tag.name),
    )
    const tagged = (entry) =>
      Array.isArray(entry.op.tags) &&
      entry.op.tags.some((tag) => typeof tag === 'string' && tag.trim() && !labels.has(tag))
    const operations = ctx.operations.filter((entry) => entry.kind === 'operation')
    if (operations.length > 1 && !operations.some(tagged)) {
      check(false, { location: 'paths', dataPath: '/paths', params: { count: operations.length } })
      return
    }
    for (const entry of operations) check(tagged(entry), { op: entry, params: { count: 1 } })
  },
}
