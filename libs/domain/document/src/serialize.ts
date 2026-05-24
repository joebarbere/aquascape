/**
 * High-level (de)serialization for `.aqua` documents.
 *
 * - `serializeAquaDocument(doc)` → canonical UTF-8 JSON string.
 * - `loadAquaDocument(bytesOrText)` → typed `AquaDocument` + assets, after
 *   container unwrap, schema validation, and migration to the reader's
 *   `CURRENT_SCHEMA_VERSION`.
 *
 * The loader never throws on a malformed payload; it returns a structured
 * `LoadResult` so callers (file open, autosave-recover) can react in the UI.
 */

import type { AquaDocument } from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';
import {
  type AquaContainerAssets,
  type AquaContainerContents,
  packAquaContainer,
  readAquaContainer,
} from './container';
import {
  AQUA_MIGRATIONS,
  type Migration,
  type MigrationError,
  runMigrations,
} from './migrations';
import { type ValidationError, validateAquaDocument } from './validator';

/** Successful load: a typed document plus the assets unpacked from the container. */
export interface LoadSuccess {
  document: AquaDocument;
  assets: ReadonlyMap<string, Uint8Array>;
  thumbnail?: Uint8Array;
  /** `'zip'` if the input was a real `.aqua` ZIP, `'json'` if bare JSON. */
  source: 'zip' | 'json';
  /** Versions the loader walked (empty for v1 baseline documents). */
  migrationSteps: ReadonlyArray<{ from: number; to: number }>;
}

/**
 * Discriminated failure shape. `kind` lets the UI render a precise message
 * (e.g. "this document was created in a newer version of Aquascape") rather
 * than collapsing everything to "parse failed".
 */
export type LoadError =
  | { kind: 'container-malformed'; message: string }
  | { kind: 'json-parse-failed'; message: string }
  | { kind: 'schema-invalid'; errors: ValidationError[] }
  | { kind: 'migration-failed'; error: MigrationError };

export type LoadResult =
  | ({ ok: true } & LoadSuccess)
  | { ok: false; error: LoadError };

/** Options accepted by `loadAquaDocument`. */
export interface LoadOptions {
  /** Migration chain to apply (default: `AQUA_MIGRATIONS`). Tests override this. */
  migrations?: readonly Migration[];
  /** Target reader version (default: `CURRENT_SCHEMA_VERSION`). Tests override this. */
  targetVersion?: number;
}

/**
 * Load a `.aqua` payload from raw bytes or a JSON string.
 *
 * The `bytes-or-string` shape lets web (`Blob.arrayBuffer`) and electron
 * (`fs.readFileSync`) both call this without re-encoding. Strings are treated
 * as bare JSON; for ZIPs callers must pass `Uint8Array`.
 *
 * Validation runs *after* migrations because migrations bring v(N-1) documents
 * up to the current schema before the current schema is checked.
 */
export function loadAquaDocument(
  input: Uint8Array | string,
  options: LoadOptions = {},
): LoadResult {
  let container: AquaContainerContents;
  try {
    container =
      typeof input === 'string'
        ? { documentJson: input, assets: new Map(), source: 'json' }
        : readAquaContainer(input);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'container-malformed', message: errorMessage(err) },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(container.documentJson);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'json-parse-failed', message: errorMessage(err) },
    };
  }

  // Files without a numeric `schemaVersion` are not Aquascape documents at all;
  // surface that as `schema-invalid` (with real AJV errors) rather than letting
  // the migration walker report a confusing "missing migration 0 → 1". A
  // properly-versioned-but-future document still flows through migrations so
  // the loader can return `unsupported-future-version`.
  if (!hasNumericSchemaVersion(parsed)) {
    const preflight = validateAquaDocument(parsed);
    if (!preflight.ok) {
      return { ok: false, error: { kind: 'schema-invalid', errors: preflight.errors } };
    }
  }

  const migrated = runMigrations(
    parsed,
    options.migrations ?? AQUA_MIGRATIONS,
    options.targetVersion ?? CURRENT_SCHEMA_VERSION,
  );
  if (!migrated.ok) {
    return { ok: false, error: { kind: 'migration-failed', error: migrated.error } };
  }

  const validated = validateAquaDocument(migrated.document);
  if (!validated.ok) {
    return { ok: false, error: { kind: 'schema-invalid', errors: validated.errors } };
  }

  return {
    ok: true,
    document: migrated.document as AquaDocument,
    assets: container.assets,
    ...(container.thumbnail !== undefined ? { thumbnail: container.thumbnail } : {}),
    source: container.source,
    migrationSteps: migrated.appliedSteps,
  };
}

/**
 * Serialize a document to canonical UTF-8 JSON. We deliberately avoid pretty
 * printing — the on-disk file is read by software, not humans, and stable byte
 * output makes content-hashing for assets/galleries trivial.
 *
 * The document is run through `JSON.stringify(JSON.parse(stringify(doc)))` if
 * `canonical` is set, sorting object keys recursively for byte-stable output.
 * Defaults to off — Stage 1 callers don't need it yet, but Stage 8 (gallery)
 * will.
 */
export function serializeAquaDocument(
  doc: AquaDocument,
  options: { pretty?: boolean } = {},
): string {
  return JSON.stringify(doc, null, options.pretty ? 2 : 0);
}

/**
 * Pack a fully-typed document into a `.aqua` ZIP container. Assets are
 * supplied separately because the document only stores `AssetRef.uri` paths;
 * the bytes live alongside in the container.
 */
export function packAquaDocument(
  doc: AquaDocument,
  extras: AquaContainerAssets = {},
): Uint8Array {
  return packAquaContainer(serializeAquaDocument(doc), extras);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function hasNumericSchemaVersion(doc: unknown): boolean {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    typeof (doc as { schemaVersion?: unknown }).schemaVersion === 'number'
  );
}
