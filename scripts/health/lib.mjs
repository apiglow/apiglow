// Shared plumbing for the `health:*` detectors (see
// .claude/skills/code-health/SKILL.md and docs/registry/code-health-registry.md).
// Zero dependencies on purpose: each detector answers one narrow question
// the registry asks, and a general tool would need more configuration to
// suppress its false positives than these scripts have lines.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../..', import.meta.url))

export function walk(dir, ext = '.js') {
  const out = []
  for (const name of readdirSync(join(root, dir)).sort()) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel, ext))
    else if (name.endsWith(ext)) out.push(rel)
  }
  return out
}

export function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

export const rel = (abs) => relative(root, abs)

// Every detector prints one headline number first, then its detail lines:
// a run of `npm run health` must be skimmable down the left margin.
export function headline(label, value, detail = '') {
  console.log(`${label}: ${value}${detail ? ` ${detail}` : ''}`)
}

export function section(title, lines) {
  if (!lines.length) return
  console.log(`\n  ${title}`)
  for (const line of lines) console.log(`    ${line}`)
}
