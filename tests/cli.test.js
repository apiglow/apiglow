import { describe, expect, it } from 'vitest'
import { run } from '../scripts/cli.mjs'

// The `apiglow` entry itself: routing to a command, and the exit status a CI
// job reads — the commands are tested on their own.
describe('apiglow', () => {
  it('lists its commands', async () => {
    const { stdout, code } = await run(['--help'])
    expect(code).toBeUndefined()
    expect(stdout).toMatch(/^Usage: apiglow <command>/)
    expect(stdout).toMatch(/^ {2}audit /m)
    expect(stdout).toMatch(/^ {2}bake /m)
    expect(await run([])).toEqual({ stdout })
  })

  it('refuses a command it does not have, with the usage', async () => {
    const { stderr, code } = await run(['bakery'])
    expect(code).toBe(2)
    expect(stderr).toMatch(/^apiglow: unknown command "bakery"/)
    expect(stderr).toContain('Usage: apiglow <command>')
  })
})
