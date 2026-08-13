import { decodeScenarioFile, encodeScenarioFile } from '../scenarios/model.js'
import { fromBase64Url, toBase64Url } from './share.js'

// Scenario sharing via link (docs/scenarios.md §8.2) — pure functions.
//
// Same pipeline as request sharing: base64url in the hash's pseudo-query.
// The payload is exactly the export file (§8.1): a single canonical form, a
// single defensive validation (`decodeScenarioFile`) — a link is never
// anything more than a file that travels.

// Beyond that, messaging apps and mail clients truncate well before the
// browser's limits: better to offer the file than to produce a dead link.
export const SHARE_URL_MAX = 8000

export function encodeScenarioLink(scenario) {
  return toBase64Url(JSON.stringify(encodeScenarioFile(scenario)))
}

// Untrusted input (pasted URL): never throws, a list of coded errors instead.
export function decodeScenarioLink(encoded) {
  let payload
  try {
    payload = JSON.parse(fromBase64Url(String(encoded ?? '')))
  } catch {
    return { scenario: null, errors: [{ code: 'link-invalid' }] }
  }
  return decodeScenarioFile(payload, { source: 'local' })
}
