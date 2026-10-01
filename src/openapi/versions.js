// The version lines this app claims to support (rule 19). One list, so the
// promise made to the reader (the About dialog), the check that rejects a
// document (the loader) and the audit that says a document is not one it
// reads (`document-openapi`) cannot say different things. A module of its own
// because the audit must not import the loader, and with it ref-parser.
export const SUPPORTED_OPENAPI_VERSIONS = ['3.0', '3.1', '3.2']
// Read too, through conversion rather than through normalization: the app never
// renders a 2.0 document, it renders the 3.0 one `swagger2.js` makes of it. Same
// reason for exporting it — the About dialog says it, and so does the error.
export const SUPPORTED_SWAGGER_VERSIONS = ['2.0']

// What a document whose version this app does not know is read as, when it is
// read at all (the audit's, docs/audit.md §8): the newest semantics, as
// everywhere versions conflict (rule 19).
export const NEWEST_OPENAPI = '3.2.0'

const SUPPORTED_OPENAPI_RE = new RegExp(
  `^(${SUPPORTED_OPENAPI_VERSIONS.map((v) => v.replace('.', '\\.')).join('|')})(\\.|$)`,
)

export function isSupportedOpenapi(version) {
  return typeof version === 'string' && SUPPORTED_OPENAPI_RE.test(version)
}
