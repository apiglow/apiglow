import { pointerFrom } from '../scenarios/pointer.js'

// JSON Pointer (RFC 6901) building for a finding's `dataPath`: what the UI
// shows when the finding has no operation to link to (components, info,
// top-level security…). Escaping is not optional — a path like `/pets/{id}`
// as a raw segment would designate a different node entirely.
export function pointer(...segments) {
  return pointerFrom(segments)
}
