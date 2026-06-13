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

import type { Catalog, CatalogEntry, CatalogKind, DecorEntry, HardscapeEntry } from './types';
import { type ValidationError, validateCatalogEntry } from './validator';

/**
 * Default hardscape `coverScore` derived from `category` when the manifest
 * omits the field. Stage 11 F11.3 FearSystem uses this to find refuges.
 *
 * - wood  → 0.6   driftwood + branches read as good cover
 * - rock  → 0.4   caves + crevices
 * - other → 0     decor like statues is not cover
 *
 * JSON Schema's `default` is metadata-only, so the fill happens here in the
 * loader instead. The original manifest object is left untouched.
 */
function defaultCoverScoreForCategory(category: HardscapeEntry['category']): number {
  switch (category) {
    case 'wood':
      return 0.6;
    case 'rock':
      return 0.4;
    default:
      return 0;
  }
}

/**
 * Default decor `coverScore` derived from `category` when the manifest omits
 * the field — mirrors the hardscape defaulting above. Decorations rate higher
 * than flat hardscape `other` decor (0) because the classic ornaments are
 * authored with swim-through cavities (hollow hulls, arched doors, eye
 * sockets) that read as real refuges to the F11.3 FearSystem.
 *
 * - structure → 0.6   castle keeps etc. with swim-through openings
 * - wreck     → 0.5   hulls, helmets, chests with sheltered voids
 * - bones     → 0.4   skull cavities
 * - ruin      → 0.3   columns + amphorae offer partial shelter
 */
function defaultCoverScoreForDecorCategory(category: DecorEntry['category']): number {
  switch (category) {
    case 'structure':
      return 0.6;
    case 'wreck':
      return 0.5;
    case 'bones':
      return 0.4;
    default:
      return 0.3;
  }
}

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
    const validated = candidate as CatalogEntry;
    const key = `${validated.catalog}|${validated.id}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      prior.push(index);
      // Don't add to validEntries — first-seen wins for the lookup.
      return;
    }
    seen.set(key, [index]);
    validEntries.push(populateDefaults(validated));
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

/**
 * Apply loader-side defaults that the schema can't express. Today this fills
 * hardscape + decor `coverScore` from their respective `category` tables;
 * other kinds pass through untouched. The original manifest object is never
 * mutated — when a default is applied we return a shallow clone with the
 * populated field, so the `CoreCatalog` consumers see a fully-populated
 * entry while the `import`-ed JSON object stays as-is.
 */
function populateDefaults(entry: CatalogEntry): CatalogEntry {
  if (entry.kind === 'hardscape' && entry.coverScore === undefined) {
    return { ...entry, coverScore: defaultCoverScoreForCategory(entry.category) };
  }
  if (entry.kind === 'decor' && entry.coverScore === undefined) {
    return { ...entry, coverScore: defaultCoverScoreForDecorCategory(entry.category) };
  }
  return entry;
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
