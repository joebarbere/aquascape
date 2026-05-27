/**
 * Shared plain-data types for the fluid-sim domain lib.
 *
 * `Vec3` mirrors the scene-model / geometry `Vec3` (same shape, no alias hop
 * — keeps the dependency surface minimal and lets callers pass either type
 * interchangeably thanks to TypeScript's structural typing).
 *
 * `Aabb` here is **3D** (min/max in Vec3), distinct from `domain/geometry`'s
 * 2D `Aabb` which is Vec2-based. The 3D variant is the canonical envelope of
 * a tank's interior in millimetres and the natural input to every bake in
 * this lib.
 */

/** Right-handed millimetre vector. Structurally compatible with `domain/geometry`'s `Vec3`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounding box in 3D millimetres. */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}
