import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'))

// Config kept separate from vite.config.js: tests only target the pure core
// (docs/architecture.md) and don't need the Tailwind pipeline or lib mode.
export default defineConfig({
  // Mirrors vite.config.js: a pure-core module that names the build (the HAR
  // export's `creator`) must read the same constants under test as in the
  // bundle, or the test proves nothing about what ships.
  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['tests/**/*.test.js'],
    // `fake-indexeddb/auto` installs the IndexedDB globals once for every test
    // file instead of each store test having to know the incantation. It is a
    // pure global install with no per-file state, so the files that never
    // touch IndexedDB are unaffected.
    setupFiles: ['fake-indexeddb/auto'],
    coverage: {
      // Informational, no threshold gate. Scoped to the pure core on purpose:
      // src/components/ is covered by the e2e suite against the packed bundle,
      // and including it here would report a number that means nothing.
      include: [
        'src/audit/**',
        'src/env/**',
        'src/export/**',
        'src/i18n/**',
        'src/import/**',
        'src/openapi/**',
        'src/scenarios/**',
        'src/search/**',
        'src/storage/**',
        'src/router.js',
        'src/specs.js',
      ],
      reporter: ['text-summary', 'html'],
    },
  },
})
