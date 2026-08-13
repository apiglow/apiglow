// Shared by the audit test files: builds an audit context the way the shell
// will (raw document + normalized model), so a rule is exercised against the
// same shapes it sees in production.
//
// Fixtures here carry no `$ref`, so the source and the dereferenced document
// are the same object — except in the unused-component tests, which pass a
// distinct source on purpose.

import { createAuditContext } from '../src/audit/engine.js'
import { normalizeDocument } from '../src/openapi/model.js'

export function auditInput(document, { source = document, hide } = {}) {
  return { source, document, model: normalizeDocument(document, { hide }) }
}

export function auditContext(document, options = {}) {
  return createAuditContext(auditInput(document, options))
}

// Minimal valid document to graft a fixture's paths/components onto.
export function doc(overrides = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'Audit', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {},
    ...overrides,
  }
}

export const okResponse = { 200: { description: 'OK' } }
