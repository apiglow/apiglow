## What & why

<!-- What the change does and the problem it solves. Link the issue if any. -->

## Checklist

- [ ] `npm test` is green
- [ ] `npm run test:e2e` is green (mandatory if the build output,
      `package.json` `files`/`exports`, or `scripts/` changed)
- [ ] The feature/fix has at least one test (rule 16 — core → Vitest,
      UI → Playwright)
- [ ] New UI strings go through `t('key')` and exist in **both**
      `src/i18n/en.json` and `i18n/fr.json` (key counts stay in sync)
- [ ] Anything newly persisted declares its storage bound
      (rule 13, `docs/architecture.md` §6)
- [ ] Any new runtime dependency does spec/format work, matches a job we
      want done in full, and is listed in the README with its weight
      (`docs/architecture.md` §14.2); dev deps called out below
- [ ] Comments follow the policy (non-obvious rationale only)
- [ ] If this contradicts a design-rationale entry (`docs/architecture.md`
      §14), it says so explicitly and argues the case

## Notes for the reviewer

<!-- Trade-offs, alternatives rejected, anything deliberately out of scope. -->
