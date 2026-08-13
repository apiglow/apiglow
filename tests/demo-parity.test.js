import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demoConfigDelta, extractDemoConfig } from '../scripts/health/demo-parity.mjs'

const page = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

// Invariant 19 (docs/registry/app-health-registry.md): the two demo pages
// hand-sync one config. The green half proves the exemptions are wide enough
// for the intentional deltas; the red half proves the guard actually sees a
// mutation — a parity check that flags nothing is indistinguishable from one
// that checks nothing.
describe('demo config parity', () => {
  const dev = () => extractDemoConfig(page('index.html'))
  const cdn = () => extractDemoConfig(page('demo/cdn-install.html'))

  it('the two demo pages agree outside the documented deltas', () => {
    expect(demoConfigDelta(dev(), cdn())).toEqual([])
  })

  it('a drifted key is reported by its path (red test)', () => {
    const mutated = cdn()
    mutated.history.maxEntries = 42
    expect(demoConfigDelta(dev(), mutated)).toEqual(['history.maxEntries'])
  })

  it('a key present on one side only is reported too', () => {
    const mutated = cdn()
    mutated.openapi.specs[0].hide = ['tag:Internal']
    expect(demoConfigDelta(dev(), mutated)).toEqual(['openapi.specs.0.hide'])
  })

  it('the docsPages carrier stays exempt on every spec entry', () => {
    const mutated = cdn()
    mutated.openapi.specs[0].docsPages = [{ slug: 'x', title: 'X', content: '# X' }]
    expect(demoConfigDelta(dev(), mutated)).toEqual([])
  })
})
