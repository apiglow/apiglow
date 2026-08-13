import { describe, expect, it } from 'vitest'
import {
  ENV_AURA,
  ENV_BADGE,
  ENV_COLORS,
  ENV_GRADIENT,
  ENV_HUES,
  ENV_SWATCH,
  envBadgeClass,
  normalizeEnvColor,
} from '../src/env/colors.js'

// The maps are static by obligation (rule 2: a dynamically built class is
// purged by the Tailwind JIT), so nothing but a test catches a color added to
// one map and forgotten in another — the UI would just render an unstyled dot.
describe('closed color palette', () => {
  it('covers every color with a swatch and a badge', () => {
    for (const color of ENV_COLORS) {
      expect(ENV_SWATCH[color], `swatch missing for ${color}`).toBeTruthy()
      expect(ENV_BADGE[color], `badge missing for ${color}`).toBeTruthy()
    }
  })

  it('gives a gradient to the hues only — auras carry their own glow', () => {
    for (const hue of ENV_HUES) expect(ENV_GRADIENT[hue]).toBeTruthy()
    for (const aura of Object.keys(ENV_AURA)) expect(ENV_GRADIENT[aura]).toBeUndefined()
  })

  it('offers the auras after the hues', () => {
    expect(ENV_COLORS).toEqual([...ENV_HUES, ...Object.keys(ENV_AURA)])
  })

  it('never builds a class by interpolation', () => {
    const values = [
      ...Object.values(ENV_AURA),
      ...Object.values(ENV_GRADIENT),
      ...Object.values(ENV_SWATCH),
      ...Object.values(ENV_BADGE),
    ]
    for (const value of values) expect(value).not.toMatch(/\$\{/)
  })
})

describe('normalizeEnvColor', () => {
  it('keeps a known color and rejects everything else', () => {
    expect(normalizeEnvColor('teal')).toBe('teal')
    expect(normalizeEnvColor('gold')).toBe('gold')
    expect(normalizeEnvColor('chartreuse')).toBeNull()
    expect(normalizeEnvColor('')).toBeNull()
    expect(normalizeEnvColor(undefined)).toBeNull()
  })
})

describe('envBadgeClass', () => {
  it('falls back to a neutral badge for an unknown or absent color', () => {
    expect(envBadgeClass('red')).toBe(ENV_BADGE.red)
    expect(envBadgeClass('chartreuse')).toBe('badge-ghost')
    expect(envBadgeClass(null)).toBe('badge-ghost')
  })
})
