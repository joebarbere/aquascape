/**
 * Layer-zone → world-Z band placement helper.
 *
 * `Layer.zone` (schema v2) is an authoring hint — "everything on this
 * layer lives in the foreground / midground / background of the tank".
 * The 2D renderer projects along −z so the field is a pure no-op there;
 * the 3D renderer consumes it to override an object's world Z so the
 * scene reads as a real aquarium ordering.
 *
 * Band partition (along the tank's depth axis, origin at front interior
 * corner, +z toward the back glass):
 *
 *   foreground → [0, tank.depth / 3]
 *   midground  → [tank.depth / 3, 2 × tank.depth / 3]
 *   background → [2 × tank.depth / 3, tank.depth]
 *
 * **Relative-ordering preservation — chosen algorithm: A (min-max remap).**
 * Within a layer that has a zone, find the min/max of every object's
 * `transform.position.z` and linearly remap each to the band's
 * `[zMin, zMax]`. Rationale: it preserves the user's "this rock is
 * slightly behind that rock" signal, which the centred-quantile variant
 * (B) destroys by spacing strictly evenly. The cost — a single outlier
 * compresses the rest — is acceptable for v1, where layer object counts
 * are small enough that outliers are rare.
 *
 * Pass-through fast paths (return `transform.position.z` unchanged):
 *   - layer has no `zone`
 *   - layer not found (defensive — shouldn't happen but cheap to guard)
 *   - object not found in any layer (defensive)
 *   - n = 1 in the layer (no relative ordering to preserve; place at band centre)
 *   - the layer's z-extent has zero spread (every object at the same Z)
 *
 * Pure — no Three.js dependency.
 */

import type { Scene, LayerId, ObjectId, SceneObject } from '@aquascape/domain/scene-model';

/**
 * Compute the world-Z for `objectId` taking the containing layer's zone
 * (if any) into account. When the layer has no zone, returns the
 * object's authored `transform.position.z` unchanged.
 *
 * The caller (hardscape-mesh / plant-mesh builders) substitutes this
 * value for `transform.position.z` BEFORE applying the substrate Y-snap
 * and the X / Z tank clamp.
 */
export function computeZonedZ(scene: Scene, objectId: ObjectId, layerId: LayerId): number {
  const layer = scene.layers.find((l) => l.id === layerId);
  if (layer === undefined) {
    // Defensive: caller passed a layer id that doesn't belong to the
    // scene. Fall through to the object's own Z if we can find it; else
    // 0. Either way, no zone work to do.
    return findObjectZ(scene, objectId) ?? 0;
  }

  const obj = layer.objects.find((o) => o.id === objectId);
  if (obj === undefined) return findObjectZ(scene, objectId) ?? 0;

  const originalZ = obj.transform.position.z;
  if (layer.zone === undefined) return originalZ;

  const band = bandRange(layer.zone, scene.tank.depth);
  if (band === null) return originalZ;
  const [zMin, zMax] = band;

  // n = 1 → place at band centre. There's no relative ordering to
  // preserve when the layer only holds one object.
  if (layer.objects.length === 1) return (zMin + zMax) * 0.5;

  // Find min/max of `transform.position.z` across the whole layer.
  let layerMinZ = Infinity;
  let layerMaxZ = -Infinity;
  for (const candidate of layer.objects) {
    const z = candidate.transform.position.z;
    if (z < layerMinZ) layerMinZ = z;
    if (z > layerMaxZ) layerMaxZ = z;
  }

  const spread = layerMaxZ - layerMinZ;
  // Degenerate spread (every object at the same Z) → band centre.
  if (spread <= 0) return (zMin + zMax) * 0.5;

  const t = (originalZ - layerMinZ) / spread; // [0, 1]
  return zMin + t * (zMax - zMin);
}

/**
 * Resolve a zone name to its `[zMin, zMax]` band on the tank's depth
 * axis. Returns `null` when `tankDepth <= 0` (degenerate scene).
 */
function bandRange(
  zone: 'foreground' | 'midground' | 'background',
  tankDepth: number,
): readonly [number, number] | null {
  if (tankDepth <= 0) return null;
  const third = tankDepth / 3;
  switch (zone) {
    case 'foreground':
      return [0, third];
    case 'midground':
      return [third, 2 * third];
    case 'background':
      return [2 * third, tankDepth];
  }
}

/**
 * Fallback for the "object lives in some layer, caller passed wrong
 * layerId" defensive branch. Walks every layer; returns the object's
 * Z if we find it, else `null`.
 */
function findObjectZ(scene: Scene, objectId: ObjectId): number | null {
  for (const layer of scene.layers) {
    const obj: SceneObject | undefined = layer.objects.find((o) => o.id === objectId);
    if (obj !== undefined) return obj.transform.position.z;
  }
  return null;
}
