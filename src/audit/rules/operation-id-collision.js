import { identifierKey } from '../identifier-key.js'

// Two operationIds that differ as strings and become one name in generated
// code: `getUser`, `get_user`, `GetUser`, `get-user`. openapi-generator
// camelizes an operationId into its method name (`get_user` → `getUser`);
// when two land on one name within a tag, it renames the later `getUser_0`
// with a warning — so which operation keeps the plain name depends on
// declaration order, and moving one in the document renames the other's
// method in every SDK built from the next version of the document.
//
// The key is `identifier-key.js`': case aside, separators dropped. Identical
// strings are `duplicate-operation-id`'s, not this rule's. Compared across the
// whole document — the operationId space the specification makes unique —
// webhooks and callbacks included. One check per operation with an
// operationId; the finding on each one after the first of its key, naming an
// earlier one spelled otherwise.
export const operationIdCollision = {
  id: 'operation-id-collision',
  category: 'consistency',
  severity: 'warning',
  run(ctx, check) {
    const spellings = new Map()
    for (const entry of ctx.operations) {
      const id = entry.op.operationId
      if (typeof id !== 'string' || !id.trim()) continue
      const key = identifierKey(id)
      const earlier = spellings.get(key) ?? []
      const other = earlier.find((spelling) => spelling !== id)
      if (!earlier.includes(id)) spellings.set(key, [...earlier, id])
      check(other === undefined, {
        op: entry,
        dataPath: `${entry.pointer}/operationId`,
        params: other === undefined ? { operationId: id } : { operationId: id, other },
      })
    }
  },
}
