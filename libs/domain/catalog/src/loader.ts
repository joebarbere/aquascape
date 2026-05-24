/**
 * Catalog loader.
 *
 * Takes an array of candidate entries (typically `JSON.parse` output of
 * manifest files or the bundled `coreCatalog` constant) and returns a
 * validated, indexed `Catalog`. Invalid entries are **never silently
 * dropped** — they're surfaced as `errors[]` so the UI / build script can
 * report them.
 *
 * Duplicate `(catalog, id)` pairs are reported as `warnings[]`; the first
 * occurrence wins. This matches the "don't lose what you don't understand"
 * spirit of the document format: a community catalog that shadows a core
 * id is a warning, not a crash.
 */

import type { Catalog, CatalogEntry, CatalogKind } from './types';
import { type ValidationError, validateCatalogEntry } from './validator';

/** A single validation failure for a specific entry slot. */
export interface CatalogLoadError {
  /** Position of the offending entry in the input array. */
  index: number;
  /** AJV error list. */
  errors: ValidationError[];
}

/** A non-fatal load issue, e.g. a duplicate `(catalog, id)` pair. */
export interface CatalogLoadWarning {
  kind: 'duplicate-id';
  catalog: string;
  id: string;
  /** Indices of the duplicate slots; the first one was kept. */
  indices: number[];
}

export interface CatalogLoadResult {
  /** The validated, indexed catalog. */
  catalog: Catalog;
  /** Per-slot validation failures. Entries with errors are excluded from `catalog`. */
  errors: CatalogLoadError[];
  /** Non-fatal issues. */
  warnings: CatalogLoadWarning[];
}

/**
 * Build a `Catalog` from a list of candidate entries. Order is preserved.
 *
 * The function NEVER throws — broken inputs produce structured errors. The
 * `catalog` is always returned (possibly empty) so callers can render the
 * UI in a known-good state even when some entries fail.
 */
export function loadCatalog(input: readonly unknown[]): CatalogLoadResult {
  const validEntries: CatalogEntry[] = [];
  const errors: CatalogLoadError[] = [];
  const seen = new Map<string, number[]>(); // (catalog|id) -> indices

  input.forEach((candidate, index) => {
    const validation = validateCatalogEntry(candidate);
    if (!validation.ok) {
      errors.push({ index, errors: validation.errors });
      return;
    }
    // Safe cast: validateCatalogEntry's success guarantees the shape.
    const entry = candidate as CatalogEntry;
    const key = `${entry.catalog}|${entry.id}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      prior.push(index);
      // Don't add to validEntries — first-seen wins for the lookup.
      return;
    }
    seen.set(key, [index]);
    validEntries.push(entry);
  });

  const warnings: CatalogLoadWarning[] = [];
  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const [catalog, id] = key.split('|') as [string, string];
      warnings.push({ kind: 'duplicate-id', catalog, id, indices });
    }
  }

  return { catalog: buildCatalog(validEntries), errors, warnings };
}

function buildCatalog(entries: readonly CatalogEntry[]): Catalog {
  const lookup = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    lookup.set(`${entry.catalog}|${entry.id}`, entry);
  }
  return {
    entries,
    get({ catalog, id }) {
      return lookup.get(`${catalog}|${id}`) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[] {
      return entries.filter((e): e is Extract<CatalogEntry, { kind: K }> => e.kind === kind);
    },
  };
}

/** A catalog with no entries. Useful for tests + placeholder UI states. */
export function emptyCatalog(): Catalog {
  return buildCatalog([]);
}
