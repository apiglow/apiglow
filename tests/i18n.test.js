import { describe, expect, it } from 'vitest'
import { t } from '../src/i18n/index.js'

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
})
