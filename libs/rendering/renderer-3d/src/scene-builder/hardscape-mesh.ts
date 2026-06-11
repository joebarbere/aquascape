/**
 * Hardscape mesh builder — Stage 10 F10.1 + zone / clamp / noise upgrades.
 *
 * Each `HardscapeObject` becomes one extruded mesh: the catalog silhouette
 * (a `[-1, 1]` normalised polygon) is scaled into world-mm by
 * `naturalSize × 0.5`, made into a Three.js `Shape`, then extruded along
 * Z by `naturalSize.depth` so the rock / wood has real volume.
 *
 * The object's `Transform` (position + rotation + scale + flipX/flipY) is
 * applied via mesh transform fields — same TRS as the 2D renderer's
 * `ctx.translate / ctx.rotate / ctx.scale` pipeline.
 *
 * Fallback colour `#7a7d84` (mid-grey) matches what a stone-ish hardscape
 * tends to look like; future versions can attach textured materials per
 * catalog entry.
 *
 * Position pipeline (in order):
 *
 *   1. World X starts at `transform.position.x`.
 *   2. World Z starts at `transform.position.z`, then is OVERRIDDEN by
 *      `computeZonedZ(scene, obj.id, layer.id)` when the layer carries
 *      a `zone` hint (see `layer-zone-z.ts`).
 *   3. (X, Z) are CLAMPED so the object's scaled AABB stays inside the
 *      tank (`clampToTank`). Y is excluded — Y is the substrate snap.
 *   4. Y is set to `substrateHeightAt(scene, X)` so the rock rests on
 *      the substrate floor.
 *   5. Geometry vertices get a deterministic per-vertex noise
 *      displacement (`applyHardscapeNoise`) so the silhouette reads as
 *      an irregular rock rather than a flat extruded slab.
 */

import type { Catalog, HardscapeEntry } from '@aquascape/domain/catalog';
import type {
  CatalogRef,
  HardscapeObject,
  Layer,
  Scene,
} from '@aquascape/domain/scene-model';
import { ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape } from 'three';

import { applyCaustics, CAUSTIC_MATERIALS_KEY } from './caustics';
import { applyHardscapeNoise, seedFromHardscape } from './hardscape-noise';
import { computeZonedZ } from './layer-zone-z';
import { substrateHeightAt } from './substrate-height';
import { clampToScene } from './tank-clamp';

const FALLBACK_COLOR = '#7a7d84';
/** Roughness for hardscape — rocks + wood are matte, not glossy. */
const ROUGHNESS = 0.85;

/**
 * Build a group of hardscape meshes. Iterates `scene.layers` back-to-front
 * (same draw order the 2D renderer uses) so painters' ordering is
 * preserved for any alpha transparency the future Stage 10 v2 may add.
 *
 * Invisible layers are skipped.
 */
export function buildHardscapeMeshes(scene: Scene, catalog: Catalog | undefined): Group {
  const group = new Group();
  group.name = 'aquascape:hardscape';
  // Caustics dance over rocks + wood too — collect the patched materials.
  const causticMaterials: MeshStandardMaterial[] = [];
  group.userData[CAUSTIC_MATERIALS_KEY] = causticMaterials;
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (obj.kind !== 'hardscape') continue;
      const entry = resolveHardscapeEntry(obj.ref, catalog);
      const mesh = buildHardscapeMesh(obj, entry, scene, layer);
      if (mesh !== null) {
        applyCaustics(mesh.material as MeshStandardMaterial, scene.tank.height);
        causticMaterials.push(mesh.material as MeshStandardMaterial);
        group.add(mesh);
      }
    }
  }
  return group;
}

/**
 * Build the mesh for a single hardscape object. Returns null when the
 * silhouette is missing or has fewer than 3 points (we have nothing to
 * extrude). Without a catalog we fall back to a default natural size +
 * a built-in square silhouette so the object still appears (matches the
 * 2D renderer's `HARDSCAPE_FALLBACK_NATURAL_MM` policy).
 *
 * `layer` is optional so existing call sites in tests that don't have a
 * containing-layer reference still work; when omitted, the zone step is
 * skipped (the object's original `transform.position.z` is used).
 */
export function buildHardscapeMesh(
  obj: HardscapeObject,
  entry: HardscapeEntry | null,
  scene?: Scene,
  layer?: Layer,
): Mesh | null {
  const naturalW = entry?.naturalSize.width ?? FALLBACK_NATURAL_MM;
  const naturalH = entry?.naturalSize.height ?? FALLBACK_NATURAL_MM;
  const naturalD = entry?.naturalSize.depth ?? FALLBACK_NATURAL_MM;
  const silhouette = entry?.silhouette ?? FALLBACK_SILHOUETTE;
  if (silhouette.length < 3) return null;

  const shape = new Shape();
  // Scale normalised [-1, 1] silhouette into world-mm so the extruded
  // shape spans `naturalSize` in width/height at scale 1.
  const halfW = naturalW * 0.5;
  const halfH = naturalH * 0.5;
  const first = silhouette[0]!;
  shape.moveTo(first.x * halfW, first.y * halfH);
  for (let i = 1; i < silhouette.length; i++) {
    const p = silhouette[i]!;
    shape.lineTo(p.x * halfW, p.y * halfH);
  }
  shape.closePath();

  const geo = new ExtrudeGeometry(shape, {
    depth: naturalD,
    bevelEnabled: false,
    steps: 1,
  });
  // Centre the extrusion on Z. X/Y are already centred via the silhouette
  // being in [-1, 1]; we shift Y up by halfH so the geometry's local
  // origin sits at the BOTTOM of the silhouette. Combined with the
  // substrate-rest math below, this lets `mesh.position.y =
  // substrateHeight` actually plant the bottom of the rock on the floor
  // (instead of leaving the rock's centre at floor-height, which would
  // bury half of it).
  geo.translate(0, halfH, -naturalD / 2);

  // Deterministic per-vertex displacement. Catalog id may be absent
  // (fallback path); use the obj.ref.id so the seed is still stable.
  const catalogId = entry?.id ?? obj.ref.id;
  const seed = seedFromHardscape(catalogId, obj.id);
  const minNatural = Math.min(naturalW, naturalH, naturalD);
  applyHardscapeNoise(geo, { seed, minNaturalMm: minNatural });

  const color = entry?.color ?? FALLBACK_COLOR;
  const mat = new MeshStandardMaterial({ color, roughness: ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:hardscape/${obj.id}`;
  // Rocks + wood are the primary shadow casters in the scene; they also
  // receive (a tall rock shadowing a shorter one reads as real depth).
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  if (scene !== undefined) {
    applyTransform(mesh, obj, scene, layer, {
      halfW,
      halfH,
      halfD: naturalD * 0.5,
    });
  }
  return mesh;
}

/**
 * Apply `obj.transform` to the mesh: position (with Z replaced by the
 * layer-zone band remap when applicable, XZ clamped to the tank, Y
 * snapped to the substrate so the rock rests on the floor), Z rotation,
 * and scale (signed by flipX / flipY). The flip-as-negative-scale
 * convention matches `composeTransform` in `domain/geometry`.
 *
 * **Y-snap policy:** the 2D renderer treats `transform.position.y` as
 * the silhouette CENTRE in a front-elevation projection. In 3D we
 * deliberately diverge: world Y is computed as `substrateHeight(x) +
 * max(0, y_offset_above_floor)`. The geometry was pre-translated so
 * its local origin sits at the bottom, so this lands the rock's BOTTOM
 * on the substrate. Cleaner reading than "rock floating mid-tank with
 * its centre at a height the 2D scene happens to record".
 */
function applyTransform(
  mesh: Mesh,
  obj: HardscapeObject,
  scene: Scene,
  layer: Layer | undefined,
  natural: { halfW: number; halfH: number; halfD: number },
): void {
  const x0 = obj.transform.position.x;
  // Zone Z override happens BEFORE clamping so the clamp pulls a
  // zone-projected coordinate back inside the tank rather than the
  // user-authored Z that the zone just overrode.
  const z0 = layer !== undefined
    ? computeZonedZ(scene, obj.id, layer.id)
    : obj.transform.position.z;

  // Scale the half-extents into world space before clamping. flipX/Y
  // become negative scale; absolute value is what defines the AABB.
  const scaledHalfX = natural.halfW * Math.abs(obj.transform.scale.x);
  const scaledHalfZ = natural.halfD * Math.abs(obj.transform.scale.z);

  const clamped = clampToScene(
    { x: x0, y: 0, z: z0 },
    { x: scaledHalfX, z: scaledHalfZ },
    scene,
  );
  const floor = substrateHeightAt(scene, clamped.x);
  mesh.position.set(clamped.x, floor, clamped.z);

  // Rotations: the scene-model `Transform.rotation` is a Vec3 of Euler
  // angles (z is the planar "spin" the 2D renderer uses; x/y the
  // out-of-plane tilts that v1's 2D-authored data leaves at 0).
  mesh.rotation.set(
    obj.transform.rotation.x,
    obj.transform.rotation.y,
    obj.transform.rotation.z,
  );
  const sx = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1);
  const sy = obj.transform.scale.y * (obj.transform.flipY ? -1 : 1);
  const sz = obj.transform.scale.z;
  mesh.scale.set(sx, sy, sz);
}

function resolveHardscapeEntry(
  ref: CatalogRef,
  catalog: Catalog | undefined,
): HardscapeEntry | null {
  if (catalog === undefined) return null;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'hardscape') return null;
  return entry;
}

/** Fallback natural size when the catalog is absent. */
const FALLBACK_NATURAL_MM = 100;

/**
 * Fallback silhouette — a square in normalised [-1, 1] space. Used only
 * when the catalog can't supply a real one (smoke tests, asset misses).
 */
const FALLBACK_SILHOUETTE: ReadonlyArray<{ x: number; y: number }> = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];
