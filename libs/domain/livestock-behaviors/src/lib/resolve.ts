// Catalog-row → ResolvedBehavior resolution for F11.2 + F11.3 + F11.4.
//
// Pure + deterministic. Same input → byte-stable output. No randomness, no
// closures over module state, no mutation of the shared preset constants.

import type {
  AnimationParams,
  CuriosityParams,
  DepthBand,
  DepthParams,
  FearParams,
  FeedingParams,
  NippingParams,
  ResolvedBehavior,
  SchoolingParams,
  TerritoryParams,
} from './params';
import { BOTTOM_PRESET, MID_PRESET, TOP_PRESET } from './presets';

/**
 * Catalog row shape accepted by `resolveBehavior`. Structural (no import from
 * `@aquascape/domain/catalog`) so the dependency edge runs catalog → behaviors,
 * not the reverse. F11.1's structural cast for animation params already relied
 * on this shape, so it must stay backward-compatible.
 *
 * F11.3 extension: `territory` / `nipping` accept `Partial<X> | null`. An
 * explicit `null` opts OUT of any heuristic match (e.g. a peaceful dwarf
 * cichlid that doesn't defend a cave despite matching the cichlid id hint).
 * `undefined` (key omitted) keeps the heuristic. A `Partial<X>` object
 * overrides individual fields on top of the heuristic-derived defaults.
 */
export interface BehaviorResolutionInput {
  group?: 'fish' | 'shrimp' | 'snail';
  temperament?: 'peaceful' | 'semi-aggressive' | 'aggressive';
  schoolingMin?: number;
  tags?: ReadonlyArray<string>;
  id?: string;
  behavior?: {
    schooling?: Partial<SchoolingParams>;
    depth?: Partial<DepthParams>;
    animation?: Partial<AnimationParams>;
    territory?: Partial<TerritoryParams> | null;
    nipping?: Partial<NippingParams> | null;
    fear?: Partial<FearParams>;
    feeding?: Partial<FeedingParams>;
    curiosity?: Partial<CuriosityParams>;
  };
}

const TOP_ID_HINTS = ['hatchet', 'gourami', 'pencilfish'] as const;
const BOTTOM_ID_HINTS = ['cory', 'kuhli', 'pleco', 'oto', 'loach'] as const;

// F11.3 — species-specific behaviour heuristics. Substring matches (lower-case
// compared) on the catalog id. The lists are deliberately broad: id authors
// use a mix of common names + scientific names, so we match the most stable
// fragment ('cichlid', 'ram', 'angelfish'...).
const TERRITORY_ID_HINTS = [
  'ram',
  'apisto',
  'angelfish',
  'discus',
  'cichlid',
  'betta',
] as const;
const NIPPING_ID_HINTS = [
  'tigerbarb',
  'tiger-barb',
  'tiger_barb',
  'rosybarb',
] as const;

/** Default territory params assigned when an id matches a territorial hint. */
const DEFAULT_TERRITORY: TerritoryParams = {
  coreRadius: 80,
  displayRadius: 150,
  aggression: 100,
  fatigueRate: 0.08,
};

/** Default nipping params assigned when an id matches a nipper hint. */
const DEFAULT_NIPPING: NippingParams = {
  groupThreshold: 8,
  finFraction: 0.4,
  rate: 0.5,
};

// F11.4 — feeding-category heuristics. Substring matches (lower-case compared)
// on the catalog id. Algae-grazers + plant-eaters are species-specific
// upgrades on top of the depth-band preset; detritivore is decided earlier by
// group (shrimp/snail).
const ALGAE_GRAZER_ID_HINTS = ['oto', 'pleco', 'siamese-algae'] as const;
const PLANT_EATER_ID_HINTS = [
  'silverdollar',
  'silver-dollar',
  'severum',
] as const;

// F11.4 — curiosity-override heuristics. Most species use the band preset; a
// few well-known temperament cases get explicit overrides (invertebrates +
// kuhli loaches).
const CURIOSITY_INVERT_HINTS = ['shrimp', 'snail'] as const;
const CURIOSITY_TIMID_HINTS = ['kuhli'] as const;

/**
 * Maps a catalog row to its depth band. Priority (first match wins):
 *   1. Explicit `depth:top|mid|bottom` tag.
 *   2. Group `shrimp` or `snail` → bottom.
 *   3. ID substring match (case-insensitive).
 *   4. Group `fish` with no other signal → mid.
 *   5. No group + no other signal → mid.
 */
export function depthBandForSpecies(entry: BehaviorResolutionInput): DepthBand {
  // 1. Explicit tag wins.
  if (entry.tags) {
    for (const tag of entry.tags) {
      if (tag === 'depth:top') return 'top';
      if (tag === 'depth:mid') return 'mid';
      if (tag === 'depth:bottom') return 'bottom';
    }
  }

  // 2. Invertebrate shortcut.
  if (entry.group === 'shrimp' || entry.group === 'snail') {
    return 'bottom';
  }

  // 3. ID substring heuristic (case-insensitive).
  if (entry.id) {
    const idLower = entry.id.toLowerCase();
    for (const hint of TOP_ID_HINTS) {
      if (idLower.includes(hint)) return 'top';
    }
    for (const hint of BOTTOM_ID_HINTS) {
      if (idLower.includes(hint)) return 'bottom';
    }
  }

  // 4 + 5. Fish or unknown → safe mid default.
  return 'mid';
}

function presetFor(band: DepthBand): ResolvedBehavior {
  switch (band) {
    case 'top':
      return TOP_PRESET;
    case 'bottom':
      return BOTTOM_PRESET;
    case 'mid':
      return MID_PRESET;
  }
}

/**
 * Heuristic: does this species defend a territory by default? Returns the
 * default `TerritoryParams` if the catalog id matches a known territorial
 * group (cichlids, bettas), else null. Invertebrates never defend a
 * territory under this heuristic.
 */
function inferTerritoryFromSpecies(
  entry: BehaviorResolutionInput,
): TerritoryParams | null {
  if (entry.group === 'shrimp' || entry.group === 'snail') return null;
  if (!entry.id) return null;
  const idLower = entry.id.toLowerCase();
  for (const hint of TERRITORY_ID_HINTS) {
    if (idLower.includes(hint)) return { ...DEFAULT_TERRITORY };
  }
  return null;
}

/**
 * Heuristic: is this species a fin-nipper by default? Returns the default
 * `NippingParams` if the catalog id matches a known nipper (tiger barb,
 * rosy barb), else null.
 */
function inferNippingFromSpecies(
  entry: BehaviorResolutionInput,
): NippingParams | null {
  if (entry.group === 'shrimp' || entry.group === 'snail') return null;
  if (!entry.id) return null;
  const idLower = entry.id.toLowerCase();
  for (const hint of NIPPING_ID_HINTS) {
    if (idLower.includes(hint)) return { ...DEFAULT_NIPPING };
  }
  return null;
}

/**
 * F11.4 — return a `Partial<FeedingParams>` override block reflecting
 * species-specific feeding heuristics. The merged result spreads over the
 * preset's feeding defaults. Priority order (first match wins):
 *   1. Group `shrimp` or `snail` → `category: 'detritivore'`.
 *   2. ID substring (case-insensitive) matches algae-grazer hints → `'algae-grazer'`.
 *   3. ID substring matches plant-eater hints → `'plant-eater'`.
 *   4. Otherwise → empty object (keep the preset category).
 */
function inferFeedingFromSpecies(
  entry: BehaviorResolutionInput,
): Partial<FeedingParams> {
  if (entry.group === 'shrimp' || entry.group === 'snail') {
    return { category: 'detritivore' };
  }
  if (!entry.id) return {};
  const idLower = entry.id.toLowerCase();
  for (const hint of ALGAE_GRAZER_ID_HINTS) {
    if (idLower.includes(hint)) return { category: 'algae-grazer' };
  }
  for (const hint of PLANT_EATER_ID_HINTS) {
    if (idLower.includes(hint)) return { category: 'plant-eater' };
  }
  return {};
}

/**
 * F11.4 — return a `Partial<CuriosityParams>` override block reflecting
 * species-specific temperament. Invertebrates wander but rarely investigate
 * the glass; kuhli loaches are famously timid. Otherwise the band preset
 * stands.
 */
function inferCuriosityFromSpecies(
  entry: BehaviorResolutionInput,
): Partial<CuriosityParams> {
  if (entry.group === 'shrimp' || entry.group === 'snail') {
    return { boldness: 0.1, ratePerSec: 0.01, dwellSec: 2 };
  }
  if (entry.id) {
    const idLower = entry.id.toLowerCase();
    for (const hint of CURIOSITY_INVERT_HINTS) {
      if (idLower.includes(hint)) {
        return { boldness: 0.1, ratePerSec: 0.01, dwellSec: 2 };
      }
    }
    for (const hint of CURIOSITY_TIMID_HINTS) {
      if (idLower.includes(hint)) {
        return { boldness: 0.05, ratePerSec: 0.005 };
      }
    }
  }
  return {};
}

/**
 * Merge an optional `Partial<X> | null | undefined` override on top of the
 * heuristic-derived default. Tri-state semantics:
 *   - override === null      → final value is `null` (explicit opt-out).
 *   - override === undefined → final value is `heuristicDefault` (use heuristic).
 *   - override is an object  → spread on top of `heuristicDefault ?? DEFAULT`.
 *                              If the heuristic returned null AND the catalog
 *                              opts in with a partial object, fall back to the
 *                              `optInBase` so missing fields still resolve.
 */
function mergeNullable<T extends object>(
  heuristicDefault: T | null,
  override: Partial<T> | null | undefined,
  optInBase: T,
): T | null {
  if (override === null) return null;
  if (override === undefined) {
    return heuristicDefault === null ? null : { ...heuristicDefault };
  }
  const base = heuristicDefault ?? optInBase;
  return { ...base, ...override };
}

/**
 * Resolve a catalog row to a full ResolvedBehavior:
 *   1. Pick a per-group preset (top/mid/bottom) using tag/id/group heuristics.
 *   2. Deep-merge the catalog row's optional `behavior` partials on top
 *      for the schooling / depth / animation / fear bundles.
 *   3. Apply species-specific heuristics for `territory` + `nipping` (most
 *      species → null), with `behavior.territory: null` / `behavior.nipping: null`
 *      providing an explicit opt-out.
 *   4. Return a fresh object (defensive copy so consumers can't mutate the
 *      shared preset constants).
 *
 * Deterministic + side-effect-free. Same input → same output, byte-stable.
 */
export function resolveBehavior(entry: BehaviorResolutionInput): ResolvedBehavior {
  const band = depthBandForSpecies(entry);
  const preset = presetFor(band);
  const overrides = entry.behavior;

  const territory = mergeNullable<TerritoryParams>(
    inferTerritoryFromSpecies(entry),
    overrides?.territory,
    DEFAULT_TERRITORY,
  );
  const nipping = mergeNullable<NippingParams>(
    inferNippingFromSpecies(entry),
    overrides?.nipping,
    DEFAULT_NIPPING,
  );

  // F11.4 — feeding + curiosity: species heuristic spreads over preset, then
  // catalog override spreads over the heuristic. No `null` opt-out — these
  // fields are required on ResolvedBehavior.
  const feedingHeuristic = inferFeedingFromSpecies(entry);
  const curiosityHeuristic = inferCuriosityFromSpecies(entry);

  // Literal object construction (not Object.assign with computed keys) keeps
  // the returned key order stable across runs + engines.
  return {
    schooling: {
      ...preset.schooling,
      ...(overrides?.schooling ?? {}),
    },
    depth: {
      ...preset.depth,
      ...(overrides?.depth ?? {}),
    },
    animation: {
      ...preset.animation,
      ...(overrides?.animation ?? {}),
    },
    territory,
    nipping,
    fear: {
      ...preset.fear,
      ...(overrides?.fear ?? {}),
    },
    feeding: {
      ...preset.feeding,
      ...feedingHeuristic,
      ...(overrides?.feeding ?? {}),
    },
    curiosity: {
      ...preset.curiosity,
      ...curiosityHeuristic,
      ...(overrides?.curiosity ?? {}),
    },
  };
}
