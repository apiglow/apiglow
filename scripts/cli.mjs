#!/usr/bin/env node
// The `apiglow` binary: one entry, one module per subcommand. A command's
// `main(args)` returns `{ stdout, stderr, code }` and never touches the process
// itself — which is what lets the tests drive it — so writing the streams and
// setting the exit status happens here, once.
//
// Exit status: 0 done, 1 reserved for a check the command ran and the input
// failed, 2 the command could not run (bad usage, unreadable input, a crash).

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { main as bake } from './bake.mjs'
import { CliError } from './cli-support.mjs'

const COMMANDS = { bake }

const USAGE = `Usage: apiglow <command> [options]

Commands:
  bake    write the documentation to disk as static files (sitemap, llms.txt, snapshots)

Run \`apiglow <command> --help\` for the options of a command.`

export async function run(argv) {
  const [name, ...args] = argv
  if (!name || name === '--help' || name === '-h') return { stdout: USAGE }
  const command = COMMANDS[name]
  if (!command) return { stderr: `apiglow: unknown command "${name}"\n\n${USAGE}`, code: 2 }
  try {
    return await command(args)
  } catch (err) {
    return {
      stderr:
        err instanceof CliError ? `apiglow ${name}: ${err.message}` : String(err?.stack ?? err),
      code: 2,
    }
  }
}

// Run only when invoked as a program: the tests import `run()`. The real path,
// because npm installs the bin as a symlink (`node_modules/.bin/apiglow`, which
// is what `npx` runs): `argv[1]` names the link, `import.meta.url` the file it
// points at, and comparing them as given would make the command a silent no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { stdout, stderr, code = 0 } = await run(process.argv.slice(2))
  if (stdout) console.log(stdout)
  if (stderr) console.error(stderr)
  process.exitCode = code
}
