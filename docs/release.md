# Releasing

How a version reaches the people who install it: what the one command does,
what the tag triggers, what is configured outside the repository, and what to
do when a step fails. The contributor-facing summary is in
[`../CONTRIBUTING.md`](../CONTRIBUTING.md); this is the procedure itself.

## 1. One command, then a tag

```sh
npm run release 0.1.0-rc.1     # rehearsal, published under `next`
npm run release 0.1.0          # the real thing, published under `latest`
```

[`../scripts/release.mjs`](../scripts/release.mjs) does everything that has to
happen before a tag exists, and refuses to continue at the first thing that is
not right:

1. **Preconditions** — on `main`, clean working tree, in step with
   `origin/main`, no such tag yet, and the version both absent from the registry
   and newer than the highest version published there (npm versions are
   immutable; a number is spent the moment it is published). The floor is the
   registry, never `package.json`: a number prepared locally and never shipped
   commits nobody, and since `0.1.0-rc.1` precedes `0.1.0` in semver, a floor
   read from the working tree would forbid the very rehearsal it exists for.
2. **Changelog** — the `Unreleased` section becomes `## [x.y.z] — <date>`, a
   fresh empty `Unreleased` takes its place, and the comparison links at the
   bottom of the file are rebuilt. An empty section stops the release: a
   version without notes is not ready to go out.
3. **Version** — `npm version --no-git-tag-version`, then
   `npm run sync:version` rewrites every pin a reader could copy (§4).
4. **Gates** — Biome, unit tests, build, `check:dist`, `check:surface`,
   `check:invariants`, `check:syntax`, `check:version`. Seconds, not minutes:
   the browser matrix belongs to CI. A failure here leaves an uncommitted tree
   — `git checkout -- .` undoes it.
5. **Commit, tag, push** — `chore(release): x.y.z`, an annotated `vx.y.z`, and
   a push it asks about first (`--yes` skips the question).

Nothing is published locally. `prepublishOnly` rebuilds `dist/` on any
`npm publish`, so even a manual one cannot ship a stale bundle.

## 2. What the tag triggers

[`../.github/workflows/release.yml`](../.github/workflows/release.yml) runs on
`v*` and on nothing else. Five jobs, each gating the next:

| Job | What it establishes |
|---|---|
| `gate` | The tag and `package.json` agree — the one failure that would otherwise publish a version nobody asked for. Then every `check:*`, the unit tests, the build, and the changelog section that will become the release body. |
| `e2e` | The full browser matrix — Chromium, Firefox, WebKit, desktop and mobile projects — against the packed tarball. A release is where that cost is obviously worth paying. |
| `publish` | `npm publish` through **trusted publishing** (§3): the OIDC token replaces the access token and signs the provenance attestation. |
| `verify` | [`verify-release.mjs`](../scripts/verify-release.mjs) waits for the registry and for jsDelivr, runs the published `apiglow` binary through `npx`, then loads the CDN bundle in a real browser on a bare host page and checks the documentation renders, the stylesheet resolves, and the footer names *this* version. Every other suite runs against the local pack; only this one proves the published artifact. |
| `announce` | The GitHub Release, body taken from the changelog, flagged `--prerelease` for an `-rc`. |

The dist-tag follows the number: anything with a `-` publishes under `next`,
everything else under `latest`. A prerelease never consumes the `Unreleased`
section — it rehearses the notes of the version it precedes, and quotes them.

## 3. What lives outside the repository

- **npm trusted publishing.** On npmjs.com, the package's *Trusted Publisher*
  is GitHub Actions on `apiglow/apiglow`, workflow `release.yml`. No token
  exists — not on a laptop, not in repository secrets — so none can leak, and
  every published version carries a provenance attestation linking it to the
  commit and the run that built it. Provenance requires the repository to be
  public.
- **The GitHub repository** is public, with force-push and deletion blocked on
  `main`, private vulnerability reporting on (what
  [`../SECURITY.md`](../SECURITY.md) links to), and secret scanning with push
  protection.
- **The website** ([`apiglow-website`](https://github.com/apiglow/apiglow-website))
  vendors the bundle from the published npm package at an explicit version:
  after a `latest` release, bump that version there and deploy. The site can
  therefore never serve a build that was never released.

## 4. One version, many places

`package.json` is the only place a version is written by hand.
[`sync-version.mjs`](../scripts/sync-version.mjs) rewrites every
`/npm/apiglow@` pin in every tracked file from it — the README snippet, the
demo install page, the docs — and `npm run check:version` fails CI when one
has drifted. Two spellings are left alone on purpose: `@current`, the unmoving
alias the e2e fixtures load from the CDN simulation, and `CHANGELOG.md`, where
a URL under an old heading documents that old version.

Prose and host pages part company on prereleases. A `.md` file only ever names
a released version — the README is a shop window, and nobody should be told to
install a rehearsal. The host pages follow `package.json` whatever it says,
because `preview:cdn` serves exactly that version and refuses to start when
`demo/cdn-install.html` disagrees: leaving them behind during an `-rc` would
take the whole e2e suite down with it.

Inside the bundle the version comes from the same source: Vite defines
`__APP_VERSION__` from `package.json`, which is what the footer, the About
dialog, the diagnostics and the HAR export report.

## 5. When a step fails

- **Before `publish`** — nothing was published, so the number is still free.
  Delete the tag (`git tag -d vx.y.z`, `git push --delete origin vx.y.z`), fix,
  and release the same number again.
- **After `publish`** — the number is spent forever. If the package is
  unusable, `npm deprecate apiglow@x.y.z "<why>"` and ship the next patch;
  within 72 hours `npm unpublish` is possible but leaves the number burned all
  the same. This is what the `-rc` rehearsal exists to make rare.
- **`verify` red on a good-looking publish** — read it before assuming a false
  alarm: it is the only check that ever sees what a reader downloads.
