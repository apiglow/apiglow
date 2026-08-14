// Environment setup links (docs/env-setup-link.md): landing an incoming link,
// building one from scratch, and sharing an environment one already has. All
// three dialogs mount into the shell lazily, and this wiring is created before
// the layout element exists — hence `mount` as a callback rather than the
// layout itself.
import { announce } from '../components/a11y.js'
import { applySetupPlan, decodeSetupLink, planSetup } from '../env/setup-link.js'
import { t } from '../i18n/index.js'
import { setupLinkHash } from '../router.js'

export function createSetupLinks({ envStore, specId, multiSpec, mount, notify }) {
  // Environment setup link (docs/env-setup-link.md §4). The payload was
  // taken off the URL at boot; what is left to do is refuse it or preview it.
  // The dialog exists only when a link actually arrived — it is the landing of
  // a one-shot gesture, not a piece of the chrome.
  // Mounted on the first link that gets as far as a preview: a refusal needs
  // no dialog, and an installation nobody ever sent a link to carries none.
  let setupDialog = null
  const showSetupLink = (setupPayload) => {
    // Locked first, and without decoding: under `environmentsLocked` the
    // config is authoritative on the set and the structure of environments
    // (§5.3), so no link is applicable and its content is beside the point.
    if (envStore.locked) {
      notify('error', t('envSetup.locked'))
      return
    }
    const link = decodeSetupLink(setupPayload)
    if (!link) {
      notify('error', t('envSetup.invalid'))
      return
    }
    // An unknown `#/s/{id}/` falls back silently to the default spec, and a
    // silent fallback here would write staging credentials into another API's
    // environments.
    if (link.spec && link.spec !== specId) {
      notify('error', t('envSetup.wrongSpec', { link: link.spec, active: specId }))
      return
    }
    const match = envStore.list().find((e) => e.name === link.env.name) ?? null
    const plan = planSetup(link, { env: match })
    setupDialog ??= mount(document.createElement('env-setup-dialog'))
    setupDialog.onApply = () => {
      applySetupPlan(plan, { envStore, env: match })
      const message = t('envSetup.applied', { name: plan.name })
      notify('success', message)
      // The write is invisible from where the user is looking (the dialog just
      // closed over the doc), so the spoken channel carries it too (rule 15).
      announce(message)
    }
    setupDialog.open(plan)
  }
  // After the route has rendered (§4.1): the reader has to see which
  // documentation is asking before deciding to configure it. A refusal takes
  // the same path, so its toast lands on a readable page too.
  //
  // A microtask, never a frame: at boot this runs while `layout` is still
  // detached (the caller attaches it), so the preview has to wait — but
  // `requestAnimationFrame` waits for a *paint*, and a document nobody is
  // looking at (background tab, occluded window) is never painted. The payload
  // is off the URL by then and lives nowhere else, so a frame that never comes
  // loses the link for good, without a dialog, a toast or a console line. A
  // microtask runs as soon as the caller's own render returns, painted or not.
  const previewSetupLink = (payload) => queueMicrotask(() => showSetupLink(payload))

  // The from-scratch builder (§3.5). Locked installations get no entry point at
  // all: the manager, which carries one of the two, is not instantiated, and the
  // overview card below is gated on the same condition — that check is this
  // shell's, because non-instantiation covers nothing living outside the manager
  // (decision 3).
  let setupBuilder = null
  const openSetupBuilder = () => {
    if (!setupBuilder) {
      setupBuilder = mount(document.createElement('env-setup-builder'))
      // Only in multi-spec, like the manager's: a mono-spec link has no spec to
      // name, and naming one would refuse the link on a single-API install.
      setupBuilder.specId = multiSpec ? specId : null
      // Preview as recipient (decision 5): the app's own landing takes it from
      // here — §4.1's mid-session arrival scrubs the hash and opens the preview,
      // so what the lead sees IS the recipient's dialog rather than a rendering
      // of it. A component does not navigate, which is why the write is here.
      setupBuilder.onPreview = (encoded) => {
        window.location.hash = setupLinkHash(encoded)
      }
    }
    setupBuilder.open()
  }

  // Sharing an environment one already has (§3.4). Mounted on the first share
  // gesture like the builder, and for the same reason: most readers never hand
  // an environment over, and an installation nobody shared from carries no
  // generator at all.
  let shareDialog = null
  const openShareDialog = (env) => {
    if (!shareDialog) {
      shareDialog = mount(document.createElement('env-share-dialog'))
      // Only in multi-spec: a mono-spec link has no spec to name, and naming
      // one would refuse the link on an installation that has a single API.
      shareDialog.specId = multiSpec ? specId : null
    }
    shareDialog.open(env)
  }

  return { previewSetupLink, openSetupBuilder, openShareDialog }
}
