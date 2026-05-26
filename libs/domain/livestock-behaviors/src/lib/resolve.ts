// Catalog-row → ResolvedBehavior resolution for F11.2.
//
// Pure + deterministic. Same input → byte-stable output. No randomness, no
// closures over module state, no mutation of the shared preset constants.

import type {
  AnimationParams,
  DepthBand,
  DepthParams,
  ResolvedBehavior,
  SchoolingParams,
} from './params';
import { BOTTOM_PRESET, MID_PRESET, TOP_PRESET } from './presets';

/**
 * Catalog row shape accepted by `resolveBehavior`. Structural (no import from
 * `@aquascape/domain/catalog`) so the dependency edge runs catalog → behaviors,
 * not the reverse. F11.1's structural cast for animation params already relied
 * on this shape, so it must stay backward-compatible.
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
  };
}

const TOP_ID_HINTS = ['hatchet', 'gourami', 'pencilfish'] as const;
const BOTTOM_ID_HINTS = ['cory', 'kuhli', 'pleco', 'oto', 'loach'] as const;

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
 * Resolve a catalog row to a full ResolvedBehavior:
 *   1. Pick a per-group preset (top/mid/bottom) using tag/id/group heuristics.
 *   2. Deep-merge the catalog row's optional `behavior` partials on top.
 *   3. Return the fully resolved triple as a fresh object (defensive copy so
 *      consumers can't mutate the shared preset constants).
 *
 * Deterministic + side-effect-free. Same input → same output, byte-stable.
 */
export function resolveBehavior(entry: BehaviorResolutionInput): ResolvedBehavior {
  const band = depthBandForSpecies(entry);
  const preset = presetFor(band);
  const overrides = entry.behavior;

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
  };
}
