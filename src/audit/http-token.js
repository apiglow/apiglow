// RFC 9110 §5.6.2 `token`: what an HTTP field name and a method name are made
// of. Anything else — a space, a colon, a non-ASCII letter — makes `fetch` throw
// before a byte leaves the browser.
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function isToken(value) {
  return typeof value === 'string' && TOKEN.test(value)
}
