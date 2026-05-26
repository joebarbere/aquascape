/**
 * Hardscape mesh builder — Stage 10 F10.1.
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
 */

import type { Catalog, HardscapeEntry } from '@aquascape/domain/catalog';
import type { CatalogRef, HardscapeObject, Scene } from '@aquascape/domain/scene-model';
import { ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape } from 'three';

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
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (obj.kind !== 'hardscape') continue;
      const entry = resolveHardscapeEntry(obj.ref, catalog);
      const mesh = buildHardscapeMesh(obj, entry);
      if (mesh !== null) group.add(mesh);
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
 */
export function buildHardscapeMesh(
  obj: HardscapeObject,
  entry: HardscapeEntry | null,
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
  // Centre the extrusion on Z so the object's origin sits at its centre
  // along depth — `transform.position.z` then describes the object's
  // centre-of-volume, consistent with x/y where the silhouette is already
  // centred about (0, 0).
  geo.translate(0, 0, -naturalD / 2);

  const color = entry?.color ?? FALLBACK_COLOR;
  const mat = new MeshStandardMaterial({ color, roughness: ROUGHNESS });
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:hardscape/${obj.id}`;

  applyTransform(mesh, obj);
  return mesh;
}

/**
 * Apply `obj.transform` to the mesh: position, Z rotation, and scale
 * (signed by flipX / flipY). The flip-as-negative-scale convention
 * matches `composeTransform` in `domain/geometry`.
 */
function applyTransform(mesh: Mesh, obj: HardscapeObject): void {
  mesh.position.set(obj.transform.position.x, obj.transform.position.y, obj.transform.position.z);
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
