import { fileURLToPath } from 'node:url'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import { defineConfig } from 'vite'
import { AUDIT_STRING, catalogSlice } from './scripts/catalog-slice.mjs'

// The schema audit, built as a file of its own that app.js imports on the
// first visit to #/audit (docs/architecture.md §14.8). A separate pass rather
// than a chunk of the app build: the app stays one file whatever the bundler
// decides, and the two share nothing but pure helpers, each bundle carrying
// its own copy — the engine holds no state the app would need to see.
export default defineConfig({
  plugins: [catalogSlice(AUDIT_STRING)],
  build: {
    // Same browsers as app.js, which is what imports it.
    target: browserslistToEsbuild(),
    // dist/ already holds the app build, which runs first and empties it.
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/audit.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'audit.js',
    },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
