// Public API for @aquascape/domain/growth-sim.
//
// Deterministic plant growth simulation engine (Plan Stage 4 F4.4).
//
// Two pure-functional pieces:
//   - `plantScale(params, state, previewAgeWeeks?)` — turns a plant's age into
//     a scalar multiplier that the renderer applies to the catalog silhouette.
//   - `scatterInPolygon(polygon, density, seed)` — deterministic carpet/brush
//     placement; given (polygon, density, seed) the same instances always
//     come out, so saved documents reproduce exactly.
//
// Both are pure TS, no DOM, no Angular — they live in `domain/*` so they're
// safe to call from the 2D renderer today and the 3D renderer (Stage 10) later.

export {
  GROWTH_CURVE_TARGET,
  type GrowthParams,
  type PlantGrowthState,
  plantScale,
} from './growth-curve';

export { type ScatterPoint, scatterInPolygon, polygonArea } from './scatter';
