import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The author-side CLI (`apiglow bake`, docs/seo.md §4), built for Node instead
// of the browser: its commands import half of src/, and the published package
// ships dist/ alone — so the sources they need are bundled into dist/cli.js,
// which package.json exposes as the `apiglow` bin.
//
// A second config rather than a second entry in vite.config.js: the two builds
// share nothing. The app is a browser lib pinned to `browserslist`, with
// Tailwind and the asset-copying plugins; this one externalizes every runtime
// dependency (an installed package resolves them from its own node_modules)
// and never sees a stylesheet.
export default defineConfig({
  build: {
    // Node build: bare imports stay imports instead of being bundled in.
    ssr: fileURLToPath(new URL('./scripts/cli.mjs', import.meta.url)),
    // The floor the repo declares for itself (.nvmrc); the browser baseline
    // has no say here — nothing of this file is fetched by a reader.
    target: 'node24',
    // dist/ already holds the app build, which runs first and empties it.
    emptyOutDir: false,
    // A CLI whose stack traces an author has to read: shipping it minified
    // buys nothing, since it is never downloaded over the wire.
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'cli.js' },
    },
  },
})
