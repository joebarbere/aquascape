/**
 * `buildLivestockMeshes()` — Stage 11 F11.1 Wave 3.
 *
 * One `THREE.InstancedMesh` per fish archetype (six total), each backed
 * by the procedural geometry from `@aquascape/domain/fish-anatomy` and a
 * shared `ShaderMaterial` that runs the carangiform vertex shader in
 * `./shaders.ts`. The bundle exposes:
 *
 *   - `group`: a `THREE.Group` containing all six meshes. The host
 *     renderer (`renderer-3d`, Wave 4) adds this directly to its content
 *     group.
 *   - `syncFromSnapshot(snapshot, t)`: copies the latest ECS snapshot's
 *     `position` / `orientation` / `phase` / `archetype` / `scale` typed
 *     arrays into each archetype's per-instance attributes, sets
 *     `instancedMesh.count` to the bucket size, and updates `uTime`.
 *   - `dispose()`: releases every geometry + material; safe to call
 *     multiple times.
 *
 * PERFORMANCE
 * -----------
 * `syncFromSnapshot` allocates ZERO objects per frame. All scratch
 * buffers (the six per-archetype write cursors, the temporary index
 * lookup) live on the bundle and are reused. Plan budget: < 2 ms
 * render-overhead from livestock at n=200.
 *
 * DEPENDENCY BUDGET
 * -----------------
 * Allowed: `three`, `@aquascape/domain/fish-anatomy`,
 * `@aquascape/domain/livestock-ecs` (types only — `WorldSnapshot`, the
 * archetype enum). NOT `@aquascape/rendering/renderer-3d` (would invert
 * the dependency — the renderer is the *host*; this lib is one of its
 * scene-builder seams).
 */

import {
  buildBarbGeometry,
  buildCoryCylinderGeometry,
  buildDeepBodiedGeometry,
  buildEelGeometry,
  buildHatchetWedgeGeometry,
  buildSlimTetraGeometry,
  type FishGeometryDescriptor,
} from '@aquascape/domain/fish-anatomy';
import { FISH_ARCHETYPE, type WorldSnapshot } from '@aquascape/domain/livestock-ecs';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { LIVESTOCK_FRAGMENT_SHADER, LIVESTOCK_VERTEX_SHADER } from './shaders';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Bundle returned by `buildLivestockMeshes`. Mount `group` into the
 * renderer's content group; call `syncFromSnapshot` every RAF tick;
 * call `dispose` once on renderer teardown.
 */
export interface LivestockMeshBundle {
  /** Container that holds one `InstancedMesh` per archetype. */
  group: Group;
  /**
   * Copy the latest snapshot's per-entity attributes into the matching
   * `InstancedBufferAttribute`s and advance the shader's time uniform.
   *
   * `currentTimeSec` is treated as a continuous clock — the vertex
   * shader uses `uTime * freq` so a monotonically-increasing wall
   * clock produces a stable swim cadence regardless of how often
   * this method is called.
   */
  syncFromSnapshot(snapshot: WorldSnapshot, currentTimeSec: number): void;
  /** Release every geometry + material. Idempotent. */
  dispose(): void;
}

export interface BuildLivestockMeshesOpts {
  /**
   * Per-archetype instance cap. The `InstancedBufferAttribute` arrays
   * are sized to this value at construction; entities of an archetype
   * beyond the cap are silently dropped (with a one-time
   * `console.warn`). Defaults to 256 — generous for hobbyist tanks
   * (a 200-litre community planted tank rarely tops 50 fish of any
   * single species).
   */
  maxInstancesPerArchetype?: number;
  /**
   * Default body colour applied to every archetype when no catalog
   * `colorHex` is available. F11.6 will read per-species colour from
   * the catalog and call a future `setArchetypeColor(...)` API.
   */
  defaultBodyColor?: ColorRepresentation;
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_INSTANCES = 256;

/** Silver-tetra blue — neutral, reads on every aquascape backdrop. */
const DEFAULT_BODY_COLOR = 0x9ec5d6;

/** Tail-beat frequency default (Hz) — calm cruise. Matches `ecs/world.ts`. */
const DEFAULT_TAIL_BEAT_FREQ = 4;
/** Amplitude at the head — small wobble. */
const DEFAULT_AMP_HEAD = 0.02;
/** Amplitude at the tail tip — main thrust. */
const DEFAULT_AMP_TAIL = 0.12;
/** Power-curve exponent shaping the head→tail amplitude ramp. */
const DEFAULT_ENVELOPE_EXP = 2.5;

/** Stable iteration order — index = `FISH_ARCHETYPE.*` value. */
const ARCHETYPE_IDS = [
  FISH_ARCHETYPE.SLIM_TETRA,
  FISH_ARCHETYPE.DEEP_BODIED,
  FISH_ARCHETYPE.BARB,
  FISH_ARCHETYPE.CORY_CYLINDER,
  FISH_ARCHETYPE.EEL,
  FISH_ARCHETYPE.HATCHET_WEDGE,
] as const;

/** Human-readable name on the InstancedMesh for `disposeNode` debug walks. */
const ARCHETYPE_LABELS: Record<number, string> = {
  [FISH_ARCHETYPE.SLIM_TETRA]: 'slim-tetra',
  [FISH_ARCHETYPE.DEEP_BODIED]: 'deep-bodied',
  [FISH_ARCHETYPE.BARB]: 'barb',
  [FISH_ARCHETYPE.CORY_CYLINDER]: 'cory-cylinder',
  [FISH_ARCHETYPE.EEL]: 'eel',
  [FISH_ARCHETYPE.HATCHET_WEDGE]: 'hatchet-wedge',
};

// ─── Internal types ──────────────────────────────────────────────────────

/**
 * Per-archetype slot — owns the mesh + the typed-array views into its
 * `InstancedBufferAttribute`s. The `bufferIndex` field is reused as a
 * write cursor inside `syncFromSnapshot` to avoid a per-frame
 * allocation.
 */
interface ArchetypeSlot {
  archetypeId: number;
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  /** Live typed arrays backing each instanced attribute (stride implicit). */
  attr: {
    instancePosition: InstancedBufferAttribute;
    instanceQuat: InstancedBufferAttribute;
    instanceScale: InstancedBufferAttribute;
    instancePhase: InstancedBufferAttribute;
    instanceTailBeatFreq: InstancedBufferAttribute;
    instanceAmpHead: InstancedBufferAttribute;
    instanceAmpTail: InstancedBufferAttribute;
  };
  /**
   * Write cursor inside `syncFromSnapshot`. Reset to 0 each frame and
   * incremented as we fill the per-archetype bucket — never read from
   * outside `syncFromSnapshot`.
   */
  writeCursor: number;
  /** Cached so we can warn-once on overflow without polluting the host. */
  overflowWarned: boolean;
}

// ─── Factory ─────────────────────────────────────────────────────────────

/**
 * Build the six-archetype InstancedMesh bundle. Idempotency-safe —
 * each call returns a fresh bundle with no shared mutable state.
 */
export function buildLivestockMeshes(opts: BuildLivestockMeshesOpts = {}): LivestockMeshBundle {
  const maxInstances = opts.maxInstancesPerArchetype ?? DEFAULT_MAX_INSTANCES;
  if (!Number.isFinite(maxInstances) || maxInstances <= 0) {
    throw new Error(
      `buildLivestockMeshes: maxInstancesPerArchetype must be a positive finite number, got ${String(
        opts.maxInstancesPerArchetype,
      )}`,
    );
  }

  const bodyColor = new Color(opts.defaultBodyColor ?? DEFAULT_BODY_COLOR);

  const group = new Group();
  group.name = 'aquascape:livestock';

  // Slots indexed by `FISH_ARCHETYPE.*` value — lookup is O(1) without
  // a Map allocation (six tiny ids).
  const slots: ArchetypeSlot[] = new Array(ARCHETYPE_IDS.length);

  for (const archetypeId of ARCHETYPE_IDS) {
    const descriptor = descriptorForArchetype(archetypeId);
    const slot = buildArchetypeSlot(archetypeId, descriptor, maxInstances, bodyColor);
    slots[archetypeId] = slot;
    group.add(slot.mesh);
  }

  let disposed = false;

  const bundle: LivestockMeshBundle = {
    group,

    syncFromSnapshot(snapshot: WorldSnapshot, currentTimeSec: number): void {
      if (disposed) return;
      syncFromSnapshotImpl(slots, snapshot, currentTimeSec);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) {
        if (slot === undefined) continue;
        // Remove from the group first so nothing keeps rendering a
        // detached mesh.
        group.remove(slot.mesh);
        slot.geometry.dispose();
        slot.material.dispose();
        // InstancedMesh itself has a `dispose()` (since r142) that
        // releases its internal instance matrix attribute. We don't
        // populate that matrix (we drive `gl_Position` via custom
        // instanced attributes in the vertex shader), but call it
        // anyway for completeness.
        slot.mesh.dispose();
      }
    },
  };

  return bundle;
}

// ─── syncFromSnapshot ────────────────────────────────────────────────────

function syncFromSnapshotImpl(
  slots: ArchetypeSlot[],
  snapshot: WorldSnapshot,
  currentTimeSec: number,
): void {
  // Reset write cursors. Constant-time pass over six entries.
  for (const slot of slots) {
    if (slot === undefined) continue;
    slot.writeCursor = 0;
  }

  const { entityCount, position, orientation, phase, archetype, scale } = snapshot;

  // One pass over the snapshot. Each entity's archetype byte routes
  // it into the correct bucket. Branchless except for the cap check.
  for (let i = 0; i < entityCount; i++) {
    const arch = archetype[i] as number;
    const slot = slots[arch];
    if (slot === undefined) continue;

    const cursor = slot.writeCursor;
    if (cursor >= slot.mesh.instanceMatrix.count) {
      // The InstancedBufferAttribute capacity is the same as
      // `instanceMatrix.count` (we passed `maxInstances` to the
      // InstancedMesh constructor — three sizes its internal matrix
      // attribute to that). One-time warn so test logs stay quiet.
      if (!slot.overflowWarned) {
        slot.overflowWarned = true;
        console.warn(
          `[livestock-renderer-3d] archetype ${ARCHETYPE_LABELS[arch] ?? arch} ` +
            `exceeded maxInstancesPerArchetype (${slot.mesh.instanceMatrix.count}); ` +
            `dropping additional instances`,
        );
      }
      continue;
    }

    const posArr = slot.attr.instancePosition.array as Float32Array;
    posArr[cursor * 3 + 0] = position[i * 3 + 0] as number;
    posArr[cursor * 3 + 1] = position[i * 3 + 1] as number;
    posArr[cursor * 3 + 2] = position[i * 3 + 2] as number;

    const quatArr = slot.attr.instanceQuat.array as Float32Array;
    quatArr[cursor * 4 + 0] = orientation[i * 4 + 0] as number;
    quatArr[cursor * 4 + 1] = orientation[i * 4 + 1] as number;
    quatArr[cursor * 4 + 2] = orientation[i * 4 + 2] as number;
    quatArr[cursor * 4 + 3] = orientation[i * 4 + 3] as number;

    (slot.attr.instanceScale.array as Float32Array)[cursor] = scale[i] as number;
    (slot.attr.instancePhase.array as Float32Array)[cursor] = phase[i] as number;

    slot.writeCursor = cursor + 1;
  }

  // Commit per-archetype counts + attribute updates. Six slots; each
  // does at most seven `needsUpdate = true` flag flips. No
  // allocations.
  for (const slot of slots) {
    if (slot === undefined) continue;
    slot.mesh.count = slot.writeCursor;
    slot.attr.instancePosition.needsUpdate = true;
    slot.attr.instanceQuat.needsUpdate = true;
    slot.attr.instanceScale.needsUpdate = true;
    slot.attr.instancePhase.needsUpdate = true;
    // freq / ampHead / ampTail stay constant in F11.1 — F11.2+ will
    // touch them from catalog `behavior.animation`. We don't flag
    // their attributes as needing an update unless the values
    // actually change, sparing the GPU upload.
    slot.material.uniforms['uTime']!.value = currentTimeSec;
  }
}

// ─── Geometry + slot construction ────────────────────────────────────────

function descriptorForArchetype(archetypeId: number): FishGeometryDescriptor {
  switch (archetypeId) {
    case FISH_ARCHETYPE.SLIM_TETRA:
      return buildSlimTetraGeometry();
    case FISH_ARCHETYPE.DEEP_BODIED:
      return buildDeepBodiedGeometry();
    case FISH_ARCHETYPE.BARB:
      return buildBarbGeometry();
    case FISH_ARCHETYPE.CORY_CYLINDER:
      return buildCoryCylinderGeometry();
    case FISH_ARCHETYPE.EEL:
      return buildEelGeometry();
    case FISH_ARCHETYPE.HATCHET_WEDGE:
      return buildHatchetWedgeGeometry();
    default:
      // Defensive: every value in `ARCHETYPE_IDS` is handled above.
      // If a future archetype enum value is added without a builder,
      // this branch surfaces the gap loudly.
      throw new Error(`buildLivestockMeshes: no builder for archetype ${archetypeId}`);
  }
}

function buildArchetypeSlot(
  archetypeId: number,
  descriptor: FishGeometryDescriptor,
  maxInstances: number,
  bodyColor: Color,
): ArchetypeSlot {
  const geometry = makeGeometry(descriptor);
  const material = makeMaterial(bodyColor);
  const mesh = new InstancedMesh(geometry, material, maxInstances);
  mesh.name = `aquascape:livestock/${ARCHETYPE_LABELS[archetypeId] ?? archetypeId}`;
  // Start with zero instances — `syncFromSnapshot` raises this to the
  // bucket size each frame.
  mesh.count = 0;
  // Per-archetype frustum culling is unreliable (instances can move
  // anywhere inside the tank, so the InstancedMesh's bounding-box
  // never includes them). Disable so meshes aren't dropped after the
  // camera pans.
  mesh.frustumCulled = false;

  const attr = attachInstanceAttributes(geometry, maxInstances);

  return {
    archetypeId,
    mesh,
    geometry,
    material,
    attr,
    writeCursor: 0,
    overflowWarned: false,
  };
}

function makeGeometry(descriptor: FishGeometryDescriptor): BufferGeometry {
  const geo = new BufferGeometry();

  // Per-vertex attributes (NOT instanced).
  geo.setAttribute('position', new BufferAttribute(descriptor.positions, 3));
  geo.setAttribute('normal', new BufferAttribute(descriptor.normals, 3));
  geo.setAttribute('uv', new BufferAttribute(descriptor.uvs, 2));
  // `spineUv` is stride-2 (the body builder stores `(s, 0)` per vertex —
  // see `body-builder.ts:230`). The shader reads only `.x` but we keep
  // the second channel reserved per `FishGeometryDescriptor`'s docs.
  geo.setAttribute('spineUv', new BufferAttribute(descriptor.spineUv, 2));

  geo.setIndex(new BufferAttribute(descriptor.indices, 1));

  // Record the named fin / body groups so a future per-fin material
  // pass can target each region without re-walking the buffer. For
  // F11.1 we attach one material across the whole mesh — three
  // ignores the groups when `material` is a single Material — but the
  // group metadata stays on the geometry for F11.6.
  const g = descriptor.groups;
  geo.addGroup(g.body[0], g.body[1], 0);
  geo.addGroup(g.caudal[0], g.caudal[1], 1);
  geo.addGroup(g.dorsal[0], g.dorsal[1], 2);
  geo.addGroup(g.anal[0], g.anal[1], 3);
  geo.addGroup(g.pectoral[0], g.pectoral[1], 4);

  return geo;
}

function makeMaterial(bodyColor: Color): ShaderMaterial {
  // Directional light direction: front-top-right unit vector, matching
  // `renderer-3d/scene-builder/lighting.ts`'s key-light placement
  // (front of the tank, high up, slightly to the right). Cone-rolled
  // here rather than imported so this lib stays independent of the
  // host renderer.
  const dir = new Vector3(0.7, 1.8, -1.2).normalize();

  return new ShaderMaterial({
    vertexShader: LIVESTOCK_VERTEX_SHADER,
    fragmentShader: LIVESTOCK_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uEnvelopeExp: { value: DEFAULT_ENVELOPE_EXP },
      uBodyColor: { value: bodyColor.clone() },
      uAmbientColor: { value: new Color(0xffffff).multiplyScalar(0.55) },
      uDirectionalDir: { value: dir },
      uDirectionalColor: { value: new Color(0xffffff).multiplyScalar(0.45) },
    },
    // Fish are opaque; depth-write keeps the carangiform displacement
    // from breaking against the water surface's transparent blend
    // (when F11.7 lands).
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
}

function attachInstanceAttributes(
  geometry: BufferGeometry,
  maxInstances: number,
): ArchetypeSlot['attr'] {
  const instancePosition = makeInstancedAttr(maxInstances, 3);
  const instanceQuat = makeInstancedAttr(maxInstances, 4, /* identity quat */ (a) => {
    for (let i = 0; i < maxInstances; i++) {
      a[i * 4 + 0] = 0;
      a[i * 4 + 1] = 0;
      a[i * 4 + 2] = 0;
      a[i * 4 + 3] = 1;
    }
  });
  const instanceScale = makeInstancedAttr(maxInstances, 1, (a) => a.fill(1));
  const instancePhase = makeInstancedAttr(maxInstances, 1);
  const instanceTailBeatFreq = makeInstancedAttr(maxInstances, 1, (a) =>
    a.fill(DEFAULT_TAIL_BEAT_FREQ),
  );
  const instanceAmpHead = makeInstancedAttr(maxInstances, 1, (a) => a.fill(DEFAULT_AMP_HEAD));
  const instanceAmpTail = makeInstancedAttr(maxInstances, 1, (a) => a.fill(DEFAULT_AMP_TAIL));

  geometry.setAttribute('instancePosition', instancePosition);
  geometry.setAttribute('instanceQuat', instanceQuat);
  geometry.setAttribute('instanceScale', instanceScale);
  geometry.setAttribute('instancePhase', instancePhase);
  geometry.setAttribute('instanceTailBeatFreq', instanceTailBeatFreq);
  geometry.setAttribute('instanceAmpHead', instanceAmpHead);
  geometry.setAttribute('instanceAmpTail', instanceAmpTail);

  return {
    instancePosition,
    instanceQuat,
    instanceScale,
    instancePhase,
    instanceTailBeatFreq,
    instanceAmpHead,
    instanceAmpTail,
  };
}

function makeInstancedAttr(
  count: number,
  itemSize: number,
  initializer?: (a: Float32Array) => void,
): InstancedBufferAttribute {
  const buf = new Float32Array(count * itemSize);
  if (initializer !== undefined) initializer(buf);
  const attr = new InstancedBufferAttribute(buf, itemSize);
  attr.setUsage(DynamicDrawUsage);
  return attr;
}
