import { SPDX_EXCEPTIONS, SPDX_LICENSES } from '../spdx.js'

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

const USER_REF = /^(DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/
const ADDITION_REF = /^(DocumentRef-[A-Za-z0-9.-]+:)?AdditionRef-[A-Za-z0-9.-]+$/
const OPERATOR = /^(and|or|with)$/i

export function isSpdxExpression(text) {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? []
  let at = 0
  const peek = () => tokens[at]
  const isOperator = (word) => typeof word === 'string' && OPERATOR.test(word)
  // SPDX: operators are all upper case or all lower case, never mixed.
  const operatorIs = (word, name) => word === name || word === name.toLowerCase()

  const license = () => {
    const token = tokens[at]
    if (!token || token === '(' || token === ')' || isOperator(token)) return false
    at += 1
    if (USER_REF.test(token)) return true
    const id = token.endsWith('+') ? token.slice(0, -1) : token
    return SPDX_LICENSES.has(id.toLowerCase())
  }
  const factor = () => {
    if (peek() === '(') {
      at += 1
      if (!expression() || peek() !== ')') return false
      at += 1
      return true
    }
    if (!license()) return false
    if (operatorIs(peek(), 'WITH')) {
      at += 1
      const exception = tokens[at]
      at += 1
      return (
        typeof exception === 'string' &&
        (SPDX_EXCEPTIONS.has(exception.toLowerCase()) || ADDITION_REF.test(exception))
      )
    }
    return true
  }
  const conjunction = () => {
    if (!factor()) return false
    while (operatorIs(peek(), 'AND')) {
      at += 1
      if (!factor()) return false
    }
    return true
  }
  const expression = () => {
    if (!conjunction()) return false
    while (operatorIs(peek(), 'OR')) {
      at += 1
      if (!conjunction()) return false
    }
    return true
  }
  return tokens.length > 0 && expression() && at === tokens.length
}
