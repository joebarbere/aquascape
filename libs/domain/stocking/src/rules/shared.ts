/**
 * Shared helpers for the stocking rules.
 *
 * Two responsibilities:
 *   - Tunable constants — every threshold the rules consult is named here so
 *     F7.4's "setup sheet" (and any future tuning UI) can import them from
 *     one place. NO magic numbers inline in the rule files.
 *   - The `makeWarningId` helper — every warning's id is `<code>:<sorted ids
 *     joined by ','>`, identical across rule files; centralizing avoids drift.
 */

import type { CatalogRef, LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import type { Catalog, LivestockEntry as CatalogLivestockEntry } from '@aquascape/domain/catalog';
import type { StockingWarning, WarningCode } from '../types';

// ─── Bioload constants ─────────────────────────────────────────────────────

/** Multiplier applied to a species' adult body length per bioload class. */
export const BIOLOAD_CLASS_MULTIPLIER: Record<'low' | 'medium' | 'high', number> = {
  low: 0.5,
  medium: 1.0,
  high: 2.0,
};

/** Ratio at/above which we surface an `info` "near capacity" warning. */
export const BIOLOAD_RATIO_NEAR_CAPACITY = 1.0;
/** Ratio at/above which the warning escalates to `warning` "overstocked". */
export const BIOLOAD_RATIO_OVERSTOCKED = 1.5;
/** Ratio at/above which the warning escalates to `error` "severely overstocked". */
export const BIOLOAD_RATIO_SEVERELY_OVERSTOCKED = 2.5;

// ─── Fin-nipper constants ──────────────────────────────────────────────────

/**
 * Catalog ids treated as "long-finned" targets vulnerable to fin-nippers. A
 * `Set` so additions are O(1) lookups; future entries (long-finned guppy
 * strains, fancy goldfish, etc.) drop in by appending an id.
 *
 * Detection by id keeps the catalog schema lean — we don't need a per-species
 * `longFinned` flag until the list outgrows what's practical to maintain
 * here.
 */
export const LONG_FINNED_CATALOG_IDS: ReadonlySet<string> = new Set<string>([
  'livestock.fish.betta-splendens',
]);

// ─── ID helper ─────────────────────────────────────────────────────────────

/**
 * Build a warning id from its code + the implicated entry ids. Sorts the ids
 * ascending so callers don't have to pre-sort; identical membership produces
 * an identical id regardless of insertion order in the scene.
 */
export function makeWarningId(code: WarningCode, relatedEntryIds: readonly string[]): string {
  const sorted = [...relatedEntryIds].sort();
  return `${code}:${sorted.join(',')}`;
}

// ─── Catalog resolution ────────────────────────────────────────────────────

/**
 * A scene livestock entry zipped with its resolved catalog entry. Rules use
 * this shape so they don't each re-implement the "skip missing catalog refs"
 * dance.
 */
export interface ResolvedLivestock {
  entry: LivestockEntry;
  catalogEntry: CatalogLivestockEntry;
}

/**
 * Resolve every livestock entry against the catalog, dropping any whose ref
 * doesn't match a known catalog entry OR whose entry has the wrong kind
 * (defensive — the catalog index keys on `(catalog, id)` only, so a typo'd
 * ref could plausibly hit a non-livestock entry).
 *
 * Missing entries are SKIPPED silently — callers higher up (the inspector UI)
 * are responsible for surfacing them. Rules just operate on what they can.
 */
export function resolveLivestock(
  scene: Pick<Scene, 'livestock'>,
  catalog: Pick<Catalog, 'get'>,
): ResolvedLivestock[] {
  const livestock = scene.livestock;
  if (!livestock || livestock.length === 0) {
    return [];
  }
  const resolved: ResolvedLivestock[] = [];
  for (const entry of livestock) {
    const ref: CatalogRef = entry.ref;
    const catalogEntry = catalog.get({ catalog: ref.catalog, id: ref.id });
    if (catalogEntry === null) {
      continue;
    }
    if (catalogEntry.kind !== 'livestock') {
      continue;
    }
    resolved.push({ entry, catalogEntry });
  }
  return resolved;
}

/**
 * Tank gross interior volume in litres. (`width * depth * height` in mm³,
 * divided by 1_000_000 because 1 L = 1 000 cm³ = 1 000 000 mm³.) Used by the
 * bioload rule — a more sophisticated water-volume formula would subtract
 * the substrate displacement (see `@aquascape/features/export`'s
 * `computeVolumeBreakdown`), but the heuristic is calibrated against gross
 * volume so we keep this simple.
 */
export function tankGrossLitres(scene: Scene): number {
  const { width, depth, height } = scene.tank;
  return (width * depth * height) / 1_000_000;
}

/**
 * Helper for assembling a "list-of-species" English fragment for explanation
 * strings. Returns "A", "A and B", "A, B and C", etc. Caller passes the
 * list in the order they want shown.
 */
export function joinSpeciesNames(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }
  if (names.length === 1) {
    return names[0] as string;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1] as string;
  return `${head} and ${tail}`;
}

/**
 * Used by the aggregator to surface zero warnings explicitly rather than
 * undefined — keeps callers' `for…of` loops total. Exported because some
 * tests construct expected-empty cases.
 */
export const NO_WARNINGS: readonly StockingWarning[] = Object.freeze([]);
