// The methods a Path Item names as fields, lowercase as the model keys them.
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
]

// The method as it goes on the wire. HTTP methods are case-sensitive: the
// standard ones are uppercase, and a 3.2 `additionalOperations` method is sent
// exactly as the document spells it (`op.verb`) — `purge` is not `PURGE`.
export function wireMethod(method) {
  const text = String(method)
  return HTTP_METHODS.includes(text.toLowerCase()) ? text.toUpperCase() : text
}
