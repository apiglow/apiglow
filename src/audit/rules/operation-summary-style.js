// A summary written as Markdown or HTML — `**Create** a pet`, `` `GET` the
// list ``, `[docs](…)`, `<b>`, a line break. The summary is plain text in
// OpenAPI ("A short summary of what the operation does") and plain text
// everywhere this documentation shows it: the navigation entry, the page
// heading, the tab title (one line, breaks collapsed), a callback's line, the
// pager. The markup is printed as typed — asterisks, backticks, brackets and
// tags included — and a line break does not survive the one-line places.
//
// Every operation, webhook and callback with a non-blank summary: one check
// each. No length or punctuation test: those are the author's.
const MARKUP = /\*\*|__|`|\[[^\]\n]*\]\([^)\n]*\)|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|[\r\n]/

export const operationSummaryStyle = {
  id: 'operation-summary-style',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      const summary = entry.op.summary
      if (typeof summary !== 'string' || !summary.trim()) continue
      const markup = MARKUP.exec(summary.trim())
      check(!markup, {
        op: entry,
        dataPath: `${entry.pointer}/summary`,
        params: markup ? { markup: markup[0].replace(/\r?\n|\r/, '↵') } : {},
      })
    }
  },
}
