// Cleartext http as the browser judges it — shared by the try-it's failure
// diagnosis, the OAuth block and the audit, so that the page and its report
// never disagree on what a browser refuses.

// A URL sent in clear over the network: `http:` to a host that is not the
// machine itself. W3C Secure Contexts §3.1 holds `127.0.0.0/8`, `[::1]` and
// `localhost` potentially trustworthy, and nothing sent there leaves the
// machine. A relative URL takes the page's scheme; a host still holding an
// undeclared `{variable}` gives no verdict.
export function isCleartext(url) {
  if (typeof url !== 'string' || !/^http:/i.test(url.trim())) return false
  let host
  try {
    host = new URL(url.trim()).hostname
  } catch {
    return false
  }
  // The URL parser accepts braces in a host: told apart here.
  if (/[{}]/.test(host)) return false
  return !isLoopback(host)
}

// Whether a page of `pageProtocol` sees a `fetch()` of `url` blocked as mixed
// content (W3C Mixed Content §4.4): an https page, a cleartext URL — never
// upgraded, a script's request is blockable. Relative URLs resolve against the
// page first.
export function isBlockedAsMixedContent(
  url,
  pageProtocol = globalThis.location?.protocol ?? '',
  base = globalThis.location?.href,
) {
  if (pageProtocol !== 'https:') return false
  let absolute
  try {
    absolute = new URL(url, base).href
  } catch {
    return false
  }
  return isCleartext(absolute)
}

// Secure Contexts §3.1 also names the fully qualified spellings, trailing dot
// included.
function isLoopback(host) {
  const name = host.endsWith('.') ? host.slice(0, -1) : host
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === '[::1]'
  )
}
