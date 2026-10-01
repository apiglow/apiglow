// A schema marked both `readOnly` and `writeOnly`: the value may never be sent
// and is never returned, so it exists nowhere. OAS 3.0 forbids it outright
// (Schema Object, MUST NOT); 3.1 hands both keywords to JSON Schema, which
// does not forbid the pair but gives it no meaning either. This documentation
// drops a readOnly property from request samples and a writeOnly one from
// response samples — this one appears in neither, and every generator has to
// pick which of the two flags to believe.
export const readonlyWriteonly = {
  id: 'readonly-writeonly',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (schema.readOnly !== true || schema.writeOnly !== true) continue
      check(false, { op, location, dataPath, params: {} })
    }
  },
}
