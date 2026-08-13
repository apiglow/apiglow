import { makeDraft } from './draft.js'

// "Paste a cURL command" — the inverse of `src/export/curl.js`, and it has to
// read more than what we ourselves write: what people paste comes from a
// browser's "Copy as cURL", from a README, from a colleague's terminal.
//
// Pure and defensive (§4.6): an unreadable command yields error codes, never a
// throw.

// Flags that take no argument and change nothing we model: swallowed silently,
// because warning about `-s` on every pasted command would train the reader to
// ignore the warning list.
const NO_ARG = new Set([
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-L',
  '--location',
  '-k',
  '--insecure',
  '-i',
  '--include',
  '-v',
  '--verbose',
  '-f',
  '--fail',
  '-j',
  '--junk-session-cookies',
  '-N',
  '--no-buffer',
  '-g',
  '--globoff',
  '-4',
  '-6',
  '-#',
  '--progress-bar',
  '--compressed',
  '--no-keepalive',
  '--http1.1',
  '--http2',
  '--http3',
  '--tlsv1.2',
  '--tlsv1.3',
])

// Same idea, one argument to swallow with them. Transport and output concerns:
// a documentation page has nothing to do with `-o out.json`.
const ARG_IGNORED = new Set([
  '-o',
  '--output',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-x',
  '--proxy',
  '-w',
  '--write-out',
  '--connect-timeout',
  '-m',
  '--max-time',
  '--max-redirs',
  '--retry',
  '--cacert',
  '--cert',
  '--key',
  '--resolve',
  '--interface',
  '--limit-rate',
])

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-ascii', '--data-binary'])
const FORM_FLAGS = new Set(['-F', '--form', '--form-string'])

// Short options whose argument may be attached to them (`-XPOST`). Listed
// explicitly: attaching an argument to a flag that takes none would eat a
// letter of the next flag in a cluster.
const SHORT_WITH_ARG = new Set([
  '-X',
  '-H',
  '-d',
  '-u',
  '-F',
  '-b',
  '-A',
  '-e',
  '-o',
  '-x',
  '-m',
  '-w',
  '-T',
])

// A bare token is the URL only if it looks like one. Without this test, the
// argument of an unknown flag would be mistaken for the target — and an unknown
// flag is exactly the case where we cannot know whether it consumes one.
const URL_RE = /^([a-z][\w+.-]*:\/\/|\/|\{\{|[\w.-]+\.[a-z]{2,}([/:?]|$))/i

export function parseCurl(text) {
  const source = String(text ?? '').trim()
  if (!source) return { requests: [], warnings: [], errors: [{ code: 'import-empty' }] }
  const tokens = tokenize(source)
  if (!tokens.length) return { requests: [], warnings: [], errors: [{ code: 'import-empty' }] }
  if (tokens[0] === 'curl') tokens.shift()

  const draft = makeDraft()
  const dataParts = []
  let explicitMethod = null
  let asQuery = false
  let bareUrl = null

  for (let i = 0; i < tokens.length; i++) {
    // Two attached-argument spellings to undo before anything else: the long
    // `--header=X`, and the short `-XPOST` / `-H'Name: v'` that every
    // hand-written command uses.
    const token = tokens[i]
    const eq = token.startsWith('--') ? token.indexOf('=') : -1
    const attached =
      eq > 0
        ? [token.slice(0, eq), token.slice(eq + 1)]
        : token.length > 2 && SHORT_WITH_ARG.has(token.slice(0, 2))
          ? [token.slice(0, 2), token.slice(2)]
          : null
    const flag = attached ? attached[0] : token
    const inlineArg = attached ? attached[1] : null
    const next = () => (inlineArg !== null ? inlineArg : tokens[++i])

    if (!token.startsWith('-') || token === '-') {
      // Bare token: the URL, or the argument of a flag we did not recognize.
      if (!bareUrl && URL_RE.test(token)) bareUrl = token
      continue
    }
    if (NO_ARG.has(flag)) continue
    if (ARG_IGNORED.has(flag)) {
      next()
      continue
    }
    switch (flag) {
      case '-X':
      case '--request':
        explicitMethod = String(next() ?? '').toUpperCase()
        break
      case '--url':
        bareUrl = String(next() ?? '')
        break
      case '-H':
      case '--header': {
        const raw = String(next() ?? '')
        const header = parseHeader(raw)
        if (header) draft.headers.push(header)
        else draft.warnings.push({ code: 'curl-header-invalid', value: raw })
        break
      }
      case '--data-urlencode': {
        // curl encodes the value and only the value: `name=a b` becomes
        // `name=a%20b`, a bare `a b` becomes `a%20b`.
        const raw = String(next() ?? '')
        const split = raw.indexOf('=')
        dataParts.push(
          split > 0
            ? `${raw.slice(0, split)}=${encodeURIComponent(raw.slice(split + 1))}`
            : encodeURIComponent(raw),
        )
        break
      }
      case '-G':
      case '--get':
        asQuery = true
        break
      case '-I':
      case '--head':
        explicitMethod = explicitMethod ?? 'HEAD'
        break
      case '-u':
      case '--user': {
        const raw = String(next() ?? '')
        const split = raw.indexOf(':')
        draft.auth = {
          scheme: 'basic',
          username: split >= 0 ? raw.slice(0, split) : raw,
          password: split >= 0 ? raw.slice(split + 1) : '',
        }
        break
      }
      case '-b':
      case '--cookie':
        // T3 domain: a browser `fetch` cannot set `Cookie`, so importing it
        // would build a request the send strips without saying so.
        draft.warnings.push({ code: 'import-cookie-dropped', value: String(next() ?? '') })
        break
      case '-T':
      case '--upload-file':
        // The bytes are on the pasting machine's disk, not in the tab. Only the
        // name survives, and it says why the body came back empty.
        draft.warnings.push({ code: 'import-file-body', name: String(next() ?? '') })
        draft.bodyMode = 'file'
        break
      default:
        if (DATA_FLAGS.has(flag)) {
          dataParts.push(String(next() ?? ''))
        } else if (FORM_FLAGS.has(flag)) {
          const raw = String(next() ?? '')
          const field = parseFormField(raw)
          if (field) {
            draft.fields = draft.fields ?? []
            draft.fields.push(field)
            draft.bodyMode = 'formdata'
          } else {
            draft.warnings.push({ code: 'curl-form-invalid', value: raw })
          }
        } else if (!expandCluster(flag)) {
          draft.warnings.push({ code: 'curl-flag-ignored', flag })
        }
    }
  }

  if (!bareUrl) return { requests: [], warnings: [], errors: [{ code: 'curl-no-url' }] }

  // Several `-d` on one command line concatenate with `&` — that is curl's own
  // rule, and it is what makes `-d a=1 -d b=2` a two-field form.
  const data = dataParts.join('&')
  if (asQuery && data) {
    draft.url = bareUrl + (bareUrl.includes('?') ? '&' : '?') + data
  } else {
    draft.url = bareUrl
    if (data) {
      draft.body = data
      draft.bodyMode = 'raw'
    }
  }
  // curl's default: GET, or POST as soon as there is something to send.
  draft.method = explicitMethod || (draft.body || draft.fields ? 'POST' : 'GET')
  return { requests: [draft], warnings: [], errors: [] }
}

// `-sSL` is one token for three no-argument flags. Recognized only when EVERY
// letter is a no-argument flag: `-sd` would be `-s` plus `-d` eating the next
// token, and guessing that wrong loses the body.
function expandCluster(flag) {
  if (!/^-[A-Za-z0-9#]{2,}$/.test(flag)) return false
  return [...flag.slice(1)].every((c) => NO_ARG.has(`-${c}`))
}

// `Name: value`, and curl's `Name;` which sends the header empty.
function parseHeader(raw) {
  const colon = raw.indexOf(':')
  if (colon < 0) {
    const trimmed = raw.trim()
    if (trimmed.endsWith(';') && trimmed.length > 1)
      return { name: trimmed.slice(0, -1).trim(), value: '' }
    return null
  }
  const name = raw.slice(0, colon).trim()
  if (!name) return null
  return { name, value: raw.slice(colon + 1).trim() }
}

// `name=value`, `name=@path` / `name=<path` for a file. cURL's `;type=` and
// `;headers=` suffixes describe the part's encoding, which the panel's field
// list has no slot for — the operation's own `encoding` object does.
function parseFormField(raw) {
  const eq = raw.indexOf('=')
  if (eq <= 0) return null
  const name = raw.slice(0, eq)
  const value = raw.slice(eq + 1)
  if (value.startsWith('@') || value.startsWith('<')) {
    return { name, value: '', fileName: value.slice(1).split(';')[0] }
  }
  return { name, value: value.split(';')[0] }
}

// POSIX word splitting, the exact inverse of `shellQuote`. Single quotes take
// everything literally (so `'\''` falls out of the general rules on its own:
// close, escaped quote, reopen); double quotes honour the four escapes a shell
// honours; a backslash before a newline is a line continuation.
function tokenize(source) {
  const tokens = []
  let current = ''
  let started = false
  const push = () => {
    if (started) tokens.push(current)
    current = ''
    started = false
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') {
      const next = source[i + 1]
      if (next === '\n') {
        i += 1
        continue
      }
      if (next === '\r' && source[i + 2] === '\n') {
        i += 2
        continue
      }
      if (next === undefined) continue
      current += next
      started = true
      i += 1
      continue
    }
    if (c === "'") {
      started = true
      const end = source.indexOf("'", i + 1)
      // Unterminated quote: take the rest of the line rather than dropping it —
      // a truncated paste still says which URL it was about.
      current += source.slice(i + 1, end < 0 ? undefined : end)
      i = end < 0 ? source.length : end
      continue
    }
    if (c === '"') {
      started = true
      i += 1
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          const next = source[i + 1]
          if (next === '\n') i += 1
          else if (next === '"' || next === '\\' || next === '$' || next === '`') current += next
          else current += `\\${next ?? ''}`
          i += 2
          continue
        }
        current += source[i]
        i += 1
      }
      continue
    }
    if (/\s/.test(c)) {
      push()
      continue
    }
    current += c
    started = true
  }
  push()
  return tokens
}
