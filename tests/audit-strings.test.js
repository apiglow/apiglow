import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORIES, SEVERITIES } from '../src/audit/constants.js'
import { RULES } from '../src/audit/rules/index.js'

// Every audit string, checked against the registry rather than against whatever
// a fixture happens to trigger. A rule shipped without its three strings shows
// up on the page as a raw key — and only on the documents that fire it, which
// is the worst way to find out.
//
// `label` is the one the grouped report added: it names the rule when its
// findings are folded together, where a message interpolated with one
// occurrence's own values would speak for all of them.
const FIELDS = ['message', 'why', 'label']

const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'))
const FR = JSON.parse(readFileSync(new URL('../i18n/fr.json', import.meta.url), 'utf8'))

const CATALOGS = [
  ['en', EN],
  ['fr', FR],
]

describe('audit i18n coverage', () => {
  for (const [language, catalog] of CATALOGS) {
    it(`carries every rule string in ${language}`, () => {
      const missing = RULES.flatMap((rule) =>
        FIELDS.map((field) => `audit.rule.${rule.id}.${field}`).filter((key) => !catalog[key]),
      )
      expect(missing).toEqual([])
    })

    it(`carries every category, severity and help string in ${language}`, () => {
      const keys = [
        ...CATEGORIES.flatMap((id) => [`audit.category.${id}`, `audit.help.category.${id}`]),
        ...SEVERITIES.flatMap((id) => [`audit.severity.${id}`, `audit.help.severity.${id}`]),
      ]
      expect(keys.filter((key) => !catalog[key])).toEqual([])
    })
  }

  // en/fr parity lives in `i18n-sync.test.js`: it is rule 9's contract, not
  // the audit's, and hosting it here made it a side effect of this feature
  // having tests — deleting `src/audit/` would have deleted it silently.

  // A stale label outliving its rule is invisible on the page: nothing renders
  // it, and it stays in both catalogs forever.
  it('ships no rule string without its rule', () => {
    const ids = new Set(RULES.map((rule) => rule.id))
    const orphans = Object.keys(EN)
      .filter((key) => key.startsWith('audit.rule.'))
      .filter((key) => !ids.has(key.slice('audit.rule.'.length).replace(/\.[^.]+$/, '')))
    expect(orphans).toEqual([])
  })
})
