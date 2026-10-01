// URI syntax checks shared by `uri-form` and `self-uri`. Deliberately loose:
// they catch what cannot be a URI at all — whitespace, control characters, the
// characters RFC 3986 never allows unescaped, a value even a URL parser
// refuses — and accept every relative reference, which the specification
// allows wherever it asks for a URL or a URI ("Relative References in URIs").
const NEVER_IN_A_URI = /[\s<>"{}|\\^`\p{Cc}]/u

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function isUriReference(value) {
  if (!value.trim() || NEVER_IN_A_URI.test(value)) return false
  try {
    new URL(value, 'https://base.invalid/dir/')
    return true
  } catch {
    return false
  }
}

// A URI with a scheme of its own, which an XML namespace must be.
export function isAbsoluteUri(value) {
  return SCHEME.test(value) && isUriReference(value)
}

// Not RFC 5322 in full: one `@`, something on each side, none of the
// characters an address can only carry quoted. `mailto:` is a URL, not an
// address.
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+$/

export function isEmail(value) {
  return EMAIL.test(value)
}
