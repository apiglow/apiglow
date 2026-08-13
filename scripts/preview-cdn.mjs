// End-to-end CDN simulation (docs/architecture.md §3):
// 1. build dist/, 2. `npm pack` (the exact tarball that would go to npm),
// 3. extract, 4. serve the package content under /npm/{name}@{version}/
//    the way jsDelivr would, plus an allowlist of the repo: demo/,
//    docs-pages/ and tests/e2e/fixtures/ (the e2e suite runs against this
//    server). Nothing else is fetchable.
// Zero npm dependencies: node:http + the system tar.
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT ?? 4173)
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const cdnPrefix = `/npm/${pkg.name}@${pkg.version}/`

// demo/cdn-install.html hardcodes the versioned CDN URL, the way a real
// installation would: a version bump silently turns the demo (and every e2e
// run, which is served this very page) into a 404 unless the page is bumped
// too. Cheaper to fail here, with the fix spelled out.
function checkDemoVersion() {
  const page = join(root, 'demo/cdn-install.html')
  const html = readFileSync(page, 'utf8')
  const declared = /\/npm\/([^@"']+)@([^/"']+)\//.exec(html)
  if (!declared) {
    console.error(`✖ ${page}: no /npm/<name>@<version>/ script URL found`)
    process.exit(1)
  }
  const [url, name, version] = declared
  if (name !== pkg.name || version !== pkg.version) {
    console.error(
      `✖ demo/cdn-install.html points at ${url} but package.json says ` +
        `${pkg.name}@${pkg.version}.\n  Fix the <script src> in demo/cdn-install.html.`,
    )
    process.exit(1)
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
  if (result.status !== 0) {
    console.error(`✖ ${cmd} ${args.join(' ')} failed`)
    process.exit(1)
  }
  return result
}

checkDemoVersion()

console.log('→ npm run build')
run('npm', ['run', 'build'])

const workDir = mkdtempSync(join(tmpdir(), 'apiglow-cdn-'))
console.log('→ npm pack')
const packResult = spawnSync('npm', ['pack', '--pack-destination', workDir], {
  cwd: root,
  encoding: 'utf8',
})
if (packResult.status !== 0) {
  console.error(packResult.stderr)
  process.exit(1)
}
const tarball = packResult.stdout.trim().split('\n').at(-1)
console.log(`→ extracting ${tarball}`)
run('tar', ['-xzf', join(workDir, tarball), '-C', workDir])
// npm pack always extracts into a "package/" folder
const packageDir = join(workDir, 'package')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

// What the demo origin exposes, and nothing else: the demo page and its
// assets, the prose pages, the e2e fixtures (the suite runs against this
// server), and what `apiglow bake` writes there while bake.spec.js runs — a
// baked tree is served next to the host page, so the simulation has to serve it
// too. docs/, CLAUDE.md and the rest of the repo are not fetchable — the
// simulation serves what a deployed demo would, not the working tree.
const SERVED_PREFIXES = ['demo/', 'docs-pages/', 'tests/e2e/fixtures/', 'tests/e2e/baked/']

function resolveFile(pathname) {
  // "CDN" URLs are served from the extracted tarball, everything else from the
  // repo allowlist.
  if (pathname.startsWith(cdnPrefix)) {
    return { base: packageDir, rel: pathname.slice(cdnPrefix.length) }
  }
  // Normalized before the allowlist check, so `demo/../docs/x` is judged as
  // `docs/x`, not by its spelling.
  const rel = normalize(pathname === '/' ? 'demo/cdn-install.html' : pathname.slice(1))
  if (!SERVED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return null
  return { base: root, rel }
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const resolved = resolveFile(decodeURIComponent(url.pathname))
  if (!resolved) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 — ${url.pathname}`)
    return
  }
  const { base, rel } = resolved
  const filePath = join(base, normalize(rel))
  if (!filePath.startsWith(base.endsWith(sep) ? base : base + sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 — ${url.pathname}`)
    return
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
    // Like a real CDN: consumable from any origin.
    'access-control-allow-origin': '*',
    // The demo mock worker sits in demo/ but claims the whole origin: the
    // demo page is at /, the API it answers at /demo-api/….
    ...(rel.endsWith('demo/mock-sw.js') ? { 'service-worker-allowed': '/' } : {}),
  })
  createReadStream(filePath).pipe(res)
}).listen(port, () => {
  console.log(`\nCDN preview → http://localhost:${port}/`)
  console.log(
    `   bundle served from the tarball: http://localhost:${port}${cdnPrefix}dist/app.js\n`,
  )
})
