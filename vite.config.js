import { cpSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import { defineConfig } from 'vite'

// The non-bundled language files (i18n/*.json) are loaded at runtime via
// new URL(..., import.meta.url): Rollup never sees them in the module graph,
// so we copy them into dist/i18n/ by hand.
function copyI18n() {
  return {
    name: 'copy-i18n',
    closeBundle() {
      const src = fileURLToPath(new URL('./i18n', import.meta.url))
      const dest = fileURLToPath(new URL('./dist/i18n', import.meta.url))
      if (existsSync(src)) cpSync(src, dest, { recursive: true })
    },
  }
}

// The display font referenced by app.css. Same contract as i18n/: the woff2 is
// loaded at runtime relative to the stylesheet (`url("./fonts/…")`), so the
// bundler never sees it — Vite's lib mode would otherwise inline it as base64
// into app.css, doubling its weight. Copied into dist/fonts/ at build time,
// served from node_modules in dev (where the relative URL resolves against the
// page root, the injected <style> having no URL of its own).
const FONT_FILE = 'source-serif-4-latin-wght-normal.woff2'
const FONT_SRC = `./node_modules/@fontsource-variable/source-serif-4/files/${FONT_FILE}`
function displayFont() {
  return {
    name: 'display-font',
    configureServer(server) {
      server.middlewares.use(`/fonts/${FONT_FILE}`, (_req, res) => {
        res.setHeader('content-type', 'font/woff2')
        res.setHeader('cache-control', 'no-cache')
        res.end(readFileSync(fileURLToPath(new URL(FONT_SRC, import.meta.url))))
      })
    },
    closeBundle() {
      const dest = fileURLToPath(new URL(`./dist/fonts/${FONT_FILE}`, import.meta.url))
      cpSync(fileURLToPath(new URL(FONT_SRC, import.meta.url)), dest)
    },
  }
}

// The demo mock worker lives in demo/ but must control the whole origin (the
// demo page is at /, the mocked API at /demo-api/…): only a
// Service-Worker-Allowed header lets a script claim a scope above its own
// directory. Served raw, without going through the transform pipeline — a
// service worker is not part of the module graph.
function demoServiceWorker() {
  return {
    name: 'demo-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/demo/mock-sw.js', (_req, res) => {
        res.setHeader('content-type', 'text/javascript; charset=utf-8')
        res.setHeader('service-worker-allowed', '/')
        res.setHeader('cache-control', 'no-cache')
        res.end(readFileSync(fileURLToPath(new URL('./demo/mock-sw.js', import.meta.url))))
      })
    },
  }
}

// The diagnostics and the About dialog report who built the bundle and where
// the project lives — only knowable at build time. Injected field by field
// rather than imported: importing package.json would inline the whole manifest
// into the CDN bundle.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
)

export default defineConfig({
  plugins: [tailwindcss(), copyI18n(), displayFont(), demoServiceWorker()],
  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_HOMEPAGE__: JSON.stringify(pkg.homepage ?? null),
    __APP_BUGS__: JSON.stringify(pkg.bugs?.url ?? null),
  },
  build: {
    // The declared support baseline (package.json `browserslist`) is the single
    // source of truth: hardcoding a target here would let the two drift, and
    // the CDN bundle is the one artifact an out-of-baseline browser chokes on.
    target: browserslistToEsbuild(),
    lib: {
      entry: fileURLToPath(new URL('./src/app.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'app.js',
      // Without this, Vite names the extracted CSS after the package name.
      cssFileName: 'app',
    },
    rollupOptions: {
      // ref-parser only imports undici (Node fetch + anti-SSRF DNS pinning) on
      // a Node-only code path, never reached in the browser — but Rolldown
      // constant-folds its "hidden" dynamic import and would bundle 460 kB of
      // dead node:* polyfills. We leave it as an external import instead.
      external: ['undici'],
      // Merges dynamic-import chunks (ref-parser's node:dns stub) into
      // app.js: the CDN distribution stays a single JS file.
      output: { codeSplitting: false },
    },
  },
})
