# Conventions

Settled decisions. **A line of this file is never re-litigated** — not in a
review, not in a refactor pass, not by an agent hunting for consistency. If a
question is not answered here, in CLAUDE.md, or in `docs/architecture.md`
§14: choose the simplest option, write it down, it becomes law.

Every entry is a decision, not a preference. "It would be nicer if…" is not a
reason to change one.

The big decisions live elsewhere and are just as frozen: the stack and its
rationale in `docs/architecture.md` §14, the imperative rules in CLAUDE.md,
style mechanics with Biome (`biome.jsonc`). This file holds the smaller
choices those documents don't spell out.

## Naming

- **Custom elements**: kebab-case, no vendor prefix — `api-endpoint-doc`,
  `theme-switcher`. One component per file; the filename matches the tag.
- **Events**: `CustomEvent` with kebab-case names — `tryit-edit`,
  `tryit-response`. App-lifecycle events carry the `apidoc:` prefix
  (`apidoc:ready`); component events don't.
- **Persistent names** (localStorage prefixes, IndexedDB databases, the
  docs-page fence, stable DOM ids): name-neutral `apidoc` prefix, never the
  product name (rule 8, `docs/architecture.md` §14.11). Databases are
  `apidoc-*`, preference keys `apidoc:{specId}:{key}`.
- **IndexedDB stores**: plural nouns, one `const STORE` per module —
  `entries`, `scenarios`, `snapshots`.
- **i18n keys**: dotted `domain.leaf` paths, camelCase leaves —
  `app.loading`, `error.load.network`. Flat map, no nesting.
- **Files**: kebab-case throughout `src/`.
- **Private members**: native `#` fields, not `_name`.

## Code style

- `const` by default, `let` when reassigned, `var` never (generated code
  snippets in `src/export/snippets.js` excepted — they are output, not code).
- Named exports only. No default exports.
- Early return over nested conditionals.
- No abstraction with a single call site.
- Errors are surfaced or logged once at the boundary, never swallowed.
- Comments carry only what the code cannot (policy in CONTRIBUTING.md);
  formatting is whatever Biome produces and is never discussed.

## Frozen public surfaces

Versioned contracts, not implementation details — a rename is a breaking
change for every CDN install, whatever it does for consistency:

- Custom element tag names and emitted events
- The host config schema (`config.example.js`)
- IndexedDB database names, store names, schema versions
- localStorage key names and prefixes
- i18n key names
- The `apidoc:operation` docs-page fence

The snapshot lives in `public-surface.json`, checked by
`npm run check:surface` in CI. Changing one is a product decision: migration
path, then `npm run check:surface -- --update`, with the diff reviewed by a
human.
