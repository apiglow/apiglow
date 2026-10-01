import { pathKeys, pathTarget } from '../path-segments.js'
import { wellFormed } from '../path-template.js'

// A Paths key that is not a path template. The specification wants each key
// to begin with `/` (OAS 3.x, Paths Object, MUST), its `{…}` expressions to be
// well formed, and each one to appear once (3.2 says it, earlier versions
// assume it). A key that is none of that cannot be appended to a server URL:
// - no leading `/` glues the path onto the server's last segment;
// - an unbalanced, nested or empty brace leaves a literal `{` in the URL, the
//   try-it substituting only the well-formed `{name}`;
// - a name used twice is one value for two places;
// - a `?` or `#` puts a query or a fragment where only a path belongs. The
//   try-it appends the query parameters after it with `&` — and after a `#`,
//   they never reach the server: the browser keeps the fragment to itself.
//
// Webhook and callback keys are names and runtime expressions, not paths: not
// read here. A template variable with no parameter is `path-param-declared`'s.
// One check per malformed key.
export const pathSyntax = {
  id: 'path-syntax',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const path of pathKeys(ctx)) {
      if (wellFormed(path)) continue
      check(false, { ...pathTarget(ctx, path), params: { path } })
    }
  },
}
