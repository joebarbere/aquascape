/**
 * Decor mesh builder — classic aquarium ornaments (treasure chest, sunken
 * galleon, skull, castle…).
 *
 * Unlike hardscape (procedural silhouette extrusion + noise), decor is
 * 3D-MODELLED: each `DecorEntry` carries a required `model` ref to a baked
 * GLB the renderer loads through the renderer-lifetime `ModelCache`. The
 * GLB authoring contract (enforced by the baker, relied on here):
 *
 *   - millimetre units, Y-up
 *   - origin at BOTTOM-CENTRE (minY = 0, centred x/z) — the same local
 *     origin convention the hardscape extrusion is pre-translated to, so
 *     `node.position.y = substrateHeightAt(...)` plants the base on the
 *     substrate with no per-model fitting
 *   - front faces local +Z
 *   - bounding box exactly `entry.naturalSize` at scale 1 — so the only
 *     scale applied is `transform.scale` (no re-fit, no naturalSize term)
 *
 * ORIENTATION — why the container carries `scale.z = −1` (NOT a π yaw)
 * --------------------------------------------------------------------
 * In document space the viewer stands at −Z (z = 0 is the FRONT pane), so
 * "facing the viewer" means facing doc −Z; a GLB authored front-+Z needs
 * a turn. There are two candidate turns and only one is correct:
 *
 *  - `rotation.y = π` points the front at the viewer but lands the
 *    model's authored +X on screen-LEFT (yaw negates X; the doc→world
 *    X-mirror negates it again into world +X; screen-right is world −X
 *    — see the X-mirror section of `three-3d-renderer.ts`). The model
 *    would read left-right MIRRORED relative to its own 2D catalog
 *    silhouette — a chest latch would jump sides on the 2D↔3D toggle.
 *
 *  - `scale.z = −1` (used here) also points the front at the viewer
 *    (local +Z → doc −Z) but leaves local X untouched: authored +X →
 *    doc +X → world −X → screen-RIGHT, exactly where the 2D renderer
 *    paints the silhouette's +x. Composed with the group X-mirror the
 *    two reflections make a PROPER rotation (positive determinant), so
 *    the model isn't mirror-imaged at all — authored text/details read
 *    correctly. Three.js flips `gl.frontFace` per-mesh off the world-
 *    matrix determinant, so winding/culling are correct either way.
 *
 * The Z-flip is applied to the model CONTAINER. The extruded fallback
 * parked inside the same container needs NO compensation: the extrusion
 * is z-symmetric about the container origin (front/back faces are the
 * same silhouette), so the flip is visually identity for it and its
 * silhouette keeps the exact hardscape/2D left-right reading.
 *
 * FALLBACK RULE
 * -------------
 * No `models` options (host didn't pass `catalogModelBaseUrl`), a missing
 * catalog entry, a still-loading GLB, or a failed/404 load all show the
 * extruded-silhouette fallback (entry colour, NO hardscape noise — decor
 * is moulded resin, not rock). The `ModelCache` hides the fallback in
 * place when the GLB arrives; on failure it stays forever.
 *
 * Position pipeline mirrors `hardscape-mesh.ts` exactly: layer-zone Z
 * remap → XZ AABB clamp inside the glass → Y rests on the substrate.
 */

import type { Catalog, DecorEntry } from '@aquascape/domain/catalog';
import type { CatalogRef, DecorObject, Layer, Scene } from '@aquascape/domain/scene-model';
import {
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  type Material,
  type Object3D,
} from 'three';

import type { ModelCache } from '../model-cache';
import { applyCaustics, CAUSTIC_MATERIALS_KEY } from './caustics';
import { computeZonedZ } from './layer-zone-z';
import { substrateHeightAt } from './substrate-height';
import { clampToScene } from './tank-clamp';

/** Fallback colour when the catalog entry is missing — matches hardscape. */
const FALLBACK_COLOR = '#7a7d84';
/** Roughness for the extruded fallback — moulded resin reads matte. */
const FALLBACK_ROUGHNESS = 0.85;
/** Fallback natural size when the catalog is absent — matches hardscape. */
const FALLBACK_NATURAL_MM = 100;

/**
 * Z-scale that turns a front-+Z-authored GLB to face the document viewer
 * (doc −Z) while keeping authored left-right aligned with the 2D
 * silhouette — see the ORIENTATION section in the file header for why
 * this is a Z-flip and not a π yaw. Exported for the spec.
 */
export const MODEL_FACES_VIEWER_SCALE_Z = -1;

/** Fallback silhouette — a square in normalised [-1, 1] space. */
const FALLBACK_SILHOUETTE: ReadonlyArray<{ x: number; y: number }> = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

/**
 * GLB-loading wiring, present only when the host supplied
 * `RenderOptions.catalogModelBaseUrl`. Absent ⇒ extruded fallback only,
 * zero network — headless-test-safe.
 */
export interface DecorModelOptions {
  cache: ModelCache;
  baseUrl: string;
}

/**
 * Build a group of decor nodes. Iterates `scene.layers` back-to-front
 * (same draw order as the 2D renderer + the hardscape builder). Invisible
 * layers are skipped.
 *
 * The group's `userData[CAUSTIC_MATERIALS_KEY]` array is LIVE: GLB loads
 * that resolve after this build push their patched materials into the
 * same array, so the renderer (which keeps a reference to it) animates
 * late-attached models without a rebuild.
 */
export function buildDecorMeshes(
  scene: Scene,
  catalog: Catalog | undefined,
  models?: DecorModelOptions,
): Group {
  const group = new Group();
  group.name = 'aquascape:decor';
  const causticMaterials: MeshStandardMaterial[] = [];
  group.userData[CAUSTIC_MATERIALS_KEY] = causticMaterials;
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (obj.kind !== 'decor') continue;
      const entry = resolveDecorEntry(obj.ref, catalog);
      const node = buildDecorNode(obj, entry, scene, layer, models, causticMaterials);
      if (node !== null) group.add(node);
    }
  }
  return group;
}

/**
 * Build the node for a single decor object. Returns null when the
 * silhouette is degenerate (< 3 points) AND no model can be loaded —
 * there is nothing to show.
 */
export function buildDecorNode(
  obj: DecorObject,
  entry: DecorEntry | null,
  scene: Scene,
  layer: Layer | undefined,
  models: DecorModelOptions | undefined,
  causticMaterials: MeshStandardMaterial[],
): Object3D | null {
  const naturalW = entry?.naturalSize.width ?? FALLBACK_NATURAL_MM;
  const naturalH = entry?.naturalSize.height ?? FALLBACK_NATURAL_MM;
  const naturalD = entry?.naturalSize.depth ?? FALLBACK_NATURAL_MM;
  const silhouette = entry?.silhouette ?? FALLBACK_SILHOUETTE;

  const node = new Group();
  node.name = `aquascape:decor/${obj.id}`;

  if (entry !== null && models !== undefined) {
    // GLB path. The cache returns the container synchronously; the model
    // attaches in place when (or if) the load resolves. While loading —
    // and permanently on failure — the extruded fallback shows.
    const container = models.cache.get(models.baseUrl + entry.model, {
      onAttached: (model) => prepareLoadedModel(model, scene.tank.height, causticMaterials),
    });
    container.scale.z = MODEL_FACES_VIEWER_SCALE_Z;
    if (container.children.length === 0) {
      // Not loaded yet (or failed) — park the fallback inside the
      // container so the cache can hide it in place on model arrival.
      // No orientation compensation needed: the extrusion is z-symmetric,
      // so the container's Z-flip is visually identity for it. A
      // degenerate silhouette mounts the bare container instead — the
      // model may still attach later.
      const fallback = buildFallbackMesh(
        obj,
        entry,
        silhouette,
        naturalW,
        naturalH,
        naturalD,
        scene.tank.height,
        causticMaterials,
      );
      if (fallback !== null) {
        container.add(fallback);
      }
    }
    node.add(container);
  } else {
    const fallback = buildFallbackMesh(
      obj,
      entry,
      silhouette,
      naturalW,
      naturalH,
      naturalD,
      scene.tank.height,
      causticMaterials,
    );
    if (fallback === null) return null;
    node.add(fallback);
  }

  applyTransform(node, obj, scene, layer, {
    halfW: naturalW * 0.5,
    halfD: naturalD * 0.5,
  });
  return node;
}

/**
 * Renderer policy applied to every freshly-attached GLB clone: shadow
 * flags on every mesh, and the animated-caustics patch on every
 * NON-TRANSMISSIVE standard/physical material (the GLBs are baked with
 * `MeshPhysicalMaterial` PBR params; transmissive glass-like materials
 * skip the patch — additive caustics over a transmission pass reads as a
 * milky film, see `docs/caveats/renderer-3d.md` → "Decor models").
 *
 * Patched materials are pushed into the LIVE `causticMaterials` array so
 * the renderer's RAF tick animates them immediately — even when the load
 * resolved after the last `render()` collected its lists.
 */
export function prepareLoadedModel(
  model: Object3D,
  tankHeight: number,
  causticMaterials: MeshStandardMaterial[],
): void {
  model.traverse((node) => {
    if (!(node as Mesh).isMesh) return;
    const mesh = node as Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials: Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material !== undefined
        ? [mesh.material]
        : [];
    for (const material of materials) {
      const standard = material as MeshStandardMaterial & { transmission?: number };
      if (standard.isMeshStandardMaterial !== true) continue;
      const transmissive = typeof standard.transmission === 'number' && standard.transmission > 0;
      if (transmissive) continue;
      applyCaustics(standard, tankHeight);
      causticMaterials.push(standard);
    }
  });
}

/**
 * Extruded-silhouette fallback — the hardscape extrusion minus the noise
 * displacement (decor is moulded resin, not rock; crinkling a treasure
 * chest reads as a glitch). Local origin at bottom-centre, identical to
 * the GLB authoring contract, so the substrate snap works for both.
 */
function buildFallbackMesh(
  obj: DecorObject,
  entry: DecorEntry | null,
  silhouette: ReadonlyArray<{ x: number; y: number }>,
  naturalW: number,
  naturalH: number,
  naturalD: number,
  tankHeight: number,
  causticMaterials: MeshStandardMaterial[],
): Mesh | null {
  if (silhouette.length < 3) return null;
  const halfW = naturalW * 0.5;
  const halfH = naturalH * 0.5;
  const shape = new Shape();
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
  // Local origin → bottom-centre (same translate as hardscape-mesh.ts).
  geo.translate(0, halfH, -naturalD / 2);

  const mat = new MeshStandardMaterial({
    color: entry?.color ?? FALLBACK_COLOR,
    roughness: FALLBACK_ROUGHNESS,
  });
  applyCaustics(mat, tankHeight);
  causticMaterials.push(mat);

  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:decor-fallback/${obj.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Apply `obj.transform` to the node — the EXACT hardscape pipeline:
 *
 *   1. layer-zone Z remap (`computeZonedZ`) when the layer carries a zone
 *   2. XZ clamp so the scaled AABB stays inside the glass (`clampToScene`)
 *   3. Y snapped to `substrateHeightAt(scene, x)` — the GLB / fallback
 *      origin is at the bottom, so the ornament rests on the substrate
 *
 * Scale is `transform.scale` ONLY (the GLB is authored at exactly
 * `naturalSize`), signed by flipX / flipY — the same flip-as-negative-
 * scale convention hardscape uses.
 */
function applyTransform(
  node: Object3D,
  obj: DecorObject,
  scene: Scene,
  layer: Layer | undefined,
  natural: { halfW: number; halfD: number },
): void {
  const x0 = obj.transform.position.x;
  const z0 =
    layer !== undefined ? computeZonedZ(scene, obj.id, layer.id) : obj.transform.position.z;

  const scaledHalfX = natural.halfW * Math.abs(obj.transform.scale.x);
  const scaledHalfZ = natural.halfD * Math.abs(obj.transform.scale.z);

  const clamped = clampToScene({ x: x0, y: 0, z: z0 }, { x: scaledHalfX, z: scaledHalfZ }, scene);
  const floor = substrateHeightAt(scene, clamped.x);
  node.position.set(clamped.x, floor, clamped.z);

  node.rotation.set(obj.transform.rotation.x, obj.transform.rotation.y, obj.transform.rotation.z);
  const sx = obj.transform.scale.x * (obj.transform.flipX ? -1 : 1);
  const sy = obj.transform.scale.y * (obj.transform.flipY ? -1 : 1);
  const sz = obj.transform.scale.z;
  node.scale.set(sx, sy, sz);
}

function resolveDecorEntry(ref: CatalogRef, catalog: Catalog | undefined): DecorEntry | null {
  if (catalog === undefined) return null;
  const entry = catalog.get({ catalog: ref.catalog, id: ref.id });
  if (entry === null || entry.kind !== 'decor') return null;
  return entry;
}
