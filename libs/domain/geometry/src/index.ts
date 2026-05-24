// Public API for @aquascape/domain/geometry.
//
// Framework-free geometry primitives shared by every other domain lib,
// both renderers, and the precision-guide overlays. Implemented in F0.2;
// see ./README.md for the load-bearing conventions (coords, units,
// EPSILON, inclusive-boundary rule, empty-AABB rule).

// ─── Types ────────────────────────────────────────────────────────────────
export type { Vec2, Vec3, Transform, Aabb } from './types';

// ─── Constants ────────────────────────────────────────────────────────────
export { EPSILON, PHI, approxEquals } from './constants';

// ─── Vec2 ─────────────────────────────────────────────────────────────────
export {
  vec2,
  addVec2,
  subVec2,
  mulVec2,
  scaleVec2,
  dotVec2,
  lengthVec2,
  distanceVec2,
  normalizeVec2,
  lerpVec2,
} from './vec2';

// ─── Vec3 ─────────────────────────────────────────────────────────────────
export {
  vec3,
  addVec3,
  subVec3,
  mulVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  distanceVec3,
  normalizeVec3,
  lerpVec3,
} from './vec3';

// ─── Transform ────────────────────────────────────────────────────────────
export {
  identityTransform,
  composeTransform,
  invertTransform,
  applyTransform,
  isApproxIdentity,
} from './transform';

// ─── Projection ───────────────────────────────────────────────────────────
export { project2D } from './projection';

// ─── AABB ─────────────────────────────────────────────────────────────────
export {
  aabbContainsPoint,
  aabbIntersects,
  aabbFromPoints,
  aabbExpand,
  transformAabb,
} from './aabb';

// ─── Hit-test ─────────────────────────────────────────────────────────────
export { pointInRect, pointInRotatedRect, pointInCircle, pointInPolygon } from './hit-test';

// ─── Composition guides ───────────────────────────────────────────────────
export { goldenRatioLines, thirdsLines, focalPoints } from './composition-guides';

// ─── Snap ─────────────────────────────────────────────────────────────────
export { snapToGrid, snapToValue } from './snap';
