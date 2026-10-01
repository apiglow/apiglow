import { pathKeys, pathSegments, pathTarget } from '../path-segments.js'
import { wellFormed } from '../path-template.js'

// Two Paths keys that differ only by the names of their template variables:
// `/pets/{id}` and `/pets/{petId}` describe the same URLs, and the
// specification forbids it (OAS 3.x, Path Templating Matching, MUST NOT). A
// server routes a request to one of them; which one, nothing in the document
// says. Here, a request pasted into the import dialog fits both equally, and
// the reader is asked to choose between two pages documenting one URL.
//
// One finding on each key after the first of its shape. A key `path-syntax`
// rejects is left out: its segments say nothing reliable about its shape.
export const pathsIdentical = {
  id: 'paths-identical',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const first = new Map()
    for (const path of pathKeys(ctx).filter(wellFormed)) {
      const shape = pathSegments(path)
        .map((segment) =>
          segment.templated ? segment.text.replace(/\{[^{}]*\}/g, '{}') : segment.text,
        )
        .join('/')
      if (!first.has(shape)) {
        first.set(shape, path)
        continue
      }
      check(false, { ...pathTarget(ctx, path), params: { path, other: first.get(shape) } })
    }
  },
}
