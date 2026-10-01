import { isSpdxExpression } from '../spdx.js'

// A 3.1+ `info.license.identifier` that is not an SPDX license expression (OAS
// 3.1, License Object: "An SPDX license expression for the API"). The field
// exists for machines — licence scanners, SBOM generators, registries match it
// against the SPDX list — and `Apache 2`, `MIT License` or `Proprietary` match
// nothing there: the API reads as unlicensed to them, while this documentation
// shows the text as written.
//
// The expression grammar of SPDX 2.3 Annex D: identifiers of the SPDX License
// List (src/audit/spdx.js, matched case-insensitively), an optional `+`,
// `LicenseRef-…` / `DocumentRef-…:LicenseRef-…` for a licence of your own,
// `WITH` an exception, `AND` / `OR`, parentheses. In 3.0 the field is
// `version-construct`'s. One check when the identifier is not one.
export const licenseIdentifierSpdx = {
  id: 'license-identifier-spdx',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const identifier = ctx.source?.info?.license?.identifier
    if (ctx.version.minor < 1 || typeof identifier !== 'string') return
    if (isSpdxExpression(identifier)) return
    check(false, {
      location: 'info.license.identifier',
      dataPath: '/info/license/identifier',
      params: { identifier },
    })
  },
}
