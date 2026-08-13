# Spec registry — what we claim, against what is published

Maintained by the `/spec-sync` skill (`.claude/skills/spec-sync/SKILL.md`).
One row per format the app claims to support (CLAUDE.md rule 19). Every
`/spec-sync` run reads this file first and updates it last; it is what makes
the runs idempotent. `Latest known` is only ever written from a URL fetched
during a run — `—` means never checked online yet — and each row's claims
were judged against the version that column records.

Detector: `npm run health:specs` (`scripts/health/spec-versions.mjs`) —
the registry-vs-code arm of the drift check: every version constant in
`src/` must match this table's `Implemented` column. The online version
watch is not scriptable and stays a fetch during the run. Like
`health:skills`, deliberately not part of the `npm run health` aggregate
(that aggregate is code-health's contract).

**Active plan**: none

| Format | Role | Implemented | Latest known | Source of truth |
|---|---|---|---|---|
| OpenAPI | import | 3.0.x / 3.1.x / 3.2.0 | 3.2.0 | https://spec.openapis.org + github.com/OAI/OpenAPI-Specification releases; watch github.com/OAI/sig-moonwalk for 4.0 signals |
| JSON Schema | import (dialect of the normalized model) | 2020-12 | 2020-12 | https://json-schema.org/specification |
| Swagger (OpenAPI 2.0) | import by conversion (`src/openapi/swagger2.js`) | 2.0 | 2.0 (frozen) | https://spec.openapis.org/oas/v2.0 |
| OpenAPI Overlay | applied at load (`src/openapi/overlay.js`) | 1.1 (`OVERLAY_VERSION`; 1.0 documents read with 1.1 semantics) | 1.1.0 (published 2026-01-16) | github.com/OAI/Overlay-Specification releases |
| Arazzo | export (`src/export/arazzo.js`) + import (`src/import/arazzo.js`) + CI hand-off through third-party runners (`src/export/ci.js`, `CI_RUNNERS` — see the note below) | 1.1.0 (`ARAZZO_VERSION`; 1.0 documents imported too; deep-audited — every object read or named, `xpath` the one waiver) | 1.1.0 (published 2026-05-18) | github.com/OAI/Arazzo-Specification releases |
| HAR | export (`src/export/har.js`) + import (`src/import/har.js`) | 1.2 | 1.2 (frozen) | https://w3c.github.io/web-performance/specs/HAR/Overview.html (see the note below on the source of truth) |
| Postman Collection | export (`src/export/postman.js`) + import (`src/import/postman.js`) | v2.1.0 (`SCHEMA_URL`) | v2.1.0 | github.com/postmanlabs/schemas + schema.getpostman.com |
| cURL | export (`src/export/curl.js`) + import (`src/import/curl.js`) | informal (no versioned spec) | n/a | https://curl.se/docs/manpage.html — check emitted flags stay valid, nothing else |
| llms.txt | export (`src/export/llms.js` index + `src/export/llms-full.js`) | index + full | unversioned | https://llmstxt.org |
| MCP | export of client config for a third-party OpenAPI→MCP bridge (`src/export/mcp.js`) | `mcpServers` envelope + `MCP_BRIDGES` table | bridge contracts unchanged | https://modelcontextprotocol.io/specification (date-versioned) |
| JSON | serialization the schema document may arrive in — URL and inline alike (`src/openapi/loader.js`) | RFC 8259 / ECMA-404 (`JSON.parse`, and ref-parser's own JSON parser on the URL path) | — | https://www.rfc-editor.org/rfc/rfc8259 + https://ecma-international.org/publications-and-standards/standards/ecma-404/ |
| YAML | serialization the schema document may arrive in — URL and inline alike (`src/openapi/loader.js`) | 1.2 core schema (js-yaml, reached through ref-parser; 1.1-era tags accepted by its fallback schema) | — | https://yaml.org/spec/ — watch the spec project for a revision past 1.2.2 |

**The two serialization rows** are here because the product claims them —
"OpenAPI 3.0/3.1/3.2, JSON and YAML" (`docs/openapi-coverage.md` §1) is one
claim in two halves, and a registry that tracked only the version half would
leave the other unwatched. They carry no version constant in `src/`, so
`health:specs` has nothing to compare for them, exactly like cURL and
llms.txt; what a run checks is that the loader still accepts all four
combinations, which `tests/loader-remote.test.js` and
`tests/loader-inline.test.js` assert.

## Deep audits

`Latest known` says a format's *version* is covered. It says nothing about
whether its **constructs** are — and the two are not the same claim, which is
what this table exists to keep apart. A row here means someone walked the
spec's object model field by field, against the revision the row records;
`never` means the only thing established is the version.

The table also bounds the standard run. Without it, a run has no way to tell a
format whose constructs were verified from one whose weren't, and the
temptation is to verify a little on every pass — which never converges,
because there is always one more construct a notch deeper. A `never` row is an
invitation to run `deep`, not a licence to audit sideways (SKILL.md, step 3).

| Format | Deep audit | Revision walked |
|---|---|---|
| OpenAPI | never as a single walk — but `docs/openapi-coverage.md` is the construct-level contract, built session by session | 3.2.0 |
| JSON Schema | never | — |
| Swagger (OpenAPI 2.0) | never | — |
| OpenAPI Overlay | never | — |
| Arazzo | **done** — every object and every field read or named; `xpath` the one waiver | 1.1.0 |
| HAR | never | — |
| Postman Collection | never | — |
| cURL | n/a — no spec to walk, only the emitted flags | — |
| llms.txt | n/a — no versioned spec; the structural claim is re-read each run | — |
| MCP | n/a — we implement no MCP construct; the watched contracts are the bridges' | — |
| JSON | never | — |
| YAML | never | — |

Arazzo is the format with a construct-level claim that is not merely a
version claim: its whole object model was enumerated first and confronted
second, which is what lets a later standard run answer "has this been
checked?" without checking again.

**Two rows that will never carry a revision**, and the reason is the same
both times — there is nothing published to compare against, so "up to date"
has to be re-established by reading, not by diffing a version string:

- **llms.txt** declares no version and no revision scheme, only
  "Published: September 3, 2024". A run checks the structural claim
  instead: H1 + blockquote, then H2-delimited link lists.
- **MCP**: see the note below — the watched contracts are the bridges', and
  neither is versioned.

**MCP, what actually needs watching**: not the MCP specification
itself — we implement none of it — but the two contracts the generated config
depends on and neither of which is versioned. The `mcpServers` envelope is the
de-facto client config shape, and the flags/environment variables of each entry
in `MCP_BRIDGES` (`src/export/mcp.js`) belong to that project. At the recorded
state both match what `MCP_BRIDGES` emits (`OPENAPI_SPEC_PATH` /
`API_BASE_URL` / `API_HEADERS`; `--spec` / `--targetUrl` / `--overlays` /
`--headers`); a `/spec-sync` run re-checks them there:

- https://github.com/ivo-toby/mcp-openapi-server (`@ivotoby/openapi-mcp-server`)
- https://github.com/TykTechnologies/api-to-mcp (`@tyk-technologies/api-to-mcp`)

**Arazzo runners, the same kind of contract**: the CI hand-off
(`docs/scenario-handoff.md` §4) generates a job that runs a workflow through
somebody else's CLI, and `CI_RUNNERS` (`src/export/ci.js`) is the one table
holding what each of them takes — for the reason `MCP_BRIDGES` is one table.
Two things per entry need re-reading, and neither is derivable from the Arazzo
version above: the **command shape** (the flags the job passes) and the
**Arazzo revision the project claims for itself**, which is what the panel
compares the document against before naming what would be ignored. Claiming
more than a project states about itself would invent a contract we do not own,
so an entry stating nothing is recorded as stating nothing. At the recorded
state:

- https://redocly.com/docs/respect/commands/respect — `npx @redocly/cli respect`,
  `--workflow`, `--input name=value`; claims Arazzo 1.0.1.
- https://docs.jentic.com/getting-started/arazzo-runner/ —
  `arazzo-runner execute-workflow`, `--workflow-id`, `--inputs` (one JSON
  object); claims no revision.

The two CI platforms' YAML (GitHub Actions, GitLab CI) is a third unversioned
contract of the same family, checked by reading a generated job rather than by
diffing a version.

The MCP registration also ships as a `claude mcp add` command and as two
editor install links (`toMcpCommand`, `toMcpDeepLinks`) — three more unversioned
contracts of the same kind, each belonging to the tool that reads it: the CLI's
argument shape, `cursor://anysphere.cursor-deeplink/mcp/install`
(`name` + base64 `config`) and `vscode:mcp/install` (URL-encoded JSON carrying
its own `name`). They are generated from the entry the JSON block shows, so a
bridge change reaches all three at once; what a run re-checks here is the three
URL/argument shapes themselves.

**HAR, why the source of truth is the W3C draft**: the format's original
page (`softwareishard.com/blog/har-12-spec/`), Jan Odvarko's and the one
everyone cites, stopped answering — and a version watch whose URL cannot be
fetched is a claim from memory in disguise, exactly what step 2 forbids. The
row points at the W3C Web Performance editor's draft, which carries the same
text (the `(new in 1.2)` annotations included) and answers. Nothing about HAR
itself changed: 1.2 is still the last version and the format is still frozen.
If the original comes back it is welcome as a second link, but the row keeps
a URL that responds.

**YAML is the one of the two serializations with something to walk**, which is
why its row says `never` rather than `n/a`: anchors and aliases, merge keys,
multi-document streams, explicit tags and duplicate keys are all constructs a
real OpenAPI document uses, and only the version claim is established today.
JSON's row is `never` on thinner grounds — BOM handling and duplicate keys are
about all there is — but the two are answered by the same walk, so they stay
symmetric.

Formats deliberately out of scope of this registry: CommonMark/GFM and
highlight.js grammars — their versions are driven by the pinned runtime
dependencies (`marked`, `highlight.js`), not by a spec claim of ours. YAML
looks like it belongs to that bucket and does not: js-yaml is a pinned
transitive dependency too, but the claim "point ApiGlow at a YAML schema"
is *ours*, made in `docs/openapi-coverage.md` §1, and it holds or breaks
whatever the parser underneath happens to be. The line is what the product
promises, not who implements it.

## Inventory verdicts that can go stale

The spec-code inventory (`docs/openapi-coverage.md` §6) weighed the
hand-written spec/format code against the libraries below and kept ours.
Most of its verdicts rest on our own rules and only a decision moves them —
but these three rest on a property of a library, so they can go stale
without anyone noticing. The drift check is **one version comparison per
row**; re-read what changed only when the version moved.

| Row | Candidate | Version weighed |
|---|---|---|
| JSON Pointer (`src/scenarios/pointer.js`) | `json-p3` | 2.2.2 |
| Sample generation (`src/openapi/sample.js`) | `openapi-sampler` | 1.7.4 |
| Arazzo `xpath` criteria | `fontoxpath` | 3.34.0 |

What would reopen each row is stated in the inventory and not repeated
here: the condition is a decision, this table is the state to compare
against.

A row that reopens does not become a swap: it becomes a plan session, and
the inventory is amended with what changed. `json-p3` is the one to watch —
it already ships in the bundle, so its row is the only one where the weight
argument is already spent.

## Waivers

Constructs of a supported spec version that we deliberately do not
implement. Each entry states its rationale (rule 19: platform limitation or
documented fallback) and carries the user's validation; `/spec-sync`
re-checks on every run that the rationale still holds.

**Arazzo — `xpath` success criteria** (the one standing waiver): supporting
them means XPath 3.1, which the browser does not provide —
`document.evaluate` is XPath 1.0 and XML-only — so it means `fontoxpath`,
~650 kB unpacked against a 909 kB bundle. That weight buys one alternative
spelling of an assertion a scenario can already make, which criterion 2 of
the dependency rule (architecture.md §14.2) refuses: the need does not
command the dependency. Imported criteria of that type keep warning
`arazzo-criterion-type`, so a document using them is named, never silently
half-read. Re-costed if `fontoxpath`'s weight falls (tracked in the
inventory-verdicts table above).

The waiver covers **criteria and Selector Objects alike**, and does so by its
own reasoning rather than by extension: what it refuses is XPath 3.1, the
language, and a selector is that language at another site. An `xpath` selector
on a step output keeps warning `arazzo-output-type`.

With it, all four Criterion Object types are accounted for: `simple`,
`jsonpath` and `regex` run — `jsonpath` as the `matches` assertion op and
`regex` as the `regex` assertion op (`docs/scenarios.md` §6), neither of
which is a waiver, because rule 19's fallback branch applies to neither
(the JSONPath engine already ships in the bundle, and `RegExp` is native) —
and `xpath` is waived above.

Eight further **candidates** are listed and argued in
`docs/openapi-coverage.md` §5.1 (constructs modeled and rendered, whose
execution degrades on purpose). They stay candidates until the user
validates them one by one: a waiver is a promise withdrawn, and only they
withdraw it.

**Overlay — full RFC 9535 JSONPath** is **not** a waiver: Overlay 1.1.0
makes it a MUST, and it is served by a conformance-tested engine
(`json-p3`) rather than a documented subset — a dependency the spec/format
opening (architecture.md §14.2) exists for.

**Arazzo — AsyncAPI steps** (`action` `send`/`receive` over a `channelPath`,
1.1) need no waiver, and calling them one would be the wrong record. Rule 19
allows exactly this: *degrade with an explicit, documented fallback when the
browser platform forbids execution* — and it does forbid it, a browser HTTP
client having no message transport to run a message step on. The step is
named (`arazzo-step-asyncapi`) and dropped, the HTTP steps around it import
normally, and the degradation is stated in `src/import/arazzo.js` and
`docs/scenarios.md` §8.4. A waiver withdraws a promise; this is the promise
being kept in the only form the platform allows. What would reopen it is the
platform changing, not our mind.

<!-- Template:
- **{format} — {construct}**: {why the browser platform or the product
  forbids it; what the documented fallback is}.
-->
