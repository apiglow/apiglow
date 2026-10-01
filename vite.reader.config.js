import { fileURLToPath } from 'node:url'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import { defineConfig } from 'vite'

// The tolerant document reader (docs/architecture.md §14.21), built as a file
// of its own that the loader imports only once a schema has failed its strict
// read. Same shape as the audit's pass (vite.audit.config.js, §14.8): a fixed
// name next to app.js, the YAML parser it carries kept off every healthy boot.
export default defineConfig({
  build: {
    // Same browsers as app.js, which is what imports it.
    target: browserslistToEsbuild(),
    // dist/ already holds the app build, which runs first and empties it.
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/openapi/read-document.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'read-document.js',
    },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
