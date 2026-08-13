// The shipped ruleset. Adding a rule = adding its file and its entry here;
// the engine groups by `category` and needs nothing else.
//
// The version-awareness rules (docs/audit.md §4.6) have no category of their
// own: a construct that contradicts the declared version is a correctness
// finding, and they sit with the other §4.1 rules.

import { conversionApproximation } from './conversion-approximation.js'
import { defaultAllowed } from './default-allowed.js'
import { deprecatedInventory } from './deprecated-inventory.js'
import { deprecationReplacement } from './deprecation-replacement.js'
import { discriminatorMapping } from './discriminator-mapping.js'
import { duplicateInlineSchema } from './duplicate-inline-schema.js'
import { duplicateOperationId } from './duplicate-operation-id.js'
import { errorResponsesDocumented } from './error-responses-documented.js'
import { exampleTypeMismatch } from './example-type-mismatch.js'
import { infoDescribed } from './info-described.js'
import { infoMetadata } from './info-metadata.js'
import { linkTarget } from './link-target.js'
import { oauthFlowUrls } from './oauth-flow-urls.js'
import { operationDescribed } from './operation-described.js'
import { operationExamples } from './operation-examples.js'
import { operationIdPresent } from './operation-id-present.js'
import { operationTagged } from './operation-tagged.js'
import { parameterDescribed } from './parameter-described.js'
import { parameterNaming } from './parameter-naming.js'
import { pathParamDeclared } from './path-param-declared.js'
import { pathParamInTemplate } from './path-param-in-template.js'
import { pathParamRequired } from './path-param-required.js'
import { pathStyle } from './path-style.js'
import { propertyDescribed } from './property-described.js'
import { propertyNaming } from './property-naming.js'
import { requestBodyDescribed } from './request-body-described.js'
import { requiredPropertyDeclared } from './required-property-declared.js'
import { requiredWithDefault } from './required-with-default.js'
import { responseExample } from './response-example.js'
import { responseSubstance } from './response-substance.js'
import { schemaDialect } from './schema-dialect.js'
import { schemaExpandWalls } from './schema-expand-walls.js'
import { securitySchemeDeclared } from './security-scheme-declared.js'
import { securitySchemeDescribed } from './security-scheme-described.js'
import { serversDeclared } from './servers-declared.js'
import { unusedComponent } from './unused-component.js'
import { versionConstruct } from './version-construct.js'
import { versionLegacy } from './version-legacy.js'

export const RULES = [
  // §4.1 Correctness, §4.6 version awareness
  duplicateOperationId,
  pathParamDeclared,
  pathParamInTemplate,
  pathParamRequired,
  requiredPropertyDeclared,
  requiredWithDefault,
  exampleTypeMismatch,
  defaultAllowed,
  unusedComponent,
  securitySchemeDeclared,
  responseSubstance,
  discriminatorMapping,
  linkTarget,
  versionLegacy,
  versionConstruct,
  schemaDialect,
  conversionApproximation,
  // §4.2 Documentation completeness
  operationDescribed,
  parameterDescribed,
  requestBodyDescribed,
  propertyDescribed,
  errorResponsesDocumented,
  responseExample,
  infoDescribed,
  infoMetadata,
  // §4.3 Deprecation hygiene
  deprecatedInventory,
  deprecationReplacement,
  // §4.4 Consistency
  parameterNaming,
  propertyNaming,
  pathStyle,
  duplicateInlineSchema,
  // §4.5 Docs readiness
  operationIdPresent,
  operationTagged,
  serversDeclared,
  securitySchemeDescribed,
  oauthFlowUrls,
  operationExamples,
  schemaExpandWalls,
]
