// What DOMPurify removes from a description on top of its HTML profile —
// shared by the renderer (`components/markdown.js`) and the audit rule that
// says what a reader loses (`audit/rules/markdown-unsafe.js`), which cannot
// import DOMPurify itself (docs/architecture.md §14.8).
//
// A stylesheet restyles the whole app, not just the description that carries
// it, and a form control in a description is a field a reader can be asked to
// type a secret into. The `style` attribute stays — it reaches no further than
// its own element.
export const FORBIDDEN_TAGS = [
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'optgroup',
]
