import { placeOf } from '../locate.js'
import {
  isRelativeTarget,
  markdownFields,
  markdownLinks as linksIn,
  openTags,
} from '../markdown-text.js'

// A link or an image in a description whose target is relative — `./auth.md`,
// `../guides/pagination`, `/docs/errors`, `diagram.png`. OpenAPI does not
// resolve it against the document: "Relative references in CommonMark
// hyperlinks are resolved in their rendered context, which might differ from
// the context of the API description" (OAS 3.0.4/3.1.1 §4.6, 3.2.0
// §4.1.2.2.3). Written next to the source files, it points into a repository;
// rendered, it points wherever the page happens to be served. This
// documentation sets no base and rewrites no link, so the target resolves
// against the documentation page's own URL: the image does not load, the link
// lands on a 404 of the documentation host.
//
// A lone fragment (`#pagination`) is fine — here it scrolls to the element
// with that id and never changes the route — and a protocol-relative `//host`
// names its host. Inline links and images, the reference definitions a
// reference uses, raw `<a href>`, `<area href>`, and the `src` of `<img>` and
// of the media elements (an `<iframe src>` is stripped whole: `markdown-unsafe`'s). Code spans and blocks are
// not links. One check per CommonMark field with a link; the finding names
// the first relative target.
export const markdownLinks = {
  id: 'markdown-links',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    for (const { dataPath, code } of markdownFields(ctx)) {
      const targets = [
        ...linksIn(code),
        ...openTags(code).flatMap((tag) => {
          const attribute = LINK_ATTRIBUTES[tag.name.toLowerCase()]
          return tag.attributes
            .filter(({ name, value }) => value !== null && name.toLowerCase() === attribute)
            .map(({ value }) => ({ target: value, index: tag.index }))
        }),
      ].sort((a, b) => a.index - b.index)
      if (!targets.length) continue
      const relative = targets.find(({ target }) => isRelativeTarget(target))
      check(!relative, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: relative ? { target: relative.target } : {},
      })
    }
  },
}

// The kept elements whose attribute loads or links a URL.
const LINK_ATTRIBUTES = {
  a: 'href',
  area: 'href',
  img: 'src',
  audio: 'src',
  video: 'src',
  source: 'src',
  track: 'src',
}
