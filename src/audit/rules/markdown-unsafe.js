import { placeOf } from '../locate.js'
import { hasRawHtml, markdownFields, markdownLinks, openTags } from '../markdown-text.js'

// Raw HTML in a description that the sanitizer removes: `<iframe>`, `<script>`,
// `<svg>`, a form control, an `onclick`, a `javascript:` link — and the
// accidental tag, `List<Item>` or `/users/<id>`, which CommonMark reads as an
// element no sanitizer keeps. Every renderer that renders Markdown into a page
// has to strip these ("Tooling MAY choose to ignore some CommonMark or extension
// features to address security concerns", OAS Rich Text Formatting); this
// documentation runs DOMPurify's html profile over every description it renders
// as Markdown, with `<style>` and the form controls forbidden on top
// (`components/markdown.js`).
// The reader gets nothing where the author put the embed, the button or the
// placeholder: no error, no trace.
//
// The lists below mirror DOMPurify 3.4.13's html profile (`html$1` tags, `html`
// attributes, `IS_ALLOWED_URI`, `DATA_URI_TAGS`, `URI_SAFE_ATTRIBUTES` in
// `purify.es.mjs`) — mirrored rather than imported: the audit bundle carries no
// DOMPurify (docs/architecture.md §14.8). They move with the pinned version.
//
// Text in code spans and code blocks is shown as typed and is not judged. One
// check per CommonMark field holding raw HTML or a Markdown link (whose target
// becomes an `href`/`src` the same sanitizer vets); the finding names the
// first thing stripped, as written. A relative link target is
// `markdown-links`'.
const ALLOWED_TAGS = new Set(
  `a abbr acronym address area article aside audio b bdi bdo big blink blockquote body br
  canvas caption center cite code col colgroup content data datalist dd decorator del details
  dfn dialog dir div dl dt element em fieldset figcaption figure font footer h1 h2 h3 h4 h5 h6
  head header hgroup hr html i img ins kbd label legend li main map mark marquee menu menuitem
  meter nav nobr ol optgroup option output p picture pre progress q rp rt ruby s samp search
  section shadow slot small source spacer span strike strong sub summary sup table tbody td
  template tfoot th thead time tr track tt u ul var video wbr`.split(/\s+/),
)
// In the profile, forbidden by this documentation's own configuration
// (`FORBID_TAGS` in `components/markdown.js`).
const FORBIDDEN_TAGS = new Set([
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'optgroup',
])

const ALLOWED_ATTRIBUTES = new Set(
  `accept action align alt autocapitalize autocomplete autopictureinpicture autoplay background
  bgcolor border capture cellpadding cellspacing checked cite class clear color cols colspan
  command commandfor controls controlslist coords crossorigin datetime decoding default dir
  disabled disablepictureinpicture disableremoteplayback download draggable enctype
  enterkeyhint exportparts face for headers height hidden high href hreflang id inert inputmode
  integrity ismap kind label lang list loading loop low max maxlength media method min minlength
  multiple muted name nonce noshade novalidate nowrap open optimum part pattern placeholder
  playsinline popover popovertarget popovertargetaction poster preload pubdate radiogroup
  readonly rel required rev reversed role rows rowspan spellcheck scope selected shape size
  sizes slot span srclang start src srcset step style summary tabindex title translate type
  usemap valign value width wrap xmlns`.split(/\s+/),
)
// Values never vetted as URLs.
const URI_SAFE_ATTRIBUTES = new Set([
  'alt',
  'class',
  'for',
  'id',
  'label',
  'name',
  'pattern',
  'placeholder',
  'role',
  'summary',
  'title',
  'value',
  'style',
  'xmlns',
])
const DATA_URI_TAGS = new Set(['audio', 'video', 'img', 'source', 'image', 'track'])
const DATA_ATTRIBUTE = /^data-[-\w.·-￿]+$/
const ARIA_ATTRIBUTE = /^aria-[-\w]+$/
const ALLOWED_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
// DOMPurify's whitespace class (`ATTR_WHITESPACE`): C0 controls, space, and the
// Unicode spaces and line separators, stripped before the URL test.
const ATTRIBUTE_WHITESPACE = new RegExp(
  `[${range(0x00, 0x20)}${range(0xa0)}${range(0x1680)}${range(0x180e)}${range(0x2000, 0x2029)}${range(0x205f)}${range(0x3000)}]`,
  'g',
)

export const markdownUnsafe = {
  id: 'markdown-unsafe',
  category: 'readiness',
  severity: 'warning',
  run(ctx, check) {
    for (const { dataPath, code } of markdownFields(ctx)) {
      const tags = openTags(code)
      const links = markdownLinks(code)
      if (!tags.length && !links.length && !hasRawHtml(code)) continue
      const construct = firstStripped(tags, links)
      check(construct === null, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: construct === null ? {} : { construct },
      })
    }
  },
}

// Tags and Markdown links interleaved in text order: the first thing stripped
// is the one the author meets first reading the source.
function firstStripped(tags, links) {
  const items = [
    ...tags.map((tag) => ({ index: tag.index, construct: strippedFromTag(tag) })),
    ...links.map((link) => ({
      index: link.index,
      construct: link.image
        ? strippedUrl('img', 'src', link.target)
        : strippedUrl('a', 'href', link.target),
    })),
  ].sort((a, b) => a.index - b.index)
  return items.find((item) => item.construct !== null)?.construct ?? null
}

function strippedFromTag({ name, attributes }) {
  const tag = name.toLowerCase()
  if (!ALLOWED_TAGS.has(tag) || FORBIDDEN_TAGS.has(tag)) return `<${name}>`
  for (const { name: attribute, value } of attributes) {
    const lower = attribute.toLowerCase()
    if (DATA_ATTRIBUTE.test(lower) || ARIA_ATTRIBUTE.test(lower)) continue
    if (!ALLOWED_ATTRIBUTES.has(lower)) return attribute
    if (lower === 'for' && tag !== 'label' && tag !== 'output') return attribute
    const url = strippedUrl(tag, lower, value ?? '')
    if (url !== null) return url
  }
  return null
}

// What DOMPurify does with an allowed attribute's value: kept when the
// attribute is never a URL, when the value passes its URL pattern, or for a
// `data:` URL on a media element; dropped otherwise. → the scheme as written,
// or null when the value stays.
function strippedUrl(tag, attribute, value) {
  if (URI_SAFE_ATTRIBUTES.has(attribute) || !value) return null
  if (ALLOWED_URI.test(value.replace(ATTRIBUTE_WHITESPACE, ''))) return null
  if (
    (attribute === 'src' || attribute === 'href') &&
    value.startsWith('data:') &&
    DATA_URI_TAGS.has(tag)
  )
    return null
  const scheme = /^[^:]*:/.exec(value.trim())
  return scheme ? scheme[0] : value
}

function range(from, to = from) {
  const unit = (code) => `\\u${code.toString(16).padStart(4, '0')}`
  return from === to ? unit(from) : `${unit(from)}-${unit(to)}`
}
