import { describe, expect, it } from 'vitest'
import {
  baseThemesOf,
  BUILTIN_THEMES,
  PROBE_PROPERTIES,
  renderCustomThemesCss,
  THEME_TOKENS,
  validateCustomThemes,
} from '../src/theming/custom-themes.js'

const validate = (custom, available = ['acme']) => validateCustomThemes(custom, { available })
const only = (custom, available) => validate(custom, available).themes[0]

describe('token whitelist', () => {
  it('covers the daisyUI 5 theme contract', () => {
    expect(THEME_TOKENS).toHaveLength(28)
    expect(THEME_TOKENS.filter((token) => token.startsWith('--color-'))).toHaveLength(20)
    expect(PROBE_PROPERTIES[0]).toBe('color-scheme')
    expect(PROBE_PROPERTIES).toHaveLength(29)
  })

  it('lists the built-in themes the build ships', () => {
    // 35 standard daisyUI themes + the signature pair.
    expect(BUILTIN_THEMES).toHaveLength(37)
    expect(BUILTIN_THEMES).toContain('light')
    expect(BUILTIN_THEMES).toContain('dark')
    expect(BUILTIN_THEMES).toContain('apiglow')
    expect(BUILTIN_THEMES).toContain('apiglow-dark')
  })
})

describe('validateCustomThemes', () => {
  it('keeps a well-formed definition', () => {
    const { themes, warnings } = validate([
      {
        name: 'acme',
        extends: 'dark',
        colorScheme: 'dark',
        tokens: { '--color-primary': '#6d28d9', '--radius-box': '0.25rem' },
      },
    ])
    expect(warnings).toEqual([])
    expect(themes).toEqual([
      {
        name: 'acme',
        extends: 'dark',
        colorScheme: 'dark',
        tokens: { '--color-primary': '#6d28d9', '--radius-box': '0.25rem' },
      },
    ])
  })

  it('accepts a missing, empty or non-array config', () => {
    expect(validate(undefined).themes).toEqual([])
    expect(validate([]).warnings).toEqual([])
    expect(validate('acme').themes).toEqual([])
  })

  it('rejects a name that is not a CSS-safe identifier', () => {
    const { themes, warnings } = validate([
      { name: 'Acme' },
      { name: '2fast' },
      { name: 'a b' },
      { name: 'a"]{}' },
      {},
      { name: 42 },
      'acme',
    ])
    expect(themes).toEqual([])
    expect(warnings).toHaveLength(7)
    expect(warnings[0]).toMatch(/ignored, "name" must match/)
    expect(warnings[6]).toMatch(/expected an object/)
  })

  it('accepts a built-in name, for an in-place override', () => {
    expect(only([{ name: 'light', tokens: { '--color-primary': 'red' } }], ['light']).name).toBe(
      'light',
    )
  })

  it('skips a duplicate definition, first wins', () => {
    const { themes, warnings } = validate([
      { name: 'acme', tokens: { '--color-primary': 'red' } },
      { name: 'acme', tokens: { '--color-primary': 'blue' } },
    ])
    expect(themes).toHaveLength(1)
    expect(themes[0].tokens['--color-primary']).toBe('red')
    expect(warnings[0]).toMatch(/duplicate/)
  })

  it('warns when the name is absent from theme.available but keeps the theme', () => {
    const { themes, warnings } = validate(
      [{ name: 'acme', tokens: { '--border': '1px' } }],
      ['light'],
    )
    expect(themes).toHaveLength(1)
    expect(warnings[0]).toMatch(/absent from theme.available/)
  })

  it('drops an unknown token', () => {
    const { themes, warnings } = validate([
      { name: 'acme', tokens: { '--color-brand': 'red', '--color-primary': 'blue' } },
    ])
    expect(themes[0].tokens).toEqual({ '--color-primary': 'blue' })
    expect(warnings[0]).toMatch(/unknown token "--color-brand"/)
  })

  it('drops a value that could break out of the declaration', () => {
    const { themes, warnings } = validate([
      {
        name: 'acme',
        tokens: {
          '--color-primary': 'red; } body { display: none',
          '--color-secondary': 'blue}',
          '--color-accent': '</style><script>x</script>',
          '--color-info': 'red\ngreen',
          '--color-error': '',
          '--color-success': '   ',
          '--color-warning': { nope: true },
          '--border': 1,
        },
      },
    ])
    expect(themes[0].tokens).toEqual({ '--border': '1' })
    expect(warnings).toHaveLength(7)
    expect(warnings[0]).toMatch(/invalid value for "--color-primary"/)
  })

  it('passes any CSS color syntax through untouched', () => {
    const tokens = {
      '--color-primary': 'oklch(97% 0.014 308)',
      '--color-secondary': 'color-mix(in oklab, red 40%, blue)',
      '--color-accent': 'rgb(0 0 0 / 50%)',
      '--noise': '0',
    }
    expect(only([{ name: 'acme', tokens }]).tokens).toEqual(tokens)
  })

  it('drops a non-object tokens map', () => {
    const { themes, warnings } = validate([{ name: 'acme', tokens: ['--color-primary'] }])
    expect(themes[0].tokens).toEqual({})
    expect(warnings[0]).toMatch(/"tokens" ignored/)
  })

  it('rejects a colorScheme outside light/dark', () => {
    expect(
      only([{ name: 'acme', colorScheme: 'grey', tokens: { '--border': '1px' } }]).colorScheme,
    ).toBe(null)
    expect(
      only([{ name: 'acme', colorScheme: 'dark', tokens: { '--border': '1px' } }]).colorScheme,
    ).toBe('dark')
  })

  it('keeps an unknown extends, warning that its values may not resolve', () => {
    const { themes, warnings } = validate([{ name: 'acme', extends: 'darkk' }])
    expect(themes[0].extends).toBe('darkk')
    expect(warnings[0]).toMatch(/not a known built-in daisyUI theme/)
  })

  it('drops an extends targeting another custom theme', () => {
    const { themes, warnings } = validate(
      [
        { name: 'acme', tokens: { '--color-primary': 'red' } },
        { name: 'acme-dark', extends: 'acme' },
      ],
      ['acme', 'acme-dark'],
    )
    expect(themes[1].extends).toBe(null)
    expect(warnings.some((w) => /extending one is out of scope/.test(w))).toBe(true)
  })

  it('lets an in-place override extend the built-in it shadows', () => {
    const { themes, warnings } = validate(
      [{ name: 'dark', extends: 'dark', tokens: { '--color-primary': 'red' } }],
      ['dark'],
    )
    expect(themes[0].extends).toBe('dark')
    expect(warnings).toEqual([])
  })

  it('warns about a theme that would change nothing', () => {
    const { warnings } = validate([{ name: 'acme' }])
    expect(warnings.some((w) => /defines no token/.test(w))).toBe(true)
  })
})

describe('baseThemesOf', () => {
  it('lists the bases to probe, deduplicated and in declaration order', () => {
    const { themes } = validate(
      [
        { name: 'acme', extends: 'dark' },
        { name: 'acme-light', extends: 'light' },
        { name: 'acme-alt', extends: 'dark' },
        { name: 'standalone', tokens: { '--border': '1px' } },
      ],
      ['acme', 'acme-light', 'acme-alt', 'standalone'],
    )
    expect(baseThemesOf(themes)).toEqual(['dark', 'light'])
  })
})

describe('renderCustomThemesCss', () => {
  it('renders a standalone theme with the daisyUI selector shape', () => {
    const { themes } = validate([
      {
        name: 'acme',
        colorScheme: 'dark',
        tokens: { '--radius-box': '0.25rem', '--color-primary': '#6d28d9' },
      },
    ])
    expect(renderCustomThemesCss(themes)).toBe(
      ':is(:root:has(input.theme-controller[value="acme"]:checked),[data-theme="acme"]) {\n' +
        '  color-scheme: dark;\n' +
        '  --color-primary: #6d28d9;\n' +
        '  --radius-box: 0.25rem;\n' +
        '}\n',
    )
  })

  it('emits nothing for an empty theme list', () => {
    expect(renderCustomThemesCss([])).toBe('')
  })

  it('merges probed base values, the override winning', () => {
    const { themes } = validate([
      { name: 'acme', extends: 'dark', tokens: { '--color-primary': '#6d28d9' } },
    ])
    const css = renderCustomThemesCss(themes, {
      dark: {
        'color-scheme': 'dark',
        '--color-primary': '#605dff',
        '--color-base-100': '#1d232a',
        '--radius-box': '1rem',
      },
    })
    expect(css).toContain('  --color-primary: #6d28d9;\n')
    expect(css).not.toContain('#605dff')
    expect(css).toContain('  --color-base-100: #1d232a;\n')
    expect(css).toContain('  --radius-box: 1rem;\n')
  })

  it('inherits color-scheme from the base, an explicit one winning', () => {
    const { themes } = validate(
      [
        { name: 'acme', extends: 'dark' },
        { name: 'acme-alt', extends: 'dark', colorScheme: 'light' },
      ],
      ['acme', 'acme-alt'],
    )
    const css = renderCustomThemesCss(themes, {
      dark: { 'color-scheme': 'dark', '--color-primary': '#605dff' },
    })
    const [inherited, explicit] = css.split(':is(').slice(1)
    expect(inherited).toContain('color-scheme: dark;')
    expect(explicit).toContain('color-scheme: light;')
  })

  it('emits declarations in whitelist order, whatever the config order', () => {
    const { themes } = validate([
      {
        name: 'acme',
        tokens: {
          '--noise': '0',
          '--color-primary': 'red',
          '--border': '1px',
          '--color-base-100': 'white',
        },
      },
    ])
    expect(renderCustomThemesCss(themes)).toContain(
      '  --color-base-100: white;\n  --color-primary: red;\n  --border: 1px;\n  --noise: 0;\n',
    )
  })

  it('falls back to the cascade when the base was not probed', () => {
    const { themes } = validate([
      { name: 'acme', extends: 'dark', tokens: { '--color-primary': 'red' } },
    ])
    expect(renderCustomThemesCss(themes, {})).toBe(
      ':is(:root:has(input.theme-controller[value="acme"]:checked),[data-theme="acme"]) {\n' +
        '  --color-primary: red;\n' +
        '}\n',
    )
  })

  it('skips a theme that has nothing to declare', () => {
    const { themes } = validate([{ name: 'acme' }])
    expect(renderCustomThemesCss(themes)).toBe('')
  })

  it('renders each theme as its own block, in declaration order', () => {
    const { themes } = validate(
      [
        { name: 'acme', tokens: { '--color-primary': 'red' } },
        { name: 'light', tokens: { '--color-primary': 'blue' } },
      ],
      ['acme', 'light'],
    )
    expect(renderCustomThemesCss(themes)).toBe(
      ':is(:root:has(input.theme-controller[value="acme"]:checked),[data-theme="acme"]) {\n' +
        '  --color-primary: red;\n' +
        '}\n' +
        ':is(:root:has(input.theme-controller[value="light"]:checked),[data-theme="light"]) {\n' +
        '  --color-primary: blue;\n' +
        '}\n',
    )
  })

  it('filters probe values through the same break-out check', () => {
    const { themes } = validate([{ name: 'acme', extends: 'dark' }])
    const css = renderCustomThemesCss(themes, {
      dark: {
        '--color-primary': 'red; } * { display: none',
        '--color-secondary': 'blue',
        'not-a-token': 'ignored',
      },
    })
    expect(css).toBe(
      ':is(:root:has(input.theme-controller[value="acme"]:checked),[data-theme="acme"]) {\n' +
        '  --color-secondary: blue;\n' +
        '}\n',
    )
  })
})
