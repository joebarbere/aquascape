/**
 * Validator for catalog entries.
 *
 * The schema lives next door in `./schema/catalog-entry.schema.json`. The
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

import catalogEntrySchema from './schema/catalog-entry.schema.json';
import compiledValidate from './validator.generated.cjs';

/** A single validation error, pre-formatted for human display. */
export interface ValidationError {
  /** JSON pointer-style path into the entry, e.g. `/color`. */
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
 * Validate a single candidate catalog entry against the JSON Schema.
 *
 * Input is `unknown` because callers typically have just deserialized JSON
 * from disk or a manifest bundle. The `oneOf` in the schema picks the
 * matching branch by `kind`; an entry with an unknown `kind` fails because
 * no branch matches.
 */
export function validateCatalogEntry(input: unknown): ValidationResult {
  const valid = compiledValidate(input);
  if (valid) return { ok: true };
  return { ok: false, errors: (compiledValidate.errors ?? []).map(formatError) };
}

/**
 * Reshape an AJV error into the lib's public `ValidationError`. Exported so
 * the defensive fallbacks (`'<root>'` for empty instancePath, `'invalid'`
 * for missing message) are directly testable without manufacturing custom
 * AJV behaviors.
 */
export function formatError(err: {
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
export const CATALOG_ENTRY_JSON_SCHEMA = catalogEntrySchema as unknown as Record<
  string,
  unknown
>;
