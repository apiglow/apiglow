# Scenario hand-off — Arazzo for agents and CI

How an Arazzo workflow enters this documentation and how it leaves it. On
the way in, a `scenarios[]` entry declares one directly — the file an author
already owns, not a re-authored copy of it. On the way out, it becomes a
published artifact: a fetchable recipe an agent can follow, a Markdown
mirror it can read, and a CI job the author can paste.

The outbound half joins the agent-readable surface to the CI hand-off,
because both answer the same question — *who, other than a human clicking a
menu, ever sees this file*. The inbound half is what makes the two ends the
same file.

## 1. What the hand-off answers

Three standing facts about a front-end product, and the positioning sentence
that only holds if all three are answered.

- **An agent fetches files.** It runs no JavaScript and clicks no menu, so a
  workflow reachable only through "Export → Arazzo" on a scenario page is a
  workflow it cannot see. The map (`llms.txt`), the territory
  (`llms-full.txt`) and the baked tree are the three files it does read, and
  §3 puts the workflows in all three.
- **A front-end schedules nothing.** There is no server to run a workflow at
  3 a.m., and the ecosystem already runs Arazzo in CI. So the answer is a
  hand-off, not a feature: §4 generates the job, and the reader's own
  pipeline runs it.
- **An author with Arazzo files already has the artifact.** Without a door
  for it (§2.1) what is left is re-authoring, click by click in the UI, a
  workflow that already exists — to obtain a file in our format that says
  less than the one they started with. That door is also what keeps one
  workflow from becoming two files once the CI panel exists: without it an
  author commits the exported Arazzo for their CI *and* declares a second
  file in our envelope for the documentation, then keeps them in step by
  hand.

The roadmap's positioning sentence — *exported as standard Arazzo that the
reader's agents can run unchanged* — is a claim about reachability as much as
about conformance. A conformant generator behind a menu item is a document
nobody but a human can obtain; §3 and §4 are what make the claim verifiable
in a default install.

## 2. Doctrine: what is publishable, and from what

**Only config-declared scenarios** ([`scenarios.md`](scenarios.md) §3).
Scenarios the reader created live in `apidoc-scenarios` (IndexedDB) and are
never published, never baked, never named in a generated file.

This is a rule about publication and nothing else. A reader keeps every
scenario of their own, whole: create one, capture requests into it, edit and
reorder it, duplicate a shipped one to make it editable, import a file or a
share link — including an Arazzo document someone handed them — run it, and
export it in both formats, ours and Arazzo. Nothing here narrows that
surface; what it says is that a private artifact does not become a public
one because the documentation happens to know how to publish.

The boundary is structural rather than a policy: the bake is an author-side
Node CLI reading the host config, with no browser and no IndexedDB — it
*cannot* see a local scenario. The in-app generators restrict themselves to
the same set so that the downloaded `llms.txt` and the served one describe
the same documentation. A config scenario is already a file the host
committed and serves publicly; publishing its recipe adds no exposure.

Consequences worth stating:

- No config key gates publication. A declared scenario is published; the way
  not to publish one is not to declare it. `features.ci` (§4) is not a
  counter-example: it removes a panel from a page, and a surface nobody sees is
  not a document nobody gets.
- `features: { scenarios: false }` removes the feature, so there is nothing
  to publish and no `## Workflows` section — not an empty one.
- **No schema URL, no *generated* recipe.** `toArazzo` fills
  `sourceDescriptions` from the schema URL, so an inline schema produces a
  document whose source no runner can fetch: it is not emitted and the CI
  panel is absent, rather than wrong — the rule the MCP export applies for
  the same reason (`architecture.md` §5.14). A **declared** Arazzo document
  (§2.1) carries its own `sourceDescriptions`, which it got from its author
  and which owes nothing to how this documentation loaded its schema: it is
  published whatever the config does, because it was already runnable before
  we read it.
- Run results, verdicts and per-reader progression are personal state and
  never leave the browser (`scenarios.md` §7).

One function holds that arbitration for every surface: `publishedArazzo`
(`src/export/arazzo.js`) returns the authored document as it stands, or the
one `toArazzo` generates, or nothing — and `llms-full.txt`, the bake and the
CI panel all read the recipe from it, so the copy inlined in one and the file
served by another are the same document.

### 2.1 What a `scenarios[]` entry declares

A `scenarios[]` entry may point at an **Arazzo document** (JSON or YAML)
instead of the `apiglow-scenario` envelope. The loader sniffs the format
with `isArazzoDocument` and parses it through `parseArazzo` — the same pair
the file picker already uses (`scenarios.md` §8.4), which reports every
construct it cannot represent as a named warning code and never drops a line
silently.

The point is the door: an author who already writes Arazzo — because their
CI runs it, because they follow the ecosystem's tooling — declares those
files and gets an interactive, executable rendering of them, with no
conversion step and nothing to re-author. The workflow they own stays the
workflow the documentation shows.

There is no manifest format to invent: an Arazzo document natively carries
`workflows[]`, so **one entry declares as many scenarios as the file holds**,
exactly as a manual import of that file produces one scenario per workflow.

Two independent axes, not four cases to learn — the **format** (our envelope
or Arazzo) is sniffed from the document itself, and the **carrier** says
where it comes from:

- `url` — a file to fetch, JSON or YAML, lazily as today.
- `document` — the object itself, straight in the config. No fetch, so no
  error state and no load order: the scenario exists at boot.

What the entry carries wins over what it would have to fetch, the rule
`docsPages` and `openapi.spec` already state. The carried form is what makes
scenarios available to an installation that cannot serve files next to its
page — behind a login, or generated by a backend — which is the same
population `docsPages.content` exists for, and it is why the key is
`document` rather than `scenario`: an Arazzo one may hold several workflows.
The `contentId` form of `docsPages` (a non-executable `<script>` in the host
page) transposes exactly and is deliberately unimplemented: a config is
already JSON, and a JSON document sits in it natively —
which prose did not.

Four rules make it work:

- **Identifiers.** A `workflowId` is already constrained to
  `[A-Za-z0-9._-]`, which is a usable route and storage id as-is. Two
  documents claiming the same one are disambiguated by their entry id. A
  declared `title` names an entry holding one scenario; holding several, each
  workflow takes its own name — and an entry that declares no title at all
  leaves the name to the document rather than falling back to the entry id,
  which would label a file we did not write with a word its author never
  wrote.
- **A partially supported workflow renders, degraded.** No human is
  watching at boot, so the import's toast has no equivalent here: the
  scenario opens with a visible badge naming what this documentation cannot
  execute, and the warnings are flagged in the console. It is not discarded
  — the discard rule (`scenarios.md` §3) is for an entry that is not a
  scenario at all, and a `goto` we cannot yet run is not that. Config
  scenarios are read-only with a "Duplicate" button, which is precisely what
  makes *displaying* a construct we cannot execute acceptable where editing
  it would not be.
- **The loaded model wins.** A file written for CI points
  `sourceDescriptions` at the production schema; the documentation loaded
  its own, possibly overlaid and filtered. Operations resolve against the
  model in front of the reader; when the document declares several sources
  and a step names one explicitly, the choice the app cannot honor is
  flagged (`arazzo-source-ambiguous`). Multiple sources stay
  out of scope while cross-spec scenarios are.
- **Which format for which job.** Arazzo when the workflow also runs
  somewhere else; the `apiglow-scenario` envelope when the documentation is
  its only home — it is the output of the authoring loop (build it in the
  UI, commit it) and it carries what Arazzo cannot say yet. Both are
  declarable, neither is deprecated by the other.

## 3. The agent surface

### 3.1 A scenario as Markdown

`src/export/scenario-markdown.js`, sibling of `toEndpointMarkdown` and
snapshot-tested (rule 12). One scenario → one Markdown document, written for
a reader going top to bottom with no app in front of them:

- title, description, and the step count;
- **prerequisites** — the `required` list of `scenarioVariables()`, the same
  computation the scenario view's panel displays, so the published page and
  the page in the app answer "why would this fail" identically — then the
  `inputs` the scenario carries for itself;
- one section per step: its note, the operation it calls (`METHOD /path` as
  an `http` block, under the operation's summary), what it sends, what it
  asserts — including the `2xx` default, since a document silent there would
  describe a step that passes on anything — and what it extracts under which
  name. The extraction names are what make the next step readable, and an
  agent reading top to bottom needs them;
- `{{var}}` travels literally, as in every other export: the rendered app
  resolves references against the selected environment and those values
  include credentials (rule 12). An input under the `auth.` prefix — the one
  place the model holds a literal rather than a template — is masked.

`heading` overrides the H1 for a caller concatenating the document into a
larger one, which is how `llms-full.txt` says "Workflow: " (§3.3) and the
bake gives a snapshot the entry's own title.

### 3.2 `llms.txt`

A `## Workflows` section, placed between the top docs zone and the operation
groups — the position scenarios occupy in the nav (`scenarios.md` §5.1). The
arrangement the author chose is information in the map exactly as it is in
the page.

One line per scenario:

```
- [Create a payment](…/scenario/create-payment.md): 4 steps, 2 inputs — the
  [Arazzo recipe](…/scenario/create-payment.arazzo.json) runs it unchanged in CI.
```

The counts are what an agent decides on before opening anything: how long the
sequence is, and how much it has to provide for it to run. The heading is
`Workflows`, not `Scenarios`: the reader is an agent, and *workflow* is the
Arazzo noun it already knows. The UI keeps its own word.

Both links go through the URL mapper that [`seo.md`](seo.md) §4 introduces.
Without a bake there is no `.md` to fetch, so the entry links the hash route
`#/scenario/{id}` instead — inventing a URL for a file nobody serves is
worse than one link fewer.

The recipe link survives that fallback in one case, and it is the case the
whole design aims at: a scenario declared by `url` on an Arazzo document is
*already* served, by the host, at an address the config states. It is linked
as it stands, with no bake and no copy — the file the author owns, the file
the CI runs, the file the agent fetches. Declared by `document`, or declared
in our envelope, there is nothing published to point at until §3.4 emits it.

When the bake did run, every link points at the baked artifacts, that one
included. The map is served from the bake's own output and its entries are
uniform there; the author's file stays exactly where it was, and the CI panel
keeps naming *it* (§4), which is the address that matters for running the
thing.

### 3.3 `llms-full.txt`

One `# Workflow: {title}` block per scenario, after the docs pages and before
the operations — the same order as the map. Each block carries the Markdown
of §3.1 **and** the Arazzo document under an `## Arazzo recipe` heading, in a
fenced `json` block.

Inlining the recipe is the point of this file: `llms-full.txt` is the
territory, handed to a model in one piece, and a recipe behind a second
fetch is a recipe the model does not have. It is serialized as JSON here for
the same reason the bake serves JSON (§3.4), whichever form it was authored
in.

A scenario declared by `url` is downloaded on demand by the exporter, an
unreachable one omitted rather than blocking the export — the contract
`loadDocsPageTexts` already establishes for pages. One declared by
`document` has nothing to fetch and nothing to fail.

### 3.4 Bake output

The tree of [`seo.md`](seo.md) §4 carries one triple per scenario:

```
out/
  scenario/{id}.arazzo.json
  scenario/{id}.md
  scenario/{id}.html
```

The emitter has two modes, decided by the same format sniffing the loader
does. A scenario declared as an Arazzo document (§2.1) is **copied**, not
regenerated: what is served is the authored document, and nothing of it
passes through our model on the way out — so nothing of it can be lost
there. A scenario declared in the `apiglow-scenario` envelope is generated
by `toArazzo`.

The served form is always JSON, whatever the source was: `.arazzo.json` is a
published convention and an agent should not have to guess an extension. A
document authored in YAML is therefore re-serialized rather than copied
byte for byte, and its comments do not survive — the one thing this
publication drops, stated here because nothing else would say it.

The carrier makes no difference here. A `document` carried in the config has
no file of its own, but the bake reads that config and therefore holds the
document — it emits the same triple. An install that serves no scenario file
still publishes its recipes.

Multi-spec installs nest them under `s/{specId}/` like everything else —
which is where they belong anyway, since scenarios are declared only inside
`openapi.specs[]` entries.

`sitemap.xml` lists the `.html` snapshots only: they are the indexable form,
and the two machine artifacts are reachable through `llms.txt`. The HTML
snapshot follows the existing rules — canonical on itself, JSON-LD, a
prominent link into the interactive scenario at `{site-url}#/scenario/{id}`,
no script. A tutorial page is the kind of content people search for in
prose ("how do I create a payment"), so the snapshot earns its place on the
human side too.

A scenario the bake cannot load, and one whose recipe cannot be generated for
want of a published schema, are both named in the run's warnings: the first
is dropped whole, the second keeps its `.md` and `.html` and loses only the
recipe.

## 4. The CI hand-off

An **"Automate this scenario"** panel on the scenario page, below the export
menu and collapsed by default — it addresses the reader wiring a pipeline,
not the one reading the sequence. It answers scheduling — structurally
impossible in a front-end product — by handing the work to the reader's own
CI, which the ecosystem already runs Arazzo in.

The snippet is **shown**, not just copied: it is a file that goes into
somebody's repository, and pasting an unread job from a documentation site is
exactly the habit not to encourage.

- **Runner table.** `src/export/ci.js` carries a `CI_RUNNERS` table on the
  model of `MCP_BRIDGES`: one entry per runner — Redocly Respect and Jentic's
  Arazzo Runner today — each with the runtime it needs, the command it takes,
  the Arazzo revision its own documentation claims, and a link to that
  documentation. It is somebody else's contract, verified against each
  project's own docs and watched by `docs/registry/specs-registry.md` — one
  place to fix when one of them moves.
- **The snippet.** A GitHub Actions job or a GitLab CI job, generated by a
  pure function, running the scenario's Arazzo document through the selected
  runner: the runtime set up, the workflow selected by its `workflowId`, and
  the inputs passed in the shape that runner's CLI takes them. Both carry the
  schedule where the platform holds it — a `schedule:` block on GitHub, a
  comment pointing at CI/CD → Schedules on GitLab, which has no in-file
  spelling for it.
- **The secrets.** The workflow's own required inputs — its `required` list,
  or every input with no default — become the variables the job needs,
  emitted as **names only**, sanitized into environment-variable spelling
  (two names sanitizing alike are ranked apart) and wired to the platform's
  secret store. A snippet never embeds a value (rule 12).
- **What would degrade.** The document's `arazzo` version is compared with
  the revision the selected runner declares, and the panel names what that
  runner would ignore: the version gap itself, each construct introduced
  after the supported revision (a Selector Object output is 1.1's only
  spelling for a query extraction, so this is not hypothetical), a runner
  declaring no revision at all, and the workflow having been guessed rather
  than matched. Claiming more than a project states about itself would be
  inventing a contract we do not own. Warnings are codes translated by the
  caller, the contract the importers and the MCP export already share. A
  declared document is checked as it stands, which is the only honest thing
  to do with a file we did not write: it may say more than our runner
  executes (§2.1) and more than the CI runner does, and those are two
  different lists — the panel says so, in its own warning.
- **Where the file comes from.** By default the snippet assumes the author
  committed the `.arazzo.json` into their repository at a path the panel
  names, next to a download button that produces exactly that file: it works
  for every install, baked or not, and a workflow file in a PR is the
  diffable artifact the whole design aims at. For a scenario declared by
  `url` on an Arazzo document (§2.1), that file is already the author's own —
  the job `curl`s the address the config states and checks nothing out
  instead of asking for an export to be committed. This is the single-source
  case, and the panel says so.

The panel is UI: every string through `t()`, `en`/`fr` in sync (rule 9).

**`features.ci`** (on by default, overridable per spec like the rest of the
block) removes it. It is a switch on this one surface and on nothing else: the
Arazzo export stays in the scenario's own menu, and what §3 publishes stays
governed by what the config declares — the rule of §2 is about publication, and
hiding a panel is not publishing less. An installation for whom a pipeline is
not the reader's business turns it off; the recipes its agents read are
untouched.

## 5. The guards

`tests/export-completeness.test.js` walks the normalized OpenAPI model's own
keys and fails on any the export neither emits nor explicitly waives.
`tests/scenario-completeness.test.js` is its companion over the scenario
model: from `normalizeScenario`'s own keys to the exports, every key either
emitted — with a probe proving its content reaches the artifact — or
explicitly waived with the reason it is not there. Two subjects, because a
scenario leaves through two doors that lose different things: the Arazzo
document a runner executes, and the Markdown an agent reads
(`steps[].continueOnFailure` is waived on one side and emitted on the other,
which is what makes the pair worth having).

A snapshot freezes what we write today. Only a checklist notices what the
model gains tomorrow and the export forgets, which is why the pair exists at
all: an export can ignore a whole feature in silence for as long as nothing
walks the model it publishes from.

The second guard covers the authoring loop §2.1 makes possible — *build it
in the UI, export it as Arazzo, commit it for CI, declare that same file* —
which crosses three pieces of code that are each tested alone and never
together: `toArazzo`, `parseArazzo`, `normalizeScenario`.
`tests/scenario-roundtrip.test.js` asserts that a scenario exported and
re-imported is the scenario that was built, over a corpus covering every
construct the model can express. Where the trip is lossy on purpose, the loss
is a named warning and the test pins the list — a silent one is the defect.
Without this, the loop's promise is an assumption; with it, an author who
declares their own export knows the documentation shows what they authored.

## 6. Out of scope (recorded decisions)

- **Local scenarios in any published artifact.** §2; structural, not a
  toggle.
- **Publishing runs, verdicts or completion state.** Personal, local, and of
  no use to a third party.
- **Cross-spec `sourceDescriptions`.** A scenario references one document,
  as scenarios do (`scenarios.md` §9) — a declared Arazzo listing several
  sources resolves against the loaded model and says so (§2.1). Multiple
  sources belong to the composition work of `scenarios-roadmap.md` §5.3,
  and nothing in this design blocks it: the emitter copies what it was given
  and generates what `toArazzo` produces, neither of which decides how many
  sources a document may name.
- **A per-scenario MCP tool.** The MCP export wires an OpenAPI→MCP bridge to
  a document; no bridge consumes Arazzo. The recipe is for an agent that
  reads, not for a bridge that generates tools.
- **Running the CI job for the reader.** No server by charter; the frontier
  is sketched in `scenarios-roadmap.md` §5.9 and this document stays on its
  near side.
- **An in-app editor for a declared Arazzo document.** Declaring one (§2.1)
  makes it readable and runnable, never writable: a config scenario is
  read-only, and "Duplicate" is the way to a local editable copy — the app
  never writes back to the author's file. The authoring loop is unchanged
  for our own format too: build it in the UI, commit it (`scenarios.md`
  §8.1).
