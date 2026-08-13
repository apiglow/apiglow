// `mode: 'no-cors'` is the only way a browser can deliver to a receiver that
// sends no `Access-Control-Allow-Origin` at all (webhook.site, a bare ngrok
// tunnel, a handler written for server-to-server traffic): the request leaves
// without a preflight. The price is paid on the request headers — the fetch
// spec makes the `Headers` guard drop everything that isn't CORS-safelisted,
// and it drops it *silently*. We partition beforehand so the simulator can
// name what will not reach the receiver instead of letting it vanish.

const SAFELISTED_NAMES = ['accept', 'accept-language', 'content-language', 'content-type']

// `Range` is safelisted too, but only in its simple byte-range form. A webhook
// delivery never carries one, so it is deliberately reported as dropped rather
// than growing a parser for it.

const SAFE_CONTENT_TYPE_ESSENCES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]

// Stricter charset the spec reserves for the two language headers.
const LANGUAGE_VALUE = /^[0-9A-Za-z *,\-.;=]*$/

const UNSAFE_PUNCTUATION = '"():<>?@[\\]{}'

// `fetch` throws outright in no-cors mode on any other method, so the mode
// isn't offered at all for a webhook declared with PUT, PATCH or DELETE.
const NO_CORS_METHODS = ['GET', 'HEAD', 'POST']

export function isNoCorsMethod(method) {
  return NO_CORS_METHODS.includes(String(method).toUpperCase())
}

/** @returns {{ kept: Record<string,string>, dropped: string[] }} */
export function partitionNoCorsHeaders(headers) {
  const kept = {}
  const dropped = []
  for (const [name, value] of Object.entries(headers)) {
    if (isNoCorsSafelisted(name, value)) kept[name] = value
    else dropped.push(name)
  }
  return { kept, dropped }
}

export function isNoCorsSafelisted(name, value) {
  const lower = name.trim().toLowerCase()
  if (!SAFELISTED_NAMES.includes(lower)) return false
  // The 128 cap is on bytes, not code points.
  if (new TextEncoder().encode(value).length > 128) return false
  if (lower === 'accept-language' || lower === 'content-language') return LANGUAGE_VALUE.test(value)
  if (hasCorsUnsafeByte(value)) return false
  if (lower !== 'content-type') return true
  return SAFE_CONTENT_TYPE_ESSENCES.includes(mimeEssence(value))
}

// "CORS-unsafe request-header byte": anything below 0x20 except tab, DEL, and
// the punctuation above. Note what is *absent* — `/`, `;`, `=` and `,` are
// safe, which is what lets `text/plain;charset=utf-8` through.
function hasCorsUnsafeByte(value) {
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code < 0x20 && code !== 0x09) return true
    if (code === 0x7f) return true
    if (UNSAFE_PUNCTUATION.includes(char)) return true
  }
  return false
}

// Essence = `type/subtype`, lowercased, parameters stripped. Anything that
// isn't a parsable mime type is not safelisted.
function mimeEssence(value) {
  const essence = value.split(';')[0].trim().toLowerCase()
  return /^[!#$%&'*+\-.^_`|~\w]+\/[!#$%&'*+\-.^_`|~\w]+$/.test(essence) ? essence : null
}
