// A prose field counts as present only when it carries something: `description:
// ""` documents exactly as much as no description at all, and a rule reading it
// with a bare `!== undefined` would hand out a free pass for it.
export function hasText(value) {
  return typeof value === 'string' && Boolean(value.trim())
}
