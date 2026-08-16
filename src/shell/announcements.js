// The impure half of the announcements (docs/architecture.md §5.17): the file
// form of `announcements`, which is what turns a config key into a news
// channel — the operator publishes by editing one small JSON file, with no
// redeploy of the host page.
import { manifestAnnouncements } from '../announcements.js'

async function loadFile(url) {
  const response = await fetch(new URL(url, window.location.href).href)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return manifestAnnouncements(await response.json())
}

// → { root, spec } raw entries, or **null** when neither side names a file:
// the inline form needs no fetch and went through `resolveSpecConfig` like
// every other key.
//
// A file that does not load is logged and yields nothing. Unlike a docs
// manifest, whose failure leaves a visible hole in the navigation, a missing
// announcement is invisible by nature — and an error banner about the banner
// that failed to arrive would be worse than silence for every reader who was
// never meant to see one.
export async function loadAnnouncementSources({ root, spec }) {
  if (typeof root !== 'string' && typeof spec !== 'string') return null
  const resolve = async (value, label) => {
    if (typeof value !== 'string') return Array.isArray(value) ? value : []
    try {
      return await loadFile(value)
    } catch (err) {
      console.error(`[api-doc] announcements (${label}) failed:`, value, err)
      return []
    }
  }
  const [rootEntries, specEntries] = await Promise.all([
    resolve(root, 'root'),
    resolve(spec, 'spec'),
  ])
  return { root: rootEntries, spec: specEntries }
}
