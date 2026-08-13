// en/fr key drift, plus keys no call site can reach.
//
// Reachability is the hard half: a naive `t('literal')` scan over-reports by
// ~46 keys, because call sites also reach keys through constant tables
// (CREDENTIAL_LABEL, FLOW_LABEL, WARNING_KEYS…) and through template
// families like t(`prefix.${x}`). So a key counts as reached when it appears
// as any string literal anywhere in src/ — table values included — or when
// it matches a template family passed to t().
import { headline, read, section, walk } from './lib.mjs'

const en = JSON.parse(read('src/i18n/en.json'))
const fr = JSON.parse(read('i18n/fr.json'))

const enKeys = Object.keys(en)
const missing = enKeys.filter((k) => !(k in fr))
const extra = Object.keys(fr).filter((k) => !(k in en))

// One concatenated blob, searched for the *quoted* form of each key.
// Tokenizing string literals instead would desync on the first apostrophe
// in a comment and report hundreds of live keys as dead.
const blob = walk('src').map(read).join('\n')

// Only template literals passed straight to t() become families: any other
// backtick string with a hole would match far too much.
const families = [...blob.matchAll(/\bt\(\s*`([^`]*)`/g)].map((m) => {
  const pattern = m[1]
    .split(/\$\{[^}]*\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\w.-]+')
  return new RegExp(`^${pattern}$`)
})

const quoted = (key) =>
  blob.includes(`'${key}'`) || blob.includes(`"${key}"`) || blob.includes(`\`${key}\``)

const unreached = enKeys.filter((key) => !quoted(key) && !families.some((re) => re.test(key)))

headline(
  'dead i18n keys',
  unreached.length,
  `of ${enKeys.length} keys — fr: ${Object.keys(fr).length}, ${missing.length} missing, ${extra.length} extra`,
)
section('unreached from src/', unreached)
section('missing from i18n/fr.json', missing)
section('in i18n/fr.json but not in en.json', extra)
