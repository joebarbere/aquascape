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
import type { CatalogRef, Layer, PlantObject, Scene } from '@aquascape/domain/scene-model';
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

import { computeZonedZ } from './layer-zone-z';
import { substrateHeightAt } from './substrate-height';
import { clampToScene } from './tank-clamp';

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
          ? buildScatterPatch(obj, entry, scale, scene)
          : buildSingleSpecimen(obj, entry, scale, scene, layer);
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
  scene: Scene,
  layer: Layer,
): Mesh | null {
  const geo = buildSilhouetteGeometry(entry);
  if (geo === null) return null;
  const mat = new MeshStandardMaterial({ color: entry.color, roughness: ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:plant/${obj.id}`;
  // **Y is snapped to the substrate.** The 2D renderer treats
  // `transform.position.y` as the silhouette centre; the 3D view reads
  // better when plants "rise from" the substrate at their XZ position
  // instead of floating mid-tank. The geometry is pre-translated so its
  // local origin sits at the bottom of the silhouette (see
  // `buildSilhouetteGeometry`).
  //
  // Position pipeline mirrors hardscape: layer-zone Z override → tank
  // (X, Z) clamp using the scaled half-extents → substrate Y snap.
  const x0 = obj.transform.position.x;
  const z0 = computeZonedZ(scene, obj.id, layer.id);
  const halfW = entry.naturalSize.width * 0.5;
  const halfD = entry.naturalSize.depth * 0.5 * DEPTH_MULT;
  const scaledHalfX = halfW * Math.abs(obj.transform.scale.x) * growthScale;
  const scaledHalfZ = halfD * Math.abs(obj.transform.scale.z) * growthScale;
  const clamped = clampToScene(
    { x: x0, y: 0, z: z0 },
    { x: scaledHalfX, z: scaledHalfZ },
    scene,
  );
  const floor = substrateHeightAt(scene, clamped.x);
  mesh.position.set(clamped.x, floor, clamped.z);
  mesh.rotation.set(
    obj.transform.rotation.x,
    obj.transform.rotation.y,
    obj.transform.rotation.z,
  );
  const sx = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1) * growthScale;
  // **Plant flipY is ignored — Y is always positive.** Plants must grow
  // upward from the substrate; flipping vertically would put roots in
  // the air. The MirrorObject command also rejects axis='y' for plant
  // kind (`commands.ts`), so this is defence in depth for legacy docs.
  const sy = obj.transform.scale.y * growthScale;
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
  scene: Scene,
): Group | InstancedMesh | null {
  const scatter = obj.scatter;
  if (scatter === undefined) return null;
  const baseSeed = scatter.seed ?? scene.seed;
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

  // **2D-to-3D scatter polygon reinterpretation.** In 2D the scatter
  // polygon describes a front-elevation cluster (a "wall of plants" at
  // a fixed depth). In 3D that reads as plants floating mid-air, which
  // makes carpets look broken. The natural 3D reinterpretation: the
  // polygon defines a TOP-DOWN floor patch — x stays as world X
  // (left-right), y becomes world Z (front-back depth). Each plant lands
  // at the substrate height beneath its (x, z). This makes Hemianthus /
  // Eleocharis / Monte Carlo carpets read as actual carpets.
  //
  // The 2D view is unchanged; this is a deliberate 3D-only divergence
  // documented in `docs/caveats/renderer-3d.md`.
  //
  // **Plant flipY is ignored — only flipX may flip a sprite.** Plants
  // always grow upward from their substrate anchor in both 2D and 3D.
  const flipSx = obj.transform.flipX ? -1 : 1;

  if (capped.length >= INSTANCED_THRESHOLD) {
    const instanced = new InstancedMesh(geo, mat, capped.length);
    instanced.name = `aquascape:plant/${obj.id}`;
    const tmpMat = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    for (let i = 0; i < capped.length; i++) {
      const inst = capped[i]!;
      const worldX = inst.position.x;
      const worldZ = inst.position.y;
      const worldY = substrateHeightAt(scene, worldX);
      pos.set(worldX, worldY, worldZ);
      quat.setFromAxisAngle(new Vector3(0, 1, 0), inst.rotation);
      scl.set(growthScale * inst.jitter * flipSx, growthScale * inst.jitter, growthScale);
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
    const worldX = inst.position.x;
    const worldZ = inst.position.y;
    const worldY = substrateHeightAt(scene, worldX);
    const mesh = new Mesh(geo, mat);
    mesh.position.set(worldX, worldY, worldZ);
    // Plant rotation spins about Y axis (vertical) so the leafy cluster
    // rotates around its stem instead of tipping over.
    mesh.rotation.set(0, inst.rotation, 0);
    mesh.scale.set(
      growthScale * inst.jitter * flipSx,
      growthScale * inst.jitter,
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
  // Shift the geometry so its local origin sits at the BOTTOM of the
  // silhouette (Y) and the CENTRE of the extrusion (Z). This way
  // `mesh.position.y = substrateHeight` lands the plant's base on the
  // substrate; without the +halfH shift the plant's centre would be at
  // floor height and half of it would sink into the substrate.
  geo.translate(0, halfH, -depth / 2);
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
