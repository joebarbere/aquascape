/**
 * Validator for `.aqua` documents (schema v1).
 *
 * The schema lives next door in `./schema/aqua-document.schema.json`. The
 * AJV-compiled validator function is precompiled at build time via
 * `tools/precompile-validators.mjs` into `./validator.generated.cjs` —
 * shipped as a committed file so the renderer never has to run AJV's
 * `new Function(…)` codegen path. That keeps the renderer's CSP free of
 * `'unsafe-eval'` and lets the Electron desktop ship the strict policy in
 * production.
 *
 * Editing the schema → re-run `pnpm precompile:validators` to regenerate
 * the `.cjs` file. CI re-runs the script and `git diff --exit-code`s to
 * catch schema edits without regen.
 */

import aquaDocumentSchema from './schema/aqua-document.schema.json';
import compiledValidate from './validator.generated.cjs';

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

function formatError(err: {
  instancePath: string;
  message?: string;
  params: Record<string, unknown>;
}): ValidationError {
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
