import { describe, expect, it } from 'vitest'
import { isSubstantive } from '../src/audit/text.js'

// What the `*-described` rules accept as documentation (docs/audit.md §4.2): a
// placeholder or the name read back fills the slot and documents nothing.
describe('isSubstantive', () => {
  it('accepts prose that says something', () => {
    expect(isSubstantive('Returns the pets, optionally filtered by status.')).toBe(true)
    expect(
      isSubstantive('Identifier of the owner, as returned by /login', { name: 'ownerId' }),
    ).toBe(true)
  })

  it('refuses empty text and placeholders, in either language and any case', () => {
    for (const value of [
      undefined,
      '',
      '   ',
      '...',
      'TODO',
      'tbd.',
      'FIXME',
      'string',
      'Description',
      'N/A',
      'Lorem ipsum dolor sit amet',
      'À compléter',
      'a définir',
    ]) {
      expect(isSubstantive(value), JSON.stringify(value)).toBe(false)
    }
  })

  it('refuses the name read back, whatever its casing or article', () => {
    expect(isSubstantive('User Id', { name: 'userId' })).toBe(false)
    expect(isSubstantive('The user id.', { name: 'user_id' })).toBe(false)
    expect(isSubstantive('Additional Metadata', { name: 'additionalMetadata' })).toBe(false)
    expect(isSubstantive('Le statut', { name: 'statut' })).toBe(false)
    expect(isSubstantive('ID', { name: 'id' })).toBe(false)
  })

  it('keeps text that merely mentions its name', () => {
    expect(isSubstantive('User id of the account owner', { name: 'userId' })).toBe(true)
  })
})
