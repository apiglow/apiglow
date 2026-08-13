// Handing a generated file to the reader. Separate from `dom.js`, whose
// contract is building page nodes with no innerHTML path for external
// content (rule 5): this one builds nothing the page keeps — it fires a
// side effect on the document and undoes itself.

// Downloading generated text: ephemeral blob link — no external
// content, only locally produced artifacts.
export function downloadText(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
