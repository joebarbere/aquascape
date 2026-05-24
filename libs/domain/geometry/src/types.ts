/**
 * Plain-data geometric primitives, framework-free.
 *
 * These shapes mirror the canonical types in `aqua-document.ts` (and the
 * forthcoming `libs/domain/document/`). They are intentionally re-declared
 * here so this lib has no upward dependency on `domain/document` — the
 * scene-model and renderers depend on `domain/geometry` and not the other
 * way round. The shapes must remain trivially structurally compatible.
 *
 * UNITS: linear coordinates are in millimetres (mm). The math is unit-
 * agnostic numerically, but the public contract treats all distances as mm.
 *
 * COORDINATES: right-handed; +x right, +y up, +z back; origin at the tank
 * front-bottom-left interior corner. Rotation is in radians and follows the
 * right-hand rule about each axis.
 */

/** A 2D point/vector in millimetres. Plain serializable data. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A 3D point/vector in millimetres. Plain serializable data. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Affine transform for a scene object. Mirrors the `Transform` shape in
 * `aqua-document.ts`.
 *
 * Application order, from local to world (see {@link applyTransform}):
 *   1. flipX / flipY    (negate local x / y before scaling)
 *   2. scale            (component-wise)
 *   3. rotation.x       (about local +x, right-hand rule)
 *   4. rotation.y       (about local +y)
 *   5. rotation.z       (about local +z; this is the only one the 2D
 *                        renderer uses, aka the in-plane yaw)
 *   6. position         (translate)
 *
 * Rotation is in radians.
 */
export interface Transform {
  position: Vec3;
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  /** Horizontal mirror about the object's local center (negate local x). */
  flipX: boolean;
  /** Vertical mirror about the object's local center (negate local y). */
  flipY: boolean;
}

/** Axis-aligned bounding box in 2D (mm). */
export interface Aabb {
  min: Vec2;
  max: Vec2;
}
