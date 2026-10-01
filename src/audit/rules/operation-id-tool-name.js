import { toolOperations } from '../tool-inputs.js'

// An operationId an agent platform refuses as a tool name. Every OpenAPI→tool
// bridge names the tool after the operationId, and the platforms accept
// different alphabets: OpenAI letters, digits, `_` and `-`, 64 at most; AWS
// Bedrock the same; Vertex AI must start with a letter or an underscore, 128
// at most; Anthropic `^[a-zA-Z0-9_-]{1,128}$`; MCP (2025-11-25) SHOULD use 1 to
// 128 of `A-Za-z0-9_-.`. A name in all of them is
// `^[A-Za-z_][A-Za-z0-9_-]{0,63}$` — GitHub's `meta/root` is in none.
//
// What a bad name costs depends on who reads it, and none of it is benign:
// OpenAI validates the tools array as a whole, so one invalid name rejects the
// request carrying every tool; `@tyk-technologies/api-to-mcp` uses the
// operationId as is and hands the platform the name it refuses;
// `@ivotoby/openapi-mcp-server` rewrites it to lowercase `[a-z0-9-]`,
// abbreviated and cut to 64 with a hash suffix — the tool is no longer called
// what the document says, and nothing written about it (a prompt, a runbook)
// finds it again.
//
// `maxLength` is the one vendor difference worth a knob: a team that only
// serves Anthropic or MCP clients can raise it to 128. The alphabet and the
// first character are not configurable — they are where the platforms agree.
//
// A missing operationId is `operation-id-present`'s, a duplicate
// `duplicate-operation-id`'s; a non-string one `field-value-kind`'s. One check
// per tool operation that has an operationId.
export const operationIdToolName = {
  id: 'operation-id-tool-name',
  category: 'agent',
  severity: 'info',
  options: { maxLength: { default: 64, min: 1, max: 128 } },
  run(ctx, check, { maxLength }) {
    const valid = new RegExp(`^[A-Za-z_][A-Za-z0-9_-]{0,${maxLength - 1}}$`)
    for (const entry of toolOperations(ctx)) {
      const operationId = entry.op.operationId
      if (typeof operationId !== 'string' || !operationId.trim()) continue
      check(valid.test(operationId), {
        op: entry,
        dataPath: `${entry.pointer}/operationId`,
        params: { operationId, maxLength },
      })
    }
  },
}
