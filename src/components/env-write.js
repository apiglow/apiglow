import { t } from '../i18n/index.js'

// The environment a runtime value goes into — a credential typed in the
// cartouche, a token obtained from an OAuth flow. With none selected the write
// provisions one instead of dead-ending, and `create` selects what it makes.
//
// Locked mode is the one case with no escape: there the config owns the set,
// so nothing may be added to it. The store names that state (`writable`) and
// this returns null for it rather than trusting each caller to re-derive the
// rule — the surfaces that offer such a write disable their controls on the
// same predicate, so they never see the null.
//
// Lives here rather than on EnvStore: `src/env/` carries no i18n, and the name
// of an environment nobody asked for is a UI string.
export function envForWrite(envStore) {
  const env = envStore.selected()
  if (env || !envStore.writable) return env
  return envStore.create({ name: t('env.defaultName', { n: envStore.list().length + 1 }) })
}
