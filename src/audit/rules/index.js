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
import { fieldValueKind } from './field-value-kind.js'
import { fieldWithoutValue } from './field-without-value.js'
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
import { requiredFieldMissing } from './required-field-missing.js'
import { requiredPropertyDeclared } from './required-property-declared.js'
import { requiredWithDefault } from './required-with-default.js'
import { responseExample } from './response-example.js'
import { responseSubstance } from './response-substance.js'
import { schemaDialect } from './schema-dialect.js'
import { schemaExpandWalls } from './schema-expand-walls.js'
import { securitySchemeDeclared } from './security-scheme-declared.js'
import { securitySchemeDescribed } from './security-scheme-described.js'
import { serversDeclared } from './servers-declared.js'
import { unknownField } from './unknown-field.js'
import { unusedComponent } from './unused-component.js'
import { versionConstruct } from './version-construct.js'
import { versionLegacy } from './version-legacy.js'
import { enumValid } from './enum-valid.js'
import { nullableEnumNull } from './nullable-enum-null.js'
import { arrayItems } from './array-items.js'
import { constraintTypeMismatch } from './constraint-type-mismatch.js'
import { rangeContradiction } from './range-contradiction.js'
import { patternValid } from './pattern-valid.js'
import { formatValid } from './format-valid.js'
import { schemaKeywordTypo } from './schema-keyword-typo.js'
import { compositionSanity } from './composition-sanity.js'
import { readonlyWriteonly } from './readonly-writeonly.js'
import { recursionUnsatisfiable } from './recursion-unsatisfiable.js'
import { mergePatchRequired } from './merge-patch-required.js'
import { multipartSchemaObject } from './multipart-schema-object.js'
import { binaryPlacement } from './binary-placement.js'
import { exampleHasRef } from './example-has-ref.js'
import { problemStatusMismatch } from './problem-status-mismatch.js'
import { parameterSchemaOrContent } from './parameter-schema-or-content.js'
import { exclusiveFields } from './exclusive-fields.js'
import { headerObjectFields } from './header-object-fields.js'
import { componentKeyFormat } from './component-key-format.js'
import { statusCodeValid } from './status-code-valid.js'
import { mediaTypeKeySyntax } from './media-type-key-syntax.js'
import { extensionReservedPrefix } from './extension-reserved-prefix.js'
import { uriForm } from './uri-form.js'
import { licenseIdentifierSpdx } from './license-identifier-spdx.js'
import { selfUri } from './self-uri.js'
import { tagUnique } from './tag-unique.js'
import { tagParent } from './tag-parent.js'
import { pathSyntax } from './path-syntax.js'
import { pathsIdentical } from './paths-identical.js'
import { pathsAmbiguous } from './paths-ambiguous.js'
import { parametersUnique } from './parameters-unique.js'
import { headerParameterIgnored } from './header-parameter-ignored.js'
import { headerNameToken } from './header-name-token.js'
import { parameterStyleValid } from './parameter-style-valid.js'
import { querystringParameter } from './querystring-parameter.js'
import { additionalOperationMethod } from './additional-operation-method.js'
import { serverVariables } from './server-variables.js'
import { refSiblings } from './ref-siblings.js'
import { refTargetKind } from './ref-target-kind.js'
import { refResolves } from './ref-resolves.js'
import { runtimeExpressionSyntax } from './runtime-expression-syntax.js'
import { encodingValid } from './encoding-valid.js'
import { sequentialMedia } from './sequential-media.js'
import { responsesSuccess } from './responses-success.js'
import { discriminatorProperty } from './discriminator-property.js'
import { securityScopes } from './security-scopes.js'
import { operationIdToolName } from './operation-id-tool-name.js'
import { summaryLength } from './summary-length.js'
import { operationsIndistinct } from './operations-indistinct.js'
import { toolSurfaceSize } from './tool-surface-size.js'
import { bridgeDegradation } from './bridge-degradation.js'
import { untypedInput } from './untyped-input.js'
import { freeFormInput } from './free-form-input.js'
import { unionAmbiguous } from './union-ambiguous.js'
import { inputRootShape } from './input-root-shape.js'
import { recursiveInput } from './recursive-input.js'
import { inputComplexity } from './input-complexity.js'
import { enumValuesUndescribed } from './enum-values-undescribed.js'
import { parameterNameCollision } from './parameter-name-collision.js'
import { requestExample } from './request-example.js'
import { errorMachineReadable } from './error-machine-readable.js'
import { serverHttps } from './server-https.js'
import { oauthUrlTls } from './oauth-url-tls.js'
import { authSchemeWeak } from './auth-scheme-weak.js'
import { apikeyInQuery } from './apikey-in-query.js'
import { httpSchemeRegistered } from './http-scheme-registered.js'
import { operationUnsecured } from './operation-unsecured.js'
import { securedOpErrors } from './secured-op-errors.js'
import { oauthLegacyFlows } from './oauth-legacy-flows.js'
import { rateLimitRetryAfter } from './rate-limit-retry-after.js'
import { sensitiveFieldExposure } from './sensitive-field-exposure.js'
import { unboundedInput } from './unbounded-input.js'
import { requestBodyMethod } from './request-body-method.js'
import { bodylessStatus } from './bodyless-status.js'
import { httpDateHeaders } from './http-date-headers.js'
import { queryMethodBody } from './query-method-body.js'
import { problemDetailsShape } from './problem-details-shape.js'
import { responseContentSchema } from './response-content-schema.js'
import { examplePlaceholder } from './example-placeholder.js'
import { placeholderText } from './placeholder-text.js'
import { tagDescribed } from './tag-described.js'
import { redirectLocation } from './redirect-location.js'
import { methodNotAllowedAllow } from './method-not-allowed-allow.js'
import { partialContentRange } from './partial-content-range.js'
import { deprecationHeaderFormat } from './deprecation-header-format.js'
import { sunsetBeforeDeprecation } from './sunset-before-deprecation.js'
import { deprecatedButRequired } from './deprecated-but-required.js'
import { operationIdCollision } from './operation-id-collision.js'
import { propertyNameCollision } from './property-name-collision.js'
import { schemaNameCollision } from './schema-name-collision.js'
import { operationSummaryPresent } from './operation-summary-present.js'
import { operationSummaryStyle } from './operation-summary-style.js'
import { tagDeclared } from './tag-declared.js'
import { tagUnused } from './tag-unused.js'
import { markdownUnsafe } from './markdown-unsafe.js'
import { markdownLinks } from './markdown-links.js'
import { documentHasOperations } from './document-has-operations.js'
import { exampleSummary } from './example-summary.js'
import { exampleExternalOnly } from './example-external-only.js'
import { typeMissing } from './type-missing.js'
import { forbiddenInBrowser } from './forbidden-in-browser.js'
import { serverPlaceholder } from './server-placeholder.js'
import { serverDescribed } from './server-described.js'

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
  fieldWithoutValue,
  versionLegacy,
  versionConstruct,
  schemaDialect,
  conversionApproximation,
  // §4.1 structure: the objects' own fields (openapi-objects.js)
  unknownField,
  requiredFieldMissing,
  fieldValueKind,
  parameterSchemaOrContent,
  exclusiveFields,
  headerObjectFields,
  componentKeyFormat,
  statusCodeValid,
  mediaTypeKeySyntax,
  extensionReservedPrefix,
  uriForm,
  licenseIdentifierSpdx,
  selfUri,
  tagUnique,
  tagParent,
  pathSyntax,
  pathsIdentical,
  pathsAmbiguous,
  parametersUnique,
  headerParameterIgnored,
  headerNameToken,
  parameterStyleValid,
  querystringParameter,
  additionalOperationMethod,
  serverVariables,
  refSiblings,
  refTargetKind,
  refResolves,
  runtimeExpressionSyntax,
  encodingValid,
  sequentialMedia,
  responsesSuccess,
  discriminatorProperty,
  securityScopes,
  // §4.1 schemas: values and keywords
  enumValid,
  nullableEnumNull,
  arrayItems,
  constraintTypeMismatch,
  rangeContradiction,
  patternValid,
  formatValid,
  schemaKeywordTypo,
  // §4.1 schemas: payloads and composition
  compositionSanity,
  readonlyWriteonly,
  recursionUnsatisfiable,
  mergePatchRequired,
  multipartSchemaObject,
  binaryPlacement,
  exampleHasRef,
  problemStatusMismatch,
  // §4.1 HTTP semantics
  requestBodyMethod,
  bodylessStatus,
  httpDateHeaders,
  queryMethodBody,
  problemDetailsShape,
  // §4.8 Security: what the document lets through
  serverHttps,
  oauthUrlTls,
  authSchemeWeak,
  apikeyInQuery,
  httpSchemeRegistered,
  operationUnsecured,
  securedOpErrors,
  oauthLegacyFlows,
  rateLimitRetryAfter,
  sensitiveFieldExposure,
  unboundedInput,
  // §4.2 Documentation completeness
  operationDescribed,
  parameterDescribed,
  requestBodyDescribed,
  propertyDescribed,
  errorResponsesDocumented,
  responseExample,
  infoDescribed,
  infoMetadata,
  responseContentSchema,
  examplePlaceholder,
  placeholderText,
  tagDescribed,
  redirectLocation,
  methodNotAllowedAllow,
  partialContentRange,
  // §4.3 Deprecation hygiene
  deprecatedInventory,
  deprecationReplacement,
  deprecationHeaderFormat,
  sunsetBeforeDeprecation,
  deprecatedButRequired,
  // §4.4 Consistency
  parameterNaming,
  propertyNaming,
  pathStyle,
  duplicateInlineSchema,
  operationIdCollision,
  propertyNameCollision,
  schemaNameCollision,
  // §4.5 Docs readiness
  operationIdPresent,
  operationTagged,
  serversDeclared,
  securitySchemeDescribed,
  oauthFlowUrls,
  operationExamples,
  schemaExpandWalls,
  operationSummaryPresent,
  operationSummaryStyle,
  tagDeclared,
  tagUnused,
  markdownUnsafe,
  markdownLinks,
  documentHasOperations,
  exampleSummary,
  exampleExternalOnly,
  typeMissing,
  forbiddenInBrowser,
  serverPlaceholder,
  serverDescribed,
  // §4.7 Agent readiness: what a tool built from the document gets
  operationIdToolName,
  summaryLength,
  operationsIndistinct,
  toolSurfaceSize,
  bridgeDegradation,
  untypedInput,
  freeFormInput,
  unionAmbiguous,
  inputRootShape,
  recursiveInput,
  inputComplexity,
  enumValuesUndescribed,
  parameterNameCollision,
  requestExample,
  errorMachineReadable,
]
