import { operationKey, pathItemOperations, pointerTarget, webhookKey } from '../../openapi/model.js'
import { pointer } from '../pointer.js'

// A response `link` whose target names no operation of this document. Unlike a
// discriminator mapping, there is nothing legitimate to mistake this for: an
// `operationId` is a document-local identifier, and an `operationRef` starting
// with `#/` promises a pointer into this very file. Hence `warning` — a broken
// link is a chain the API advertises and cannot honour.
//
// An `operationRef` into another document is skipped rather than flagged: a
// real usage this app cannot follow (it loads one document at a time), exactly
// like an external discriminator target. So is a link declaring neither field,
// which is an invalid Link Object — a schema validator's job, not the audit's.
//
// Resolution mirrors `resolveLinkTargets` in `src/openapi/model.js`, pointer
// decoding included, minus the hide filter: a hidden operation is still
// declared, so a link at it is correct even though the doc shows no
// destination to click.

export const linkTarget = {
  id: 'link-target',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const ids = new Set()
    const declared = new Set()
    for (const [container, keyOf] of [
      [ctx.document.paths, operationKey],
      [ctx.document.webhooks, webhookKey],
    ]) {
      for (const [name, pathItem] of Object.entries(container ?? {})) {
        if (!pathItem || typeof pathItem !== 'object') continue
        for (const [method, op] of pathItemOperations(pathItem)) {
          ids.add(keyOf(name, method, op))
          declared.add(op)
        }
      }
    }

    for (const entry of ctx.operations) {
      for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
        const links = response?.links
        if (!links || typeof links !== 'object') continue
        for (const [name, link] of Object.entries(links)) {
          if (!link || typeof link !== 'object') continue
          const target = declaredTarget(link)
          if (!target) continue
          const resolved = target.id
            ? ids.has(target.id)
            : declared.has(pointerTarget(ctx.document, target.ref))
          check(resolved, {
            op: entry,
            dataPath: `${entry.pointer}${pointer('responses', status, 'links', name)}`,
            params: { link: name, target: target.id ?? target.ref },
          })
        }
      }
    }
  },
}

function declaredTarget(link) {
  if (typeof link.operationId === 'string' && link.operationId) return { id: link.operationId }
  const ref = link.operationRef
  return typeof ref === 'string' && ref.startsWith('#/') ? { ref } : null
}
