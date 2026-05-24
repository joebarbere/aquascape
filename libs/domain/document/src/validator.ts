/**
 * AJV-backed validator for `.aqua` documents (schema v1).
 *
 * The schema lives next door in `./schema/aqua-document.schema.json`; we import
 * it as JSON (resolveJsonModule) so the compiled output is self-contained and
 * runs in node, the browser, and the Electron renderer without filesystem
 * access. The validator is compiled once at module load.
 */

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import aquaDocumentSchema from './schema/aqua-document.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const compiledValidate = ajv.compile(aquaDocumentSchema);

/** A single validation error, pre-formatted for human display. */
export interface ValidationError {
  /** JSON pointer-style path into the document, e.g. `/tank/width`. */
  path: string;
  /** Human-readable message. */
  message: string;
  /** Raw AJV error params, e.g. `{ allowedValues: [...] }`. */
  params: Record<string, unknown>;
}

/** Result of a validate call — discriminated on `ok`. */
export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a candidate `.aqua` document against the v1 JSON Schema.
 *
 * The input is `unknown` because callers typically have just deserialized JSON.
 * On `ok: true`, the input is structurally a valid `AquaDocument` for the
 * declared `schemaVersion`. Whether the loader supports that version is a
 * separate concern handled by the migration chain.
 */
export function validateAquaDocument(input: unknown): ValidationResult {
  const valid = compiledValidate(input);
  if (valid) return { ok: true };
  return { ok: false, errors: (compiledValidate.errors ?? []).map(formatError) };
}

function formatError(err: ErrorObject): ValidationError {
  return {
    path: err.instancePath || '<root>',
    message: err.message ?? 'invalid',
    params: { ...err.params },
  };
}

/** The compiled JSON Schema, exposed for tooling that needs the raw shape. */
export const AQUA_DOCUMENT_JSON_SCHEMA = aquaDocumentSchema as unknown as Record<
  string,
  unknown
>;
