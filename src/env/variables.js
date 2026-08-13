import { effectiveVariables } from './host-credentials.js'

// The composition of the two places a `{{var}}` can come from: the
// environment the user edits, and the overlay the host page feeds
// (docs/host-credentials.md §4).
//
// `effectiveVariables` was already the one merge; this is the one *source*.
// The difference matters: a helper has to be remembered at every call site,
// and the app had grown four places that each re-wired the same two inputs by
// hand — plus three spellings of "is this credential resolvable", which is the
// same question asked of the same two inputs. A consumer now takes one
// dependency and cannot compose it wrongly, because it does not compose it.
//
// Deliberately NOT a mandatory funnel: two surfaces read the environment alone
// and say why (`api-webhook-simulator.js` §5.1 sends to the user's own
// receiver, `oauth-block.js` reads the client id the user typed). They keep
// using `envStore` directly, and that reads as the choice it is.
//
// Pure of `window`, like both of its inputs.
export class VariableSource extends EventTarget {
  #envStore
  #host

  constructor({ envStore, host }) {
    super()
    this.#envStore = envStore
    this.#host = host
    // One signal for "what resolves has changed", carrying which side moved:
    // the two are not interchangeable to a consumer. An environment change
    // means a different environment (base URL, headers, everything), a host
    // change means the same environment with credentials filled in — and a
    // panel that reset on the latter would throw away a request being typed.
    const relay = (origin) => () =>
      this.dispatchEvent(new CustomEvent('change', { detail: { origin } }))
    envStore.addEventListener('change', relay('env'))
    host.addEventListener('change', relay('host'))
  }

  // The overlay itself, for the surfaces that DRIVE it rather than read
  // through it: the refresh button, the boot fill, the 401 replay. Reading
  // credentials goes through `for`/`sourceOf` instead.
  get host() {
    return this.#host
  }

  // The merged map, in the one order: host overlay under the environment, run
  // scope on top.
  for(env = this.#envStore.selected(), runValues = null) {
    return effectiveVariables(this.#host.values(), this.#envStore.variablesOf(env), runValues)
  }

  // Where a resolvable variable gets its value — `'env'`, `'host'`, or null
  // when nothing resolves it. Same rule as `for`, stated once: an environment
  // variable holding the empty string is void and falls through to the
  // overlay. `env` is explicit because the switcher asks this of environments
  // that are not the selected one.
  sourceOf(name, env = this.#envStore.selected()) {
    const own = this.#envStore.variablesOf(env)[name]
    if (own && own.value !== '') return 'env'
    return this.#host.covers(name) ? 'host' : null
  }
}
