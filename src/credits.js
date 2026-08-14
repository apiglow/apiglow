// Third-party components that TRAVEL IN THE BUNDLE: the five runtime
// dependencies plus the two CSS libraries compiled into app.css. Build tooling
// (Vite, Vitest, Playwright, Biome) is deliberately absent — none of it reaches
// the reader's browser, and listing it would bury the few notices that
// legally do ship.
//
// Versions and SPDX ids are restated here rather than read from package.json:
// the distributed file is a lone <script>, with no manifest next to it to read
// at runtime. `tests/credits.test.js` fails the moment the two drift apart,
// which is also what makes adding a runtime dependency (architecture.md
// §14.2) impossible to
// do silently.
export const BUNDLED_CREDITS = [
  {
    id: 'daisyui',
    pkg: 'daisyui',
    name: 'daisyUI',
    version: '5.7.17',
    license: 'MIT',
    url: 'https://daisyui.com',
  },
  {
    id: 'tailwind',
    pkg: 'tailwindcss',
    name: 'Tailwind CSS',
    version: '4.3.3',
    license: 'MIT',
    url: 'https://tailwindcss.com',
  },
  {
    id: 'ref-parser',
    pkg: '@apidevtools/json-schema-ref-parser',
    name: 'JSON Schema $Ref Parser',
    version: '16.0.0',
    license: 'MIT',
    url: 'https://apidevtools.com/json-schema-ref-parser/',
  },
  {
    id: 'marked',
    pkg: 'marked',
    name: 'Marked',
    version: '18.0.9',
    license: 'MIT',
    url: 'https://marked.js.org',
  },
  {
    id: 'dompurify',
    pkg: 'dompurify',
    name: 'DOMPurify',
    version: '3.4.13',
    license: 'MPL-2.0 OR Apache-2.0',
    url: 'https://github.com/cure53/DOMPurify',
  },
  {
    id: 'json-p3',
    pkg: 'json-p3',
    name: 'JSON P3',
    version: '2.2.2',
    license: 'MIT',
    url: 'https://github.com/jg-rp/json-p3',
  },
  {
    id: 'highlight',
    pkg: 'highlight.js',
    name: 'highlight.js',
    version: '11.12.0',
    license: 'BSD-3-Clause',
    url: 'https://highlightjs.org',
  },
  {
    id: 'source-serif',
    pkg: '@fontsource-variable/source-serif-4',
    name: 'Source Serif 4 (Adobe)',
    version: '5.3.0',
    license: 'OFL-1.1',
    url: 'https://github.com/adobe-fonts/source-serif',
  },
]

// The entries above that ship as compiled CSS or as a static asset rather than
// as an import: they are devDependencies (nothing in src/ imports them) yet
// their output is part of the distribution — daisyUI and Tailwind inside
// app.css, the display font as dist/fonts/*.woff2 — so they are credited like
// the rest. Named here because the test is the only other place that has to
// know.
export const CSS_CREDIT_PACKAGES = ['daisyui', 'tailwindcss']
export const ASSET_CREDIT_PACKAGES = ['@fontsource-variable/source-serif-4']

// Mirrors LICENSE at the repo root (asserted by the same test). A CDN install
// ships no LICENSE file: the About dialog is where the notice actually reaches
// the people running the code.
export const PROJECT_LICENSE = {
  spdx: 'MIT',
  copyright: 'Copyright (c) 2026 Jeremy Perret',
}
