/**
 * Plant mesh builder — Stage 10 F10.1 + Stage 11 F11.7 (sway).
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
 *
 * ─── Sway (Stage 11 F11.7) ──────────────────────────────────────────────
 *
 * Every plant material is a `MeshStandardMaterial` extended via
 * `onBeforeCompile` with a vertex shader that nudges each vertex along
 * world-X by:
 *
 *     swayAmp   = SWAY_MAX_MM
 *               * plantPosFactor   // (1 - clamp(plantBaseY / tankH, 0, 1))  — LOWER plants sway more
 *               * vertexHeightFactor // (vertexY / silhouetteHeight)         — TOP vertices sway more than the rooted base
 *     swayX     = swayAmp * sin(uTime * 2π * SWAY_FREQ_HZ + phaseOffset)
 *
 * Phase offset is deterministic — `seededHash01(scene.seed, ...keys)` so
 * the wave pattern is stable across renders / re-opens of the document.
 * Per-instance phase for `InstancedMesh` rides on an `InstancedBufferAttribute`;
 * single-specimen meshes get a uniform.
 *
 * The host renderer caches the sway materials on `group.userData
 * ['aquascape:plantSwayMaterials']` and advances `uTime` each RAF tick.
 *
 * **Flow-coupled sway (fidelity pass):** the F11.7 deferral is now closed.
 * When `RenderOptions.flowField` is supplied (the host's
 * `LivestockSimulationService` bakes it for the livestock sim), each plant's
 * sway AMPLITUDE is scaled by the local current magnitude at its base —
 * plants in a filter outflow wave harder, dead-zone plants barely move
 * (`flowAmpAt` → `[FLOW_AMP_MIN, FLOW_AMP_MAX]`, fed to `uFlowAmp` /
 * `aFlowAmp`). We couple amplitude rather than the baked frequency: it reads
 * the same and is a one-multiplier shader change. Opt-in — with no flow
 * field every factor is 1.0 and the sway is byte-for-byte the pre-fidelity
 * constant. The oscillation frequency stays a constant 1.2 Hz.
 */

import type { Catalog, PlantEntry } from '@aquascape/domain/catalog';
import { type FlowField, sampleFlowField } from '@aquascape/domain/fluid-sim';
import { seededHash01 } from '@aquascape/domain/geometry';
import { plantScale, scatterInPolygon } from '@aquascape/domain/growth-sim';
import type { CatalogRef, Layer, PlantObject, Scene } from '@aquascape/domain/scene-model';
import {
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
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
 * Peak lateral displacement at the top of a plant rooted on the
 * substrate (in mm, in the geometry's local frame BEFORE the mesh's
 * scale is applied). 5 mm reads as gentle wave at typical scene scales
 * (30 cm – 1.2 m tanks) without making fine-leafed plants jitter into
 * each other.
 */
const SWAY_MAX_MM = 5.0;

/**
 * Sway oscillation frequency, Hertz. A constant — the F11.7 plan calls
 * for coupling to the flow-field magnitude at each plant's base; that
 * coupling is deferred (see header).
 */
const SWAY_FREQ_HZ = 1.2;

/** 2π × SWAY_FREQ_HZ, pre-baked into the shader source. */
const SWAY_FREQ_2PI = 2 * Math.PI * SWAY_FREQ_HZ;

/**
 * Flow-coupled sway (fidelity pass). When a baked `FlowField` is supplied
 * (`RenderOptions.flowField`), each plant's sway AMPLITUDE is scaled by the
 * local current magnitude at its base — closing the F11.7 "plants near a
 * filter outflow visibly wave; plants in dead zones barely move" deferral.
 *
 * We couple amplitude (not the baked frequency) deliberately: it reads the
 * same ("waves harder in current") and is a one-multiplier shader change that
 * doesn't disturb the existing per-instance phase / frequency wiring. The
 * coupling is OPT-IN — with no flow field every factor is exactly 1.0, so the
 * pre-fidelity sway is byte-for-byte unchanged.
 *
 * `FLOW_REF_MMPS` is the current magnitude (mm/s) that saturates the response;
 * `FLOW_AMP_MIN` is the dead-zone floor (plants in still water barely move),
 * `FLOW_AMP_MAX` the outflow ceiling.
 */
const FLOW_REF_MMPS = 80;
const FLOW_AMP_MIN = 0.4;
const FLOW_AMP_MAX = 2.4;

/**
 * Sample the flow field at a plant base and map its magnitude into the
 * `[FLOW_AMP_MIN, FLOW_AMP_MAX]` sway-amplitude multiplier. Returns 1.0 when
 * no field is supplied (opt-in: pre-fidelity behaviour preserved). Pure +
 * deterministic — `sampleFlowField` is a pure trilinear read.
 */
function flowAmpAt(
  flowField: FlowField | undefined,
  x: number,
  y: number,
  z: number,
): number {
  if (flowField === undefined) return 1;
  const v = sampleFlowField(flowField, { x, y, z });
  const mag = Math.hypot(v.x, v.y, v.z);
  const norm = Math.min(1, mag / FLOW_REF_MMPS);
  return FLOW_AMP_MIN + norm * (FLOW_AMP_MAX - FLOW_AMP_MIN);
}

/** Seed mix for single-specimen phase. Distinct from scatter seed mix. */
const SINGLE_SPECIMEN_PHASE_SEED_MIX = 0x27d4eb2d;
/** Seed mix for scatter-instance phase. */
const SCATTER_INSTANCE_PHASE_SEED_MIX = 0x165667b1;

/**
 * `userData` key the renderer reads to find the sway materials it must
 * tick `uTime` on each frame. Exported so the host can stay loosely
 * coupled (no import-time entanglement with builder internals).
 */
export const PLANT_SWAY_MATERIALS_KEY = 'aquascape:plantSwayMaterials';

/**
 * Shape of the sway-material uniforms object. Exposed for the renderer's
 * per-frame `uTime` update loop. The vertex shader is injected via
 * `onBeforeCompile`; uniforms live alongside the standard PBR uniforms
 * on the same `Shader` object.
 *
 * `uPlantEmissiveBoost` (F11.7 day-night, Wave 3) is written every render
 * by the host renderer from `RenderOptions.dayNightLookup.emissiveBoost`.
 * The fragment-shader patch adds `boost * GREEN_TINT` onto the final
 * fragment colour so plants stay legible at night without going neon
 * (the green bias matches the warm-cool axis the rest of the cycle reads
 * on — a blue/red boost would look like an aquarium-club novelty light).
 */
export interface PlantSwayUniforms {
  uTime: IUniform<number>;
  uPlantEmissiveBoost: IUniform<number>;
}

/**
 * Build the plant group for the entire scene. Iterates layers back-to-front
 * (same order the 2D renderer uses) and skips invisible layers.
 *
 * Stashes the list of sway-enabled materials on `group.userData[
 * PLANT_SWAY_MATERIALS_KEY]` so the host renderer can tick `uTime` on
 * them each frame without re-traversing the scene graph.
 */
export function buildPlantMeshes(
  scene: Scene,
  catalog: Catalog | undefined,
  previewAgeWeeks: number | undefined,
  flowField?: FlowField,
): Group {
  const group = new Group();
  group.name = 'aquascape:plants';
  const swayMaterials: MeshStandardMaterial[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    for (const obj of layer.objects) {
      if (obj.kind !== 'plant') continue;
      const entry = resolvePlantEntry(obj.ref, catalog);
      if (entry === null) continue;
      const scale = plantScale(entry.growth, obj.growth, previewAgeWeeks);
      const node =
        obj.scatter !== undefined
          ? buildScatterPatch(obj, entry, scale, scene, swayMaterials, flowField)
          : buildSingleSpecimen(obj, entry, scale, scene, layer, swayMaterials, flowField);
      if (node !== null) group.add(node);
    }
  }
  group.userData[PLANT_SWAY_MATERIALS_KEY] = swayMaterials;
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
  swayMaterials: MeshStandardMaterial[],
  flowField: FlowField | undefined,
): Mesh | null {
  const geo = buildSilhouetteGeometry(entry);
  if (geo === null) return null;
  const silhouetteHeight = entry.naturalSize.height;
  // Phase: deterministic from documentSeed + a stable per-object key. The
  // object's `id` is a string; fold it into the hash via `fnv1a32`-style
  // mixing so two plants with adjacent ids don't end up phase-aligned.
  const idHash = hashStringFnv1a32(obj.id);
  const phase = seededHash01(
    scene.seed ^ SINGLE_SPECIMEN_PHASE_SEED_MIX,
    idHash,
  ) * 2 * Math.PI;
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
  // Plant base Y for the sway formula. The plan's "amplitude proportional
  // to (1 - plant.y / tank.height)" refers to the plant's POSITION in the
  // tank, not the per-vertex Y. We use the substrate-snapped floor (which
  // is the actual height the rooted base sits at) — using the document
  // `transform.position.y` directly would give counter-intuitive results
  // for plants the 2D author placed mid-tank.
  const mat = createPlantSwayMaterial(entry.color, {
    silhouetteHeight,
    plantBaseY: floor,
    tankHeight: scene.tank.height,
    phase,
    flowAmp: flowAmpAt(flowField, clamped.x, floor, clamped.z),
  });
  swayMaterials.push(mat);
  const mesh = new Mesh(geo, mat);
  mesh.name = `aquascape:plant/${obj.id}`;
  // Plants cast + receive soft shadows. The shadow-map depth pass uses
  // Three's default depth material (no sway patch), so the shadow doesn't
  // sway with the leaves — an acceptable mismatch at typical sway amplitude.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
  swayMaterials: MeshStandardMaterial[],
  flowField: FlowField | undefined,
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
  const silhouetteHeight = entry.naturalSize.height;
  // Phase seed shared across all instances of THIS patch; the per-
  // instance hash keys disambiguate them inside the shader.
  const phaseSeed = (scene.seed ^ SCATTER_INSTANCE_PHASE_SEED_MIX ^ seed) >>> 0;
  const idHash = hashStringFnv1a32(obj.id);

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
    // Phase + plantBaseY are per-instance for the InstancedMesh path. The
    // shader reads them from `InstancedBufferAttribute`s.
    const phaseArr = new Float32Array(capped.length);
    const baseYArr = new Float32Array(capped.length);
    const flowAmpArr = new Float32Array(capped.length);
    for (let i = 0; i < capped.length; i++) {
      phaseArr[i] = seededHash01(phaseSeed, idHash, i) * 2 * Math.PI;
      const worldX = capped[i]!.position.x;
      const worldZ = capped[i]!.position.y;
      const baseY = substrateHeightAt(scene, worldX);
      baseYArr[i] = baseY;
      flowAmpArr[i] = flowAmpAt(flowField, worldX, baseY, worldZ);
    }
    const mat = createPlantSwayMaterial(entry.color, {
      silhouetteHeight,
      // For InstancedMesh the per-instance attributes drive `plantBaseY`,
      // `phase`, and `flowAmp`. The uniforms still need defaults (the
      // non-instanced shader branch is compiled out, but `onBeforeCompile`
      // returns one shader, so the uniforms have to exist).
      plantBaseY: 0,
      tankHeight: scene.tank.height,
      phase: 0,
      instanced: true,
    });
    swayMaterials.push(mat);

    const instanced = new InstancedMesh(geo, mat, capped.length);
    instanced.name = `aquascape:plant/${obj.id}`;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.geometry.setAttribute(
      'aPlantPhase',
      new InstancedBufferAttribute(phaseArr, 1),
    );
    instanced.geometry.setAttribute(
      'aPlantBaseY',
      new InstancedBufferAttribute(baseYArr, 1),
    );
    instanced.geometry.setAttribute(
      'aFlowAmp',
      new InstancedBufferAttribute(flowAmpArr, 1),
    );
    const tmpMat = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    for (let i = 0; i < capped.length; i++) {
      const inst = capped[i]!;
      const worldX = inst.position.x;
      const worldZ = inst.position.y;
      const worldY = baseYArr[i]!;
      pos.set(worldX, worldY, worldZ);
      quat.setFromAxisAngle(new Vector3(0, 1, 0), inst.rotation);
      scl.set(growthScale * inst.jitter * flipSx, growthScale * inst.jitter, growthScale);
      tmpMat.compose(pos, quat, scl);
      instanced.setMatrixAt(i, tmpMat);
    }
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }

  // Below the instancing threshold, individual meshes — but each gets
  // its OWN material so per-instance phase / plantBaseY uniforms stick.
  // Geometry is shared (we dispose via the group walk in the renderer,
  // which is safe because Three.js's dispose checks idempotently).
  const group = new Group();
  group.name = `aquascape:plant/${obj.id}`;
  for (let i = 0; i < capped.length; i++) {
    const inst = capped[i]!;
    const worldX = inst.position.x;
    const worldZ = inst.position.y;
    const worldY = substrateHeightAt(scene, worldX);
    const mat = createPlantSwayMaterial(entry.color, {
      silhouetteHeight,
      plantBaseY: worldY,
      tankHeight: scene.tank.height,
      phase: seededHash01(phaseSeed, idHash, i) * 2 * Math.PI,
      flowAmp: flowAmpAt(flowField, worldX, worldY, worldZ),
    });
    swayMaterials.push(mat);
    const mesh = new Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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

// ─── Sway material factory ──────────────────────────────────────────────

interface SwayMaterialOptions {
  silhouetteHeight: number;
  /** Used only when `instanced` is false. */
  plantBaseY: number;
  tankHeight: number;
  /** Used only when `instanced` is false. */
  phase: number;
  /** Default false (single-mesh path). When true, expects per-instance attrs. */
  instanced?: boolean;
  /**
   * Flow-coupled sway amplitude multiplier (fidelity pass). 1.0 = the
   * pre-fidelity constant sway; > 1 waves harder (in a filter outflow),
   * < 1 barely moves (dead zone). Used only when `instanced` is false; the
   * instanced path drives it per-instance via the `aFlowAmp` attribute.
   * Defaults to 1.0 so a material built without a flow field is unchanged.
   */
  flowAmp?: number;
}

/**
 * Build a `MeshStandardMaterial` whose vertex shader is patched (via
 * `onBeforeCompile`) to add a lateral sway displacement before the
 * standard PBR transform pipeline runs. Exported for tests; intended to
 * be called only from the builders above.
 *
 * Per-vertex amplitude is height-weighted: top vertices sway more, base
 * vertices barely move (the plant is rooted). Per-instance amplitude is
 * depth-weighted by the plant's substrate-Y position in the tank: lower
 * plants sway more (taller plants reaching toward the surface sway less,
 * matching how aquatic flora reads in real tanks).
 *
 * The vertex shader injects code BEFORE Three.js's standard
 * `<begin_vertex>` chunk, so the displacement lands on `transformed`
 * (Three.js's working vertex position) and the rest of the PBR pipeline
 * — normal/projection/UV — runs unchanged on the displaced position.
 */
export function createPlantSwayMaterial(
  color: string,
  opts: SwayMaterialOptions,
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color, roughness: ROUGHNESS });
  const instanced = opts.instanced === true;
  // We attach `userData.swayUniforms` synchronously so the host renderer
  // can update `uTime` even before the shader is compiled for the first
  // time (the first compile happens lazily on the first `WebGLRenderer.
  // render(...)` call). The same `IUniform` object is what `onBeforeCompile`
  // wires into the shader, so mutations made via this handle land in the
  // compiled shader the moment compile completes.
  const uTime: IUniform<number> = { value: 0 };
  // F11.7 Wave 3 — emissive boost uniform. Default 0 (noon) so a plant
  // built outside the day-night system reads as plain matte PBR. The
  // host renderer writes the current `DayNightLookup.emissiveBoost` into
  // this uniform every render call; the value lerps smoothly with phase.
  const uPlantEmissiveBoost: IUniform<number> = { value: 0 };
  mat.userData['swayUniforms'] = {
    uTime,
    uPlantEmissiveBoost,
  } satisfies PlantSwayUniforms;
  mat.userData['swayInstanced'] = instanced;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms['uTime'] = uTime;
    shader.uniforms['uPlantEmissiveBoost'] = uPlantEmissiveBoost;
    shader.uniforms['uSilhouetteHeight'] = { value: Math.max(1, opts.silhouetteHeight) };
    shader.uniforms['uTankHeight'] = { value: Math.max(1, opts.tankHeight) };
    if (!instanced) {
      shader.uniforms['uPlantBaseY'] = { value: opts.plantBaseY };
      shader.uniforms['uPhaseOffset'] = { value: opts.phase };
      // Flow-coupled sway amplitude (single-specimen). Defaults to 1.0 so a
      // material built without a flow field reproduces the pre-fidelity sway.
      shader.uniforms['uFlowAmp'] = { value: opts.flowAmp ?? 1 };
    }

    const declarations = instanced
      ? `
        uniform float uTime;
        uniform float uSilhouetteHeight;
        uniform float uTankHeight;
        attribute float aPlantPhase;
        attribute float aPlantBaseY;
        attribute float aFlowAmp;
      `
      : `
        uniform float uTime;
        uniform float uSilhouetteHeight;
        uniform float uTankHeight;
        uniform float uPlantBaseY;
        uniform float uPhaseOffset;
        uniform float uFlowAmp;
      `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n${declarations}`,
    );

    // Inject AFTER `<begin_vertex>` so `transformed` is initialised from
    // `position`. We nudge `transformed.x` only — gravity rules out Y, and
    // Z displacement reads as "the plant is breathing" rather than waving.
    //
    // `plantBaseY` is a world-Y (mm). `silhouetteHeight` is the entry's
    // natural height in mm; `position.y` is in the same local frame
    // because `buildSilhouetteGeometry` does NOT pre-scale the silhouette
    // — the mesh's `scale.y` handles growth. Using local Y vs. world Y
    // gives a vertex-height factor independent of growth scale, which is
    // what we want: a plant at 50 % growth still has its tip sway 100 %
    // and its base sway 0 %.
    const plantBaseExpr = instanced ? 'aPlantBaseY' : 'uPlantBaseY';
    const phaseExpr = instanced ? 'aPlantPhase' : 'uPhaseOffset';
    const flowAmpExpr = instanced ? 'aFlowAmp' : 'uFlowAmp';
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      {
        float plantPosFactor = clamp(1.0 - ${plantBaseExpr} / uTankHeight, 0.0, 1.0);
        float vertexHeightFactor = clamp(position.y / uSilhouetteHeight, 0.0, 1.0);
        float swayAmp = ${SWAY_MAX_MM.toFixed(4)} * plantPosFactor * vertexHeightFactor * ${flowAmpExpr};
        float swayX = swayAmp * sin(uTime * ${SWAY_FREQ_2PI.toFixed(6)} + ${phaseExpr});
        transformed.x += swayX;
      }
      `,
    );

    // F11.7 Wave 3 — emissive boost. The day-night cycle's `emissiveBoost`
    // value (≤ 0.5) is added as a green-biased tint onto the final
    // fragment colour so plants remain readable at night. The bias is
    // applied AFTER tone mapping (`<dithering_fragment>` is the very last
    // standard chunk) so the boost lands on screen-space colour, not on
    // the linear-space radiance that would then get crushed by tone
    // mapping. Boost of 0 is a true no-op.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nuniform float uPlantEmissiveBoost;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      gl_FragColor.rgb += uPlantEmissiveBoost * vec3(0.4, 0.8, 0.5);`,
    );
  };
  return mat;
}

/**
 * Advance `uTime` on every sway material attached to a plant group built
 * by `buildPlantMeshes`. Called by the host renderer's RAF tick. No-op
 * for groups built without sway (e.g. older fixtures), so it's safe to
 * call unconditionally.
 *
 * @param plantGroup the `Group` returned by `buildPlantMeshes`
 * @param timeSec    monotonically-increasing wall clock in seconds
 */
export function updatePlantSwayTime(plantGroup: Group, timeSec: number): void {
  const mats = plantGroup.userData[PLANT_SWAY_MATERIALS_KEY] as
    | MeshStandardMaterial[]
    | undefined;
  if (mats === undefined) return;
  for (const mat of mats) {
    const uniforms = mat.userData['swayUniforms'] as PlantSwayUniforms | undefined;
    if (uniforms === undefined) continue;
    uniforms.uTime.value = timeSec;
  }
}

/**
 * F11.7 Wave 3 — write the day-night `emissiveBoost` into every sway
 * material's `uPlantEmissiveBoost` uniform. Called by the host renderer
 * each `render()` (the boost lerps with the lookup, so per-render is
 * sufficient — no need to chase it on every RAF tick). No-op when the
 * group has no sway materials attached, so the unconditional call is
 * safe before the first plant mesh exists.
 *
 * @param plantGroup the `Group` returned by `buildPlantMeshes`
 * @param boost      `[0, 0.5]` — host clamps; we trust the caller
 */
export function updatePlantEmissiveBoost(plantGroup: Group, boost: number): void {
  const mats = plantGroup.userData[PLANT_SWAY_MATERIALS_KEY] as
    | MeshStandardMaterial[]
    | undefined;
  if (mats === undefined) return;
  for (const mat of mats) {
    const uniforms = mat.userData['swayUniforms'] as PlantSwayUniforms | undefined;
    if (uniforms === undefined) continue;
    uniforms.uPlantEmissiveBoost.value = boost;
  }
}

/**
 * 32-bit FNV-1a over a string. Same algorithm `hardscape-noise.ts` uses
 * for catalogId+objectId hashing; re-implemented here to avoid coupling
 * two scene-builder files. Output is a uint32 in `[0, 2^32)`.
 */
function hashStringFnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
