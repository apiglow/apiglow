import { listOf } from '../../openapi/model.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { hasText, isSubstantive } from '../text.js'

// Several servers and nothing to tell them apart but their URLs. The reader
// picks one to seed an environment from, and this documentation names that
// environment after the server's `name` (3.2), else its `description`, else
// its URL (src/components/env-manager.js): `https://eu1.api.acme.io/v2` and
// `https://api.acme.io/v2` make two environments the reader has to decode
// before every call. A client generated from the document lists them the same
// way. A lone server has nothing to be told apart from, so the rule speaks
// only when the document lists two or more.
//
// One check per top-level server then: a substantive `description`
// (`isSubstantive` — "TODO" says nothing) or a non-blank `name` passes. The
// `name` is read whatever the declared version, as the environment manager
// does; that it is a 3.2 field is `unknown-field`'s. Path Item and Operation
// servers are picked by the operation, not by the reader.
export const serverDescribed = {
  id: 'server-described',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const servers = listOf(ctx.document.servers)
      .map((server, index) => [server, index])
      .filter(([server]) => server && typeof server === 'object' && typeof server.url === 'string')
    if (servers.length < 2) return
    for (const [server, index] of servers) {
      const dataPath = pointer('servers', index)
      check(isSubstantive(server.description) || hasText(server.name), {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { url: server.url },
      })
    }
  },
}
