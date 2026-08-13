// Identification color for an environment: closed palette of 10 hues,
// plus "auras" which are not hues but animated glowing borders
// (daisyUI's `aura` component), reserved for environments you
// want to spot from afar.
// Fixed Tailwind colors (no daisyUI semantic colors) by design:
// "red = prod" must stay red regardless of the active theme.
// Static maps only — dynamically built classes would be
// purged by the Tailwind JIT (rule 2 of CLAUDE.md).

export const ENV_HUES = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'purple',
  'pink',
]

// Auras, offered after the hues in the selector. Each value is the
// list of classes to put on the container wrapping the trigger — a
// complete literal, never interpolated (the JIT must see it in the source).
export const ENV_AURA = {
  rainbow: 'aura aura-rainbow aura-sm',
  gold: 'aura aura-gold aura-sm',
  silver: 'aura aura-silver aura-sm',
  // No dedicated style on daisyUI's side: the bare aura sweeps from transparent to
  // `currentColor`, which `text-orange-500` fixes. Duration lengthened — a sweep
  // in bright orange at the default speed catches the eye too much for a marker.
  ember: 'aura aura-sm text-orange-500 duration-[9s]',
}

export const ENV_COLORS = [...ENV_HUES, ...Object.keys(ENV_AURA)]

// Background gradient of the environment selector trigger. Auras don't have
// one: their glowing border is already the marker.
export const ENV_GRADIENT = {
  red: 'bg-linear-to-r from-red-500/40 to-transparent',
  orange: 'bg-linear-to-r from-orange-500/40 to-transparent',
  amber: 'bg-linear-to-r from-amber-400/40 to-transparent',
  lime: 'bg-linear-to-r from-lime-500/40 to-transparent',
  green: 'bg-linear-to-r from-green-500/40 to-transparent',
  teal: 'bg-linear-to-r from-teal-500/40 to-transparent',
  cyan: 'bg-linear-to-r from-cyan-500/40 to-transparent',
  blue: 'bg-linear-to-r from-blue-500/40 to-transparent',
  purple: 'bg-linear-to-r from-purple-500/40 to-transparent',
  pink: 'bg-linear-to-r from-pink-500/40 to-transparent',
}

// Swatches: color choice in the manager, and identification dot
// in front of each environment in the selector. Auras are locked to a
// gradient here — a 10 px swatch can't carry the animation, only
// announce what it looks like.
export const ENV_SWATCH = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-400',
  lime: 'bg-lime-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  cyan: 'bg-cyan-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  // Static literals (never interpolated): the JIT sees them in the source.
  rainbow:
    'bg-[conic-gradient(#ef4444,#f59e0b,#84cc16,#10b981,#06b6d4,#3b82f6,#a855f7,#ec4899,#ef4444)]',
  // Same hues as the corresponding daisyUI gradients, reduced to a few
  // stops: a metal is recognized by its dark/light alternation.
  gold: 'bg-[conic-gradient(#b8860b,#ffe9a8,#d4a017,#fff3c4,#9a6b12,#b8860b)]',
  silver: 'bg-[conic-gradient(#4d4d4d,#e6e6e6,#8c8c8c,#e6e6e6,#6b6b6b,#4d4d4d)]',
  ember: 'bg-[conic-gradient(#f97316,#dc2626,#fb923c,#f97316)]',
}

// Environment name badges in call listings (history, try-it runs):
// tinted background and border, text left in base-content — at this
// size colored text would be illegible on dark themes.
export const ENV_BADGE = {
  red: 'bg-red-500/20 border-red-500/50',
  orange: 'bg-orange-500/20 border-orange-500/50',
  amber: 'bg-amber-400/20 border-amber-400/50',
  lime: 'bg-lime-500/20 border-lime-500/50',
  green: 'bg-green-500/20 border-green-500/50',
  teal: 'bg-teal-500/20 border-teal-500/50',
  cyan: 'bg-cyan-500/20 border-cyan-500/50',
  blue: 'bg-blue-500/20 border-blue-500/50',
  purple: 'bg-purple-500/20 border-purple-500/50',
  pink: 'bg-pink-500/20 border-pink-500/50',
  // Static literals, like the swatches: alpha in the colors rather
  // than an opacity modifier, which wouldn't apply to a gradient.
  rainbow:
    'bg-[linear-gradient(90deg,#ef444433,#f59e0b33,#84cc1633,#10b98133,#06b6d433,#3b82f633,#a855f733,#ec489933)] border-base-content/20',
  gold: 'bg-[linear-gradient(90deg,#b8860b33,#ffe9a833,#d4a01733)] border-[#d4a017]/50',
  silver: 'bg-[linear-gradient(90deg,#4d4d4d33,#e6e6e633,#8c8c8c33)] border-base-content/30',
  ember: 'bg-[linear-gradient(90deg,#f9731633,#dc262633)] border-orange-500/50',
}

export function envBadgeClass(color) {
  return ENV_BADGE[color] ?? 'badge-ghost'
}

export function normalizeEnvColor(value) {
  return ENV_COLORS.includes(value) ? value : null
}
