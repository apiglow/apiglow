// The About dialog is a legal notice, and a notice that drifts from what the
// bundle actually contains is worse than none: these tests are what keeps
// `src/credits.js` honest. They also make the dependency rule
// (architecture.md §14.2) self-enforcing — a new
// runtime dependency fails here until it is credited.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSET_CREDIT_PACKAGES,
  BUNDLED_CREDITS,
  CSS_CREDIT_PACKAGES,
  PROJECT_LICENSE,
} from '../src/credits.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const licenseText = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')

const byPackage = new Map(BUNDLED_CREDITS.map((credit) => [credit.pkg, credit]))

describe('bundled credits', () => {
  it('credits every runtime dependency at its pinned version', () => {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      expect(byPackage.get(name), `${name} is bundled but not credited`).toBeDefined()
      expect(byPackage.get(name).version, `${name} version`).toBe(version)
    }
  })

  it('credits the CSS libraries and static assets shipped in dist/', () => {
    for (const name of [...CSS_CREDIT_PACKAGES, ...ASSET_CREDIT_PACKAGES]) {
      expect(byPackage.get(name), `${name} ships in dist/ but is not credited`).toBeDefined()
      expect(byPackage.get(name).version, `${name} version`).toBe(pkg.devDependencies[name])
    }
  })

  // The other side of the contract: build tooling never reaches the browser,
  // and crediting it would drown the notices that do travel.
  it('credits nothing that does not ship', () => {
    const shipped = new Set([
      ...Object.keys(pkg.dependencies),
      ...CSS_CREDIT_PACKAGES,
      ...ASSET_CREDIT_PACKAGES,
    ])
    for (const credit of BUNDLED_CREDITS)
      expect(shipped.has(credit.pkg), `${credit.pkg} does not ship`).toBe(true)
  })

  it('gives every entry a name, an SPDX license and a followable link', () => {
    const ids = new Set()
    for (const credit of BUNDLED_CREDITS) {
      expect(credit.name).toBeTruthy()
      expect(credit.license).toMatch(/^[A-Za-z0-9.\-+ ()]+$/)
      expect(credit.url).toMatch(/^https:\/\//)
      // The id keys the role label in i18n: a duplicate would silently relabel
      // one of the two.
      expect(ids.has(credit.id), `duplicate id ${credit.id}`).toBe(false)
      ids.add(credit.id)
    }
  })
})

describe('project license notice', () => {
  it('states the same license as package.json', () => {
    expect(PROJECT_LICENSE.spdx).toBe(pkg.license)
  })

  it('reproduces the copyright line of LICENSE', () => {
    expect(licenseText).toContain(PROJECT_LICENSE.copyright)
  })
})
