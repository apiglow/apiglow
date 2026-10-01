import { toolOperations } from '../tool-inputs.js'

// More operations than an agent platform takes as tools. A bridge turns every
// operation of the document into a tool, and the platforms cap the list: GPT
// Actions at 30 operations per action (the builder refuses the document: "OpenAI
// spec can have a maximum of 30 operations"); the OpenAI API at 128 tools per
// request ("Expected an array with maximum length 128"); VS Code / GitHub
// Copilot at 128 tools enabled at a time. Past the cap, the document cannot be
// handed over whole; below it, every tool's description still competes for
// the model's attention and context.
//
// Hidden operations count: hiding lives in this documentation, and a bridge
// reading the file serves them all the same. The limit stated is the one
// crossed — 128 above it, 30 otherwise. One document check, none for a
// document with no operation.
const ACTIONS_LIMIT = 30
const TOOLS_LIMIT = 128

export const toolSurfaceSize = {
  id: 'tool-surface-size',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const count = toolOperations(ctx).length
    if (!count) return
    check(count <= ACTIONS_LIMIT, {
      location: 'paths',
      dataPath: '/paths',
      params: { count, limit: count > TOOLS_LIMIT ? TOOLS_LIMIT : ACTIONS_LIMIT },
    })
  },
}
