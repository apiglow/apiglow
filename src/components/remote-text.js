// Text files declared in config (Markdown pages, scenario files):
// downloaded on demand, only once per session and per URL.
//
// Module-level cache rather than per-component: a page reopened three times
// must not go back to the network, and the two consumers have exactly the
// same need.
const cache = new Map()

export function fetchTextCached(url) {
  if (!cache.has(url)) {
    const promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    // A failure must not poison the cache: retried on the next render.
    promise.catch(() => cache.delete(url))
    cache.set(url, promise)
  }
  return cache.get(url)
}
