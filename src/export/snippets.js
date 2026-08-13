// Multi-language snippets (competitive analysis, prio 1) — pure generators
// consuming the same resolved request model as toCurl: { method, url,
// headers, body, form }. Tested by snapshot, redaction by default via the
// same primitives as cURL.

import { fileBodyLabel } from '../openapi/body-kind.js'
import { shellQuote } from './curl.js'
import { redactEntry, templatizeEntry } from './redact.js'

// Per-language escaping: each quote() produces a valid string literal for
// values that may contain quotes, backslashes and newlines.
const jsQuote = (v) =>
  `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`
// Python: double quotes by default, but single quotes for strings that
// contain doubles (the requests idiom for a JSON payload — avoids a soup of
// \").
const pyQuote = (v) => {
  const s = String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  return s.includes('"') ? `'${s.replace(/'/g, "\\'")}'` : `"${s}"`
}
const phpQuote = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const goQuote = (v) =>
  `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`
// Ruby: double quotes to keep `\n` an escape rather than a real line break,
// so `#{`, `#@` and `#$` must be neutralized — a body containing `#{...}`
// would otherwise be interpolated as Ruby code.
const rbQuote = (v) =>
  `"${String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/#(?=[{@$])/g, '\\#')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`
// Java and C# share the Java string literal grammar; no interpolation in
// either (C# only interpolates on a `$"…"` prefix, which we never emit).
const javaQuote = goQuote
const csQuote = goQuote

// "The request carries a body": one definition, since every generator branches
// on it and they must all agree on what an empty one is.
const hasBody = (body) => body !== null && body !== undefined && body !== ''

// A valid JSON body is re-emitted compacted: readable in a one-line literal,
// and stable regardless of the formatting typed into the editor.
function compactJson(body) {
  try {
    return JSON.stringify(JSON.parse(body))
  } catch {
    return null
  }
}

export function toFetch({ method, url, headers = {}, body = null, form = null, file = null }) {
  const lines = []
  const opts = [`  method: '${String(method).toUpperCase()}',`]
  const headerEntries = Object.entries(headers)
  if (headerEntries.length) {
    opts.push('  headers: {')
    for (const [name, value] of headerEntries) opts.push(`    ${jsQuote(name)}: ${jsQuote(value)},`)
    opts.push('  },')
  }
  if (form?.length) {
    lines.push('const form = new FormData()')
    for (const f of form) {
      if (f.fileName !== undefined)
        lines.push(`form.append(${jsQuote(f.name)}, fileInput.files[0], ${jsQuote(f.fileName)})`)
      else lines.push(`form.append(${jsQuote(f.name)}, ${jsQuote(f.value)})`)
    }
    lines.push('')
    opts.push('  body: form,')
  } else if (file?.name) {
    lines.push(`// ${fileBodyLabel(file)}`, 'const file = fileInput.files[0]', '')
    opts.push('  body: file,')
  } else if (hasBody(body)) {
    const json = compactJson(body)
    opts.push(`  body: ${json !== null ? `JSON.stringify(${json})` : jsQuote(body)},`)
  }
  lines.push(
    `const response = await fetch(${jsQuote(url)}, {`,
    ...opts,
    '})',
    '',
    'const data = await response.json()',
  )
  return lines.join('\n')
}

export function toPythonRequests({
  method,
  url,
  headers = {},
  body = null,
  form = null,
  file = null,
}) {
  const m = String(method).toLowerCase()
  const args = [`    ${pyQuote(url)},`]
  const headerEntries = Object.entries(headers)
  if (headerEntries.length) {
    args.push('    headers={')
    for (const [name, value] of headerEntries)
      args.push(`        ${pyQuote(name)}: ${pyQuote(value)},`)
    args.push('    },')
  }
  if (form?.length) {
    const files = form.filter((f) => f.fileName !== undefined)
    const fields = form.filter((f) => f.fileName === undefined)
    if (files.length) {
      args.push('    files={')
      for (const f of files)
        args.push(`        ${pyQuote(f.name)}: open(${pyQuote(f.fileName)}, "rb"),`)
      args.push('    },')
    }
    if (fields.length) {
      args.push('    data={')
      for (const f of fields) args.push(`        ${pyQuote(f.name)}: ${pyQuote(f.value)},`)
      args.push('    },')
    }
  } else if (file?.name) {
    args.push(`    data=open(${pyQuote(file.name)}, "rb"),`)
  } else if (hasBody(body)) {
    // Valid JSON recompacted: a pre-filled multiline body would become a
    // soup of escaped \n's in the Python literal.
    args.push(`    data=${pyQuote(compactJson(body) ?? body)},`)
  }
  return [
    'import requests',
    '',
    `response = requests.${m}(`,
    ...args,
    ')',
    '',
    'print(response.json())',
  ].join('\n')
}

export function toPhpCurl({ method, url, headers = {}, body = null, form = null, file = null }) {
  const lines = ['<?php', `$ch = curl_init(${phpQuote(url)});`]
  lines.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${String(method).toUpperCase()}');`)
  lines.push('curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);')
  const headerEntries = Object.entries(headers)
  if (headerEntries.length) {
    lines.push('curl_setopt($ch, CURLOPT_HTTPHEADER, [')
    for (const [name, value] of headerEntries) lines.push(`    ${phpQuote(`${name}: ${value}`)},`)
    lines.push(']);')
  }
  if (form?.length) {
    lines.push('curl_setopt($ch, CURLOPT_POSTFIELDS, [')
    for (const f of form) {
      if (f.fileName !== undefined)
        lines.push(`    ${phpQuote(f.name)} => new CURLFile(${phpQuote(f.fileName)}),`)
      else lines.push(`    ${phpQuote(f.name)} => ${phpQuote(f.value)},`)
    }
    lines.push(']);')
  } else if (file?.name) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents(${phpQuote(file.name)}));`)
  } else if (hasBody(body)) {
    lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${phpQuote(body)});`)
  }
  lines.push('$response = curl_exec($ch);', 'curl_close($ch);', '', 'echo $response;')
  return lines.join('\n')
}

export function toGo({ method, url, headers = {}, body = null, form = null, file = null }) {
  const m = String(method).toUpperCase()
  const imports = new Set(['fmt', 'io', 'net/http'])
  const pre = []
  let bodyArg = 'nil'
  if (form?.length) {
    imports.add('bytes').add('mime/multipart')
    pre.push('var buf bytes.Buffer', 'w := multipart.NewWriter(&buf)')
    for (const f of form) {
      if (f.fileName !== undefined) {
        imports.add('os')
        pre.push(
          `file, _ := os.Open(${goQuote(f.fileName)})`,
          `part, _ := w.CreateFormFile(${goQuote(f.name)}, ${goQuote(f.fileName)})`,
          'io.Copy(part, file)',
          'file.Close()',
        )
      } else {
        pre.push(`w.WriteField(${goQuote(f.name)}, ${goQuote(f.value)})`)
      }
    }
    pre.push('w.Close()', '')
    bodyArg = '&buf'
  } else if (file?.name) {
    imports.add('os')
    // `*os.File` is an io.Reader: http streams it, nothing is buffered.
    pre.push(`payload, _ := os.Open(${goQuote(file.name)})`, 'defer payload.Close()', '')
    bodyArg = 'payload'
  } else if (hasBody(body)) {
    imports.add('strings')
    // Go raw string if possible (no backtick in the body), otherwise escaped literal.
    const literal = String(body).includes('`') ? goQuote(body) : `\`${body}\``
    pre.push(`payload := strings.NewReader(${literal})`, '')
    bodyArg = 'payload'
  }
  const lines = ['package main', '', 'import (']
  for (const imp of [...imports].sort()) lines.push(`\t"${imp}"`)
  lines.push(')', '', 'func main() {')
  for (const p of pre) lines.push(p ? `\t${p}` : '')
  lines.push(`\treq, _ := http.NewRequest(${goQuote(m)}, ${goQuote(url)}, ${bodyArg})`)
  if (form?.length) lines.push('\treq.Header.Set("Content-Type", w.FormDataContentType())')
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`\treq.Header.Set(${goQuote(name)}, ${goQuote(value)})`)
  }
  lines.push(
    '\tres, _ := http.DefaultClient.Do(req)',
    '\tdefer res.Body.Close()',
    '\tbody, _ := io.ReadAll(res.Body)',
    '\tfmt.Println(string(body))',
    '}',
  )
  return lines.join('\n')
}

export function toHttpie({ method, url, headers = {}, body = null, form = null, file = null }) {
  const lines = [`http ${String(method).toUpperCase()} ${shellQuote(url)}`]
  if (form?.length) {
    lines[0] = `http --form ${String(method).toUpperCase()} ${shellQuote(url)}`
    for (const f of form) {
      lines.push(
        f.fileName !== undefined
          ? `${f.name}@${shellQuote(f.fileName)}`
          : shellQuote(`${f.name}=${f.value}`),
      )
    }
  }
  for (const [name, value] of Object.entries(headers)) lines.push(shellQuote(`${name}:${value}`))
  if (!form?.length && file?.name) {
    // HTTPie has no "raw body from a file" flag: the shell feeds it on stdin.
    return `${lines.join(' \\\n  ')} \\\n  < ${shellQuote(file.name)}`
  }
  if (!form?.length && !file?.name && hasBody(body)) {
    lines.push(`--raw ${shellQuote(body)}`)
  }
  return lines.join(' \\\n  ')
}

export function toNodeAxios({ method, url, headers = {}, body = null, form = null, file = null }) {
  const imports = ["import axios from 'axios'"]
  const pre = []
  const opts = [`  method: ${jsQuote(String(method).toLowerCase())},`, `  url: ${jsQuote(url)},`]
  const headerEntries = Object.entries(headers)
  if (headerEntries.length) {
    opts.push('  headers: {')
    for (const [name, value] of headerEntries) opts.push(`    ${jsQuote(name)}: ${jsQuote(value)},`)
    opts.push('  },')
  }
  if (form?.length) {
    imports.push("import { openAsBlob } from 'node:fs'")
    pre.push('const form = new FormData()')
    for (const f of form) {
      if (f.fileName !== undefined)
        pre.push(
          `form.append(${jsQuote(f.name)}, await openAsBlob(${jsQuote(f.fileName)}), ${jsQuote(f.fileName)})`,
        )
      else pre.push(`form.append(${jsQuote(f.name)}, ${jsQuote(f.value)})`)
    }
    pre.push('')
    opts.push('  data: form,')
  } else if (file?.name) {
    imports.push("import { createReadStream } from 'node:fs'")
    // A stream, not a readFileSync: axios pipes it, the payload never sits
    // whole in memory.
    pre.push(
      `// ${fileBodyLabel(file)}`,
      `const payload = createReadStream(${jsQuote(file.name)})`,
      '',
    )
    opts.push('  data: payload,')
  } else if (hasBody(body)) {
    // Compacted JSON is already a valid JS object literal — axios serializes
    // it, which is the idiom here (a raw string would be sent verbatim).
    const json = compactJson(body)
    opts.push(`  data: ${json !== null ? json : jsQuote(body)},`)
  }
  return [
    ...imports,
    '',
    ...pre,
    'const response = await axios({',
    ...opts,
    '})',
    '',
    'console.log(response.data)',
  ].join('\n')
}

// Ruby method → Net::HTTP request class. Net::HTTP has one class per verb and
// no generic constructor, so an unlisted verb has no snippet to offer: we fall
// back to the generic Net::HTTPGenericRequest form.
const RUBY_REQUEST_CLASS = {
  GET: 'Net::HTTP::Get',
  POST: 'Net::HTTP::Post',
  PUT: 'Net::HTTP::Put',
  PATCH: 'Net::HTTP::Patch',
  DELETE: 'Net::HTTP::Delete',
  HEAD: 'Net::HTTP::Head',
  OPTIONS: 'Net::HTTP::Options',
}

export function toRuby({ method, url, headers = {}, body = null, form = null, file = null }) {
  const m = String(method).toUpperCase()
  const requires = ["require 'net/http'", "require 'uri'"]
  const lines = [`uri = URI(${rbQuote(url)})`]
  const klass = RUBY_REQUEST_CLASS[m]
  lines.push(
    klass
      ? `request = ${klass}.new(uri)`
      : `request = Net::HTTPGenericRequest.new(${rbQuote(m)}, true, true, uri)`,
  )
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`request[${rbQuote(name)}] = ${rbQuote(value)}`)
  }
  if (form?.length) {
    lines.push('request.set_form([')
    for (const f of form) {
      lines.push(
        f.fileName !== undefined
          ? `  [${rbQuote(f.name)}, File.open(${rbQuote(f.fileName)})],`
          : `  [${rbQuote(f.name)}, ${rbQuote(f.value)}],`,
      )
    }
    // set_form writes its own Content-Type with the generated boundary.
    lines.push("], 'multipart/form-data')")
  } else if (file?.name) {
    // body_stream rather than body: Net::HTTP streams it, but then it also
    // needs the length it can no longer infer.
    lines.push(`request.body_stream = File.open(${rbQuote(file.name)}, "rb")`)
    lines.push(`request.content_length = File.size(${rbQuote(file.name)})`)
  } else if (hasBody(body)) {
    lines.push(`request.body = ${rbQuote(compactJson(body) ?? body)}`)
  }
  return [
    ...requires,
    '',
    ...lines,
    '',
    "response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|",
    '  http.request(request)',
    'end',
    '',
    'puts response.body',
  ].join('\n')
}

export function toJava({ method, url, headers = {}, body = null, form = null, file = null }) {
  const m = String(method).toUpperCase()
  const imports = new Set([
    'java.net.URI',
    'java.net.http.HttpClient',
    'java.net.http.HttpRequest',
    'java.net.http.HttpResponse',
  ])
  const pre = []
  let publisher = 'HttpRequest.BodyPublishers.noBody()'
  // Builder lines appended after the declared headers, for the ones whose
  // value is a Java expression rather than a literal.
  const computedHeaders = []
  if (form?.length) {
    // java.net.http ships no multipart publisher: the parts are assembled by
    // hand and the boundary is ours, hence the explicit Content-Type below.
    imports
      .add('java.nio.charset.StandardCharsets')
      .add('java.util.ArrayList')
      .add('java.util.List')
    // The delimiter is read from the `boundary` variable everywhere, so the
    // parts and the Content-Type header cannot drift apart.
    const part = (tail) =>
      `parts.add(("--" + boundary + ${javaQuote(tail)}).getBytes(StandardCharsets.UTF_8));`
    pre.push('String boundary = "ApiGlowBoundary";', 'List<byte[]> parts = new ArrayList<>();')
    for (const f of form) {
      if (f.fileName !== undefined) {
        imports.add('java.nio.file.Files').add('java.nio.file.Path')
        pre.push(
          part(
            `\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          ),
          `parts.add(Files.readAllBytes(Path.of(${javaQuote(f.fileName)})));`,
          `parts.add(${javaQuote('\r\n')}.getBytes(StandardCharsets.UTF_8));`,
        )
      } else {
        pre.push(part(`\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`))
      }
    }
    pre.push(part('--\r\n'), '')
    computedHeaders.push('    .header("Content-Type", "multipart/form-data; boundary=" + boundary)')
    publisher = 'HttpRequest.BodyPublishers.ofByteArrays(parts)'
  } else if (file?.name) {
    imports.add('java.nio.file.Path')
    publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${javaQuote(file.name)}))`
  } else if (hasBody(body)) {
    publisher = `HttpRequest.BodyPublishers.ofString(${javaQuote(compactJson(body) ?? body)})`
  }
  const builder = [
    'HttpRequest request = HttpRequest.newBuilder()',
    `    .uri(URI.create(${javaQuote(url)}))`,
  ]
  for (const [name, value] of Object.entries(headers)) {
    builder.push(`    .header(${javaQuote(name)}, ${javaQuote(value)})`)
  }
  builder.push(...computedHeaders, `    .method(${javaQuote(m)}, ${publisher})`, '    .build();')
  return [
    ...[...imports].sort().map((i) => `import ${i};`),
    '',
    ...pre,
    ...builder,
    '',
    'HttpResponse<String> response = HttpClient.newHttpClient()',
    '    .send(request, HttpResponse.BodyHandlers.ofString());',
    '',
    'System.out.println(response.body());',
  ].join('\n')
}

export function toCsharp({ method, url, headers = {}, body = null, form = null, file = null }) {
  const m = String(method).toUpperCase()
  const usings = new Set(['System', 'System.Net.Http'])
  // HttpClient refuses content headers on the request: Content-Type has to
  // reach the HttpContent instead, or SendAsync throws at runtime.
  const contentTypeKey = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type')
  const contentType = contentTypeKey ? headers[contentTypeKey] : null
  const verb = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE)$/.test(m)
    ? `HttpMethod.${m[0]}${m.slice(1).toLowerCase()}`
    : `new HttpMethod(${csQuote(m)})`
  const lines = [
    'var client = new HttpClient();',
    `var request = new HttpRequestMessage(${verb}, ${csQuote(url)});`,
  ]
  for (const [name, value] of Object.entries(headers)) {
    if (name === contentTypeKey) continue
    lines.push(`request.Headers.Add(${csQuote(name)}, ${csQuote(value)});`)
  }
  if (form?.length) {
    lines.push('', 'var form = new MultipartFormDataContent();')
    for (const f of form) {
      if (f.fileName !== undefined) {
        usings.add('System.IO')
        lines.push(
          `form.Add(new StreamContent(File.OpenRead(${csQuote(f.fileName)})), ${csQuote(f.name)}, ${csQuote(f.fileName)});`,
        )
      } else {
        lines.push(`form.Add(new StringContent(${csQuote(f.value)}), ${csQuote(f.name)});`)
      }
    }
    lines.push('request.Content = form;')
  } else if (file?.name) {
    usings.add('System.IO')
    lines.push('', `request.Content = new StreamContent(File.OpenRead(${csQuote(file.name)}));`)
    if (contentType) {
      usings.add('System.Net.Http.Headers')
      lines.push(
        `request.Content.Headers.ContentType = new MediaTypeHeaderValue(${csQuote(contentType)});`,
      )
    }
  } else if (hasBody(body)) {
    usings.add('System.Text')
    lines.push(
      '',
      `request.Content = new StringContent(${csQuote(compactJson(body) ?? body)}, Encoding.UTF8, ${csQuote(contentType ?? 'application/json')});`,
    )
  }
  return [
    ...[...usings].sort().map((u) => `using ${u};`),
    '',
    ...lines,
    '',
    'var response = await client.SendAsync(request);',
    'Console.WriteLine(await response.Content.ReadAsStringAsync());',
  ].join('\n')
}

// The language registry: everything per-language lives here, so adding one is
// a single entry rather than four maps kept in lockstep across three files.
//   generate — the pure generator
//   hljs     — grammar for syntax highlighting (registered in markdown.js)
//   mark     — short proper name for the panel's language tiles (never a UI
//              string: the full label is `export.format.<key>`)
//   icon     — the export bar's emoji (§14.2: an icon set is not an admissible
//              runtime dependency)
// The order is that of the selectors (try-it row and export bar).
export const SNIPPET_LANGUAGES = {
  fetch: { generate: toFetch, hljs: 'javascript', mark: 'JS', icon: '🟨' },
  node: { generate: toNodeAxios, hljs: 'javascript', mark: 'Node', icon: '🟩' },
  python: { generate: toPythonRequests, hljs: 'python', mark: 'Py', icon: '🐍' },
  php: { generate: toPhpCurl, hljs: 'php', mark: 'PHP', icon: '🐘' },
  ruby: { generate: toRuby, hljs: 'ruby', mark: 'Ruby', icon: '💎' },
  java: { generate: toJava, hljs: 'java', mark: 'Java', icon: '☕' },
  csharp: { generate: toCsharp, hljs: 'csharp', mark: 'C#', icon: '🟪' },
  go: { generate: toGo, hljs: 'go', mark: 'Go', icon: '🐹' },
  httpie: { generate: toHttpie, hljs: 'bash', mark: 'HTTPie', icon: '🥧' },
}

// cURL is a snippet target of the same selectors but not a generator of this
// module (src/export/curl.js owns it): its presentation is declared here so
// the two selectors still read one list.
export const CURL_TARGET = { mark: 'cURL', icon: '🖥️' }

// Counterpart of curlFromEntry for all languages: same redact (default) and
// substitute ({{var}} template mode) options.
export function snippetFromEntry(lang, entry, { redact = true, substitute = true } = {}) {
  let source = entry
  if (!substitute) source = templatizeEntry(entry)
  if (redact) source = redactEntry(source)
  const headers = Array.isArray(source.request.headers)
    ? Object.fromEntries(source.request.headers)
    : (source.request.headers ?? {})
  return SNIPPET_LANGUAGES[lang].generate({
    method: entry.method,
    url: source.request.url,
    headers,
    body: source.request.body,
    form: source.request.form,
    file: source.request.bodyFile,
  })
}
