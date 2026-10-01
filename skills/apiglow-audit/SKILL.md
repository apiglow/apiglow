---
name: apiglow-audit
description: Audit an OpenAPI document (3.0, 3.1, 3.2, Swagger 2.0) with `apiglow audit` and fix what it finds — correctness against the specification, documentation gaps, consistency, security (what the document lets through), and readiness for AI agents calling the API as tools. Use when asked to lint, audit, validate, clean up or make agent-ready an OpenAPI/Swagger file, or to fix the findings of an apiglow audit report.
---

# Auditing and fixing an OpenAPI document with apiglow

`apiglow audit` grades an OpenAPI document and lists its findings, each with
the rule that raised it, why it matters, how to fix it, and where it sits in
the file. The loop is: audit, fix, audit again.

## Run it

```
npx --yes apiglow@0.2.0 audit openapi.yaml --format json --min-severity warning
```

- One schema per path argument; a quoted pattern (`'apis/**/openapi.yaml'`)
  audits several, each under its own path. `--config apidoc.config.json`
  audits what a documentation site built on apiglow shows instead.
- Exit status: `0` every check passed, `1` a check failed, `2` the audit
  could not run (read stderr — a bad option, a schema it cannot reach). A
  file it can open always gets a report, broken JSON or YAML included.
- `--min-severity` trims what the report lists, never the verdict. Start with
  `warning`; drop to `info` once those are done.

## Read the report

The JSON report (`format: "apiglow-audit-report"`):

- `passed` — the verdict. `specs[].gates` — each check and its outcome.
- `specs[].report.categories[].findings[]` — one entry per finding:
  `ruleId`, `severity`, `params`, the JSON pointer `dataPath`,
  `position: { file, line, column }` where the node sits in the file, and
  `via` — the `$ref` sites crossed to reach it. A finding reached
  through a `$ref` is fixed once, at the target, for every place using it.
- `rules[ruleId]` — `label`, `message`, `why`, `fix`. They are templates:
  `{name}` is the finding's `params.name`.
- `fingerprint` identifies a finding across runs while the file around it
  changes.

`npx --yes apiglow@0.2.0 audit --explain <ruleId>` prints one rule — why,
how to fix, its severity; `--list-rules` prints every rule as
JSON.

## Fix, then audit again

1. Fix `document-syntax` and `document-openapi` first: the rest of the
   report reads past a broken text, and can change once it is fixed. Then
   `error` findings, then `warning`, then `info`. Work rule by rule: one
   rule's findings usually share one fix.
2. Edit at `position`. Keep the document's own style — indentation, key
   order, quoting — and change nothing a finding does not ask for.
3. Run the audit again. A fix can uncover the next finding, and the count
   should only go down. Stop when `passed` is true, or when what remains
   needs a decision only the API's owner can make.

## What not to do

- **Never invent what the API does.** A description, an example value, an
  error schema, the meaning of an enum value must come from the code, the
  existing documentation or the person you work for. When you cannot know
  it, leave the finding and say so — a plausible guess published as
  documentation is worse than the gap.
- Placeholder text counts as missing: "TODO", "string", or a field's name
  read back ("User id" on `userId`) does not fix a description finding.
- Do not silence the audit to make it pass. Switching a rule off or
  changing its severity (the `audit` block of a config, `--audit-config`),
  writing a baseline (`--write-baseline`), lowering `--fail-on` — each is the
  owner's decision. Propose it, with the reason, and wait.
- With a baseline already in place (`--baseline audit-baseline.json`), the
  findings it lists are accepted history: work on the others
  (`--only-new`). A stale entry — a finding that no longer occurs — fails the
  run; `--prune-baseline audit-baseline.json` drops it once you have fixed
  it.
