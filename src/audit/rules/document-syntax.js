// What is wrong in the text itself: a duplicate key, a tab used as
// indentation, a trailing comma, a file cut short. Validators, code generators
// and most tools refuse such a file outright. The loader reads past the error
// (docs/architecture.md §14.21) so this documentation, and the rest of the
// audit, can still show what the file holds — but there, what the author meant
// is the reader's guess.
//
// One failing check per problem the reading reported, at the line and column
// the parser gave — the CLI places the finding there, not at a JSON pointer: a
// broken text is precisely where pointers stop meaning anything. `detail` is
// the parser's own message, data rather than a translation. A file read
// strictly has no problem and no check here. Runs whatever the file holds
// (`file: true`): a sentence with a broken quote is still a broken text.

// The tolerant reader's code for text that looks like JSON and is not
// (`src/openapi/read-document.js`); every other code is the YAML parser's.
const JSON_PROBLEM = 'json'

export const documentSyntax = {
  id: 'document-syntax',
  category: 'correctness',
  severity: 'error',
  file: true,
  run(ctx, check) {
    for (const { code, line, column, detail } of ctx.problems) {
      check(false, {
        dataPath: '',
        params: { line, column, detail, format: code === JSON_PROBLEM ? 'JSON' : 'YAML' },
      })
    }
  },
}
