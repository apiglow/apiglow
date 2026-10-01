import { describe, expect, it } from 'vitest'
import { extendEnglish, t, useDictionary } from '../src/i18n/index.js'

describe('i18n', () => {
  it('returns embedded english strings', () => {
    expect(t('app.loading')).toBe('Loading…')
  })

  it('falls back to the key itself when missing', () => {
    expect(t('nope.missing')).toBe('nope.missing')
  })

  it('interpolates {param} placeholders and keeps unknown ones visible', () => {
    expect(t('x {a} y {b}', {})).toBe('x {a} y {b}')
  })

  // docs/architecture.md §14.8: the audit's rule texts arrive with the audit.
  it('takes in the English strings of a part loaded later, translations first', () => {
    useDictionary('fr', { 'late.title': 'Titre', 'app.loading': 'Chargement…' })
    extendEnglish({ 'late.title': 'Title', 'late.hint': 'Hint' })
    expect(t('late.title')).toBe('Titre')
    expect(t('late.hint')).toBe('Hint')
    useDictionary('en', null)
    expect(t('late.title')).toBe('Title')
    extendEnglish({ 'later.key': 'Later' })
    expect(t('later.key')).toBe('Later')
  })
})
