// A document with no operation under `paths` and no webhook: there is no
// endpoint to document. This documentation shows its home page with "This
// schema declares no operations — there is nothing to document yet", and an
// empty navigation; a generator produces an SDK with no method. OpenAPI 3.1
// allows it on purpose — a document holding only `components`, a library
// other documents reference — and such a document is not one to publish as an
// API reference (or switch this rule off for it).
//
// Hidden operations count: the audit reads the whole document. One check per
// document.
export const documentHasOperations = {
  id: 'document-has-operations',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    check(
      ctx.operations.some((entry) => entry.kind === 'operation' || entry.kind === 'webhook'),
      { location: 'paths', dataPath: '/paths' },
    )
  },
}
