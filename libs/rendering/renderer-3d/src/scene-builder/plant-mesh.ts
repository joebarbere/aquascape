/**
 * Plant mesh builder — Stage 10 F10.1.
 *
 * Two paths:
 *
 *  1. Single specimen (`scatter === undefined`): one extruded silhouette
 *     placed at `transform.position`, scaled by transform × natural size
 *     × growth scale. Extrusion depth is shallow (30 % of `naturalSize.
 *     depth`) so the plant reads as a leaf cluster rather than a brick.
 *
 *  2. Scatter patch (`scatter !== undefined`): the same scatter helper the
 *     2D renderer uses (`scatterInPolygon`) produces deterministic
 *     positions inside the brush polygon. Each instance becomes a small
 *     extruded silhouette. Beyond a small instance count we prefer
 *     `InstancedMesh` for perf; capped at `MAX_SCATTER_INSTANCES_PER_PATCH`
 *     for v1 so a dense Monte-Carlo carpet doesn't melt the GPU.
 *
 * Growth scale comes from `plantScale(catalog.growth, plant.growth,
 * previewAgeWeeks)` — same helper the 2D renderer uses, so the time
 * slider previews identically in 2D and 3D.
 */

import type { Catalog, PlantEntry } from '@aquascape/domain/catalog';
import { plantScale, scatterInPolygon } from '@aquascape/domain/growth-sim';
import type { CatalogRef, PlantObject, Scene } from '@aquascape/domain/scene-model';
import {
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Vector3,
} from 'three';

/** Plants are matte. */
const ROUGHNESS = 0.7;
/** Depth multiplier for the extrusion — shallow so leaves read as clusters. */
const DEPTH_MULT = 0.3;
/** Cap on per-patch instance count. Above this we just paint MAX of them. */
const MAX_SCATTER_INSTANCES_PER_PATCH = 256;
/** Threshold above which we switch from individual Meshes to one InstancedMesh. */
const INSTANCED_THRESHOLD = 16;

const SCATTER_FLIP_X_SEED_MIX = 0x9e3779b1;
const SCATTER_FLIP_Y_SEED_MIX = 0x85ebca77;

/**
 * Build the plant group for the entire scene. Iterates layers back-to-front
 * (same order the 2D renderer uses) and skips invisible layers.
 */
export function buildPlantMeshes(
  scene: Scene,
  catalog: Catalog | undefined,
  previewAgeWeeks: number | undefined,
): Group {
  const group = new Group();
  group.name = 'aquascape:plants';
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (obj.kind !== 'plant') continue;
      const entry = resolvePlantEntry(obj.ref, catalog);
      if (entry === null) continue;
      const scale = plantScale(entry.growth, obj.growth, previewAgeWeeks);
      const node =
        obj.scatter !== undefined
          ? buildScatterPatch(obj, entry, scale, scene.seed)
          : buildSingleSpecimen(obj, entry, scale);
      if (node !== null) group.add(node);
    }
  }
  return group;
}

/**
 * Build a single specimen plant — one extruded silhouette positioned by
 * the object's transform.
 */
function buildSingleSpecimen(
  obj: PlantObject,
  entry: PlantEntry,
  growthScale: number,
): Mesh | null {
  const geo = buildSilhouetteGeometry(entry);
  if (geo === null) return null;
  const mat = new MeshStandardMaterial({ color: entry.color, roughness: ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:plant/${obj.id}`;
  mesh.position.set(obj.transform.position.x, obj.transform.position.y, obj.transform.position.z);
  mesh.rotation.set(
    obj.transform.rotation.x,
    obj.transform.rotation.y,
    obj.transform.rotation.z,
  );
  const sx = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1) * growthScale;
  const sy = obj.transform.scale.y * (obj.transform.flipY ? -1 : 1) * growthScale;
  const sz = obj.transform.scale.z * growthScale;
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

/**
 * Build a scatter patch — `scatterInPolygon` produces deterministic
 * instance positions, each becoming a small extruded silhouette mesh.
 * Above `INSTANCED_THRESHOLD` we render via `InstancedMesh` for perf.
 *
 * Cap the instance count at `MAX_SCATTER_INSTANCES_PER_PATCH` for v1 so
 * a too-dense brush doesn't kill framerate. The hard cap is on
 * INSTANCES PAINTED — we still run `scatterInPolygon` to completion
 * because the function is cheap and we want to keep the same RNG state
 * the 2D renderer sees (so the visible subset matches the same
 * positions the 2D renderer paints).
 */
function buildScatterPatch(
  obj: PlantObject,
  entry: PlantEntry,
  growthScale: number,
  sceneSeed: number,
): Group | InstancedMesh | null {
  const scatter = obj.scatter;
  if (scatter === undefined) return null;
  const baseSeed = scatter.seed ?? sceneSeed;
  const seed =
    ((baseSeed ^ (obj.transform.flipX ? SCATTER_FLIP_X_SEED_MIX : 0)) ^
      (obj.transform.flipY ? SCATTER_FLIP_Y_SEED_MIX : 0)) >>>
    0;
  const polygon = mirrorPolygon(scatter.polygon, obj.transform.flipX, obj.transform.flipY);
  const points = scatterInPolygon(polygon, scatter.density, seed);
  if (points.length === 0) return null;
  const capped = points.slice(0, MAX_SCATTER_INSTANCES_PER_PATCH);

  const geo = buildSilhouetteGeometry(entry);
  if (geo === null) return null;
  const mat = new MeshStandardMaterial({ color: entry.color, roughness: ROUGHNESS });

  // Per-instance scale carries the patch-level growth scale × the per-
  // instance jitter (which `scatterInPolygon` already varies in [0.85,
  // 1.15]). flipX / flipY on the parent object apply per-instance so an
  // asymmetric silhouette mirrors visibly with the patch.
  const flipSx = obj.transform.flipX ? -1 : 1;
  const flipSy = obj.transform.flipY ? -1 : 1;

  if (capped.length >= INSTANCED_THRESHOLD) {
    const instanced = new InstancedMesh(geo, mat, capped.length);
    instanced.name = `aquascape:plant/${obj.id}`;
    const tmpMat = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    for (let i = 0; i < capped.length; i++) {
      const inst = capped[i]!;
      pos.set(inst.position.x, inst.position.y, 0);
      quat.setFromAxisAngle(new Vector3(0, 0, 1), inst.rotation);
      scl.set(growthScale * inst.jitter * flipSx, growthScale * inst.jitter * flipSy, growthScale);
      tmpMat.compose(pos, quat, scl);
      instanced.setMatrixAt(i, tmpMat);
    }
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }

  // Below the instancing threshold, individual meshes are simpler to
  // dispose and inspect. Each shares the same geometry + material — we
  // own those lifetimes via the group's dispose walk in the renderer.
  const group = new Group();
  group.name = `aquascape:plant/${obj.id}`;
  for (let i = 0; i < capped.length; i++) {
    const inst = capped[i]!;
    const mesh = new Mesh(geo, mat);
    mesh.position.set(inst.position.x, inst.position.y, 0);
    mesh.rotation.set(0, 0, inst.rotation);
    mesh.scale.set(
      growthScale * inst.jitter * flipSx,
      growthScale * inst.jitter * flipSy,
      growthScale,
    );
    group.add(mesh);
  }
  return group;
}

/**
 * Build the extrusion geometry for one plant silhouette. The geometry is
 * centred about its origin so the object's transform.position lands at the
 * plant's centre-of-mass.
 *
 * Extrusion depth is `naturalSize.depth × DEPTH_MULT` so the plant reads
 * as a leafy cluster instead of a solid block.
 */
function buildSilhouetteGeometry(entry: PlantEntry): ExtrudeGeometry | null {
  if (entry.silhouette.length < 3) return null;
  const halfW = entry.naturalSize.width * 0.5;
  const halfH = entry.naturalSize.height * 0.5;
  const depth = Math.max(1, entry.naturalSize.depth * DEPTH_MULT);
  const shape = new Shape();
  const first = entry.silhouette[0]!;
  shape.moveTo(first.x * halfW, first.y * halfH);
  for (let i = 1; i < entry.silhouette.length; i++) {
    const p = entry.silhouette[i]!;
    shape.lineTo(p.x * halfW, p.y * halfH);
  }
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Mirror a polygon about its bbox centroid on either axis. Same helper as
 * in `renderer-2d`'s scatter code — re-implemented here to avoid pulling
 * in renderer-2d (the layer rules forbid renderer→renderer deps).
 */
function mirrorPolygon(
  polygon: ReadonlyArray<{ x: number; y: number }>,
  flipX: boolean,
  flipY: boolean,
): ReadonlyArray<{ x: number; y: number }> {
  if (!flipX && !flipY) return polygon;
  if (polygon.length === 0) return polygon;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return polygon.map((p) => ({
    x: flipX ? cx - (p.x - cx) : p.x,
    y: flipY ? cy - (p.y - cy) : p.y,
  }));
}

function resolvePlantEntry(ref: CatalogRef, catalog: Catalog | undefined): PlantEntry | null {
  if (catalog === undefined) return null;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'plant') return null;
  return entry;
}
