// An operation that documents no successful outcome: no 2XX or 3XX code or
// range, no `default` — an empty Responses Object included, which every version
// forbids outright. Code generators type a client method's return value from its
// success response; with none, the method returns nothing and every call looks
// like an error to them. This documentation shows the error responses alone,
// and the reader has to guess what a working call returns.
//
// Webhooks and callbacks are left out: those responses come from the
// integrator's server, which the document does not describe. An operation
// with no Responses Object at all is legal from 3.1 and left alone; in 3.0 it is
// `required-field-missing`'s. One check per operation without a success.

const SUCCESS = /^([23]\d\d|[23]XX)$/i

export const responsesSuccess = {
  id: 'responses-success',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      const responses = entry.op.responses
      if (!responses || typeof responses !== 'object' || Array.isArray(responses)) continue
      const success = Object.keys(responses).some((key) => key === 'default' || SUCCESS.test(key))
      if (success) continue
      check(false, { op: entry, dataPath: `${entry.pointer}/responses` })
    }
  },
}
