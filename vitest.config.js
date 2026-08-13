import { defineConfig } from 'vitest/config'

// Config kept separate from vite.config.js: tests only target the pure core
// (docs/architecture.md) and don't need the Tailwind pipeline or lib mode.
export default defineConfig({
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
