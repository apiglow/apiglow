import { beforeEach, describe, expect, it } from 'vitest'
import { createScenario, createStep } from '../src/scenarios/model.js'
import { StorageLimitError } from '../src/storage/errors.js'
import { MAX_SCENARIOS_PER_SPEC, ScenarioStore } from '../src/storage/scenarios.js'

const named = (name) => createScenario({ name })

// No clear() on the store — scenarios are never bulk-deleted by the app, so
// the test wipes them the same way the UI would.
async function wipe(store) {
  for (const scenario of await store.list()) await store.remove(scenario.id)
}

let store

beforeEach(async () => {
  store = new ScenarioStore()
  await wipe(store)
})

describe('write and read', () => {
  it('round-trips a scenario through validation with its timestamps', async () => {
    const scenario = { ...named('checkout'), steps: [createStep({ opId: 'createOrder' })] }
    const id = await store.add(scenario)
    const read = await store.get(id)
    expect(read.name).toBe('checkout')
    expect(read.steps).toHaveLength(1)
    expect(read.createdAt).toBeGreaterThan(0)
    expect(read.updatedAt).toBe(read.createdAt)
  })

  it('preserves createdAt and specId across an update', async () => {
    const scoped = new ScenarioStore({ specId: 'pets' })
    const scenario = named('first')
    await scoped.add(scenario)
    const before = await scoped.get(scenario.id)
    await scoped.update({ ...before, name: 'renamed' })
    const after = await scoped.get(scenario.id)
    expect(after.name).toBe('renamed')
    expect(after.createdAt).toBe(before.createdAt)
    expect(
      (await new ScenarioStore({ specId: 'pets', scoped: true }).list()).map((s) => s.name),
    ).toEqual(['renamed'])
  })

  it('filters on the active spec in scoped mode only', async () => {
    await new ScenarioStore({ specId: 'pets' }).add(named('pets one'))
    await new ScenarioStore({ specId: 'billing' }).add(named('billing one'))
    const scoped = new ScenarioStore({ specId: 'billing', scoped: true })
    expect((await scoped.list()).map((s) => s.name)).toEqual(['billing one'])
    expect(await store.list()).toHaveLength(2)
  })

  it('re-validates records on read instead of returning them raw', async () => {
    // Reading a database is an untrusted input like any other — the store
    // shares an origin with the host page and is editable from devtools — so
    // the unusable step is dropped on the way out.
    const scenario = named('mixed')
    await store.add({ ...scenario, steps: [createStep({ opId: 'listPets' }), { note: 'no opId' }] })
    const read = await store.get(scenario.id)
    expect(read.steps.map((s) => s.opId)).toEqual(['listPets'])
  })
})

describe('hard cap', () => {
  it('refuses the write past the cap with an actionable error', async () => {
    const scoped = new ScenarioStore({ specId: 'capped', scoped: true })
    for (let i = 0; i < MAX_SCENARIOS_PER_SPEC; i++) await scoped.add(named(`s${i}`))
    await expect(scoped.add(named('one too many'))).rejects.toThrow(StorageLimitError)
    await expect(scoped.add(named('one too many'))).rejects.toMatchObject({
      limit: MAX_SCENARIOS_PER_SPEC,
    })
    expect(await scoped.list()).toHaveLength(MAX_SCENARIOS_PER_SPEC)
  })

  it('counts per spec, so a full spec does not lock out the others', async () => {
    const full = new ScenarioStore({ specId: 'full', scoped: true })
    for (let i = 0; i < MAX_SCENARIOS_PER_SPEC; i++) await full.add(named(`s${i}`))
    const other = new ScenarioStore({ specId: 'other', scoped: true })
    await expect(other.add(named('fine'))).resolves.toBeTruthy()
  })

  it('applies to duplicates too — they go through the same write path', async () => {
    const scoped = new ScenarioStore({ specId: 'dupes', scoped: true })
    for (let i = 0; i < MAX_SCENARIOS_PER_SPEC; i++) await scoped.add(named(`s${i}`))
    const [first] = await scoped.list()
    await expect(scoped.duplicate(first, { name: 'copy' })).rejects.toThrow(StorageLimitError)
  })

  it('does not emit change when the write was refused', async () => {
    const scoped = new ScenarioStore({ specId: 'silent', scoped: true })
    for (let i = 0; i < MAX_SCENARIOS_PER_SPEC; i++) await scoped.add(named(`s${i}`))
    let changes = 0
    scoped.addEventListener('change', () => changes++)
    await scoped.add(named('rejected')).catch(() => {})
    expect(changes).toBe(0)
  })
})
