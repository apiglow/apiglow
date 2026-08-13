// Registers demo/mock-sw.js for the whole origin: the demo pages are served
// at / and the mocked API lives at /demo-api/…, both outside demo/. The dev
// server and the CDN preview allow that wider scope with a
// Service-Worker-Allowed header.
//
// A worker never controls the page that registered it until it claims it.
// clients.claim() makes that the normal case; the wait below covers the
// window before the claim lands, and the one-shot reload the case where it
// never does. It cannot loop — the flag is only cleared once a controller is
// actually there.
//
// The resulting state is published on <html data-mock-api> so a human (or an
// e2e test) can tell "the mock is answering" from "you are about to hit a
// 404".
;(() => {
  const RELOAD_FLAG = 'apidoc:demo-sw-reloaded'
  const CLAIM_TIMEOUT_MS = 500
  const publish = (value) => {
    document.documentElement.dataset.mockApi = value
  }

  if (!('serviceWorker' in navigator)) {
    publish('unavailable')
    return
  }
  publish('pending')

  navigator.serviceWorker
    .register('/demo/mock-sw.js', { scope: '/' })
    .then(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
          setTimeout(resolve, CLAIM_TIMEOUT_MS)
        })
      }
      if (navigator.serviceWorker.controller) {
        sessionStorage.removeItem(RELOAD_FLAG)
        publish('ready')
        return
      }
      if (sessionStorage.getItem(RELOAD_FLAG)) {
        publish('unavailable')
        return
      }
      sessionStorage.setItem(RELOAD_FLAG, '1')
      location.reload()
    })
    .catch((error) => {
      publish('unavailable')
      console.error('[demo] mock API service worker not registered:', error)
    })
})()
