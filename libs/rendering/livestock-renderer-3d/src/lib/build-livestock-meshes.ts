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
  buildCrawlerGeometry,
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
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  LIVESTOCK_BUBBLE_FRAGMENT_SHADER,
  LIVESTOCK_BUBBLE_VERTEX_SHADER,
  LIVESTOCK_FOOD_FRAGMENT_SHADER,
  LIVESTOCK_FOOD_VERTEX_SHADER,
  LIVESTOCK_FRAGMENT_SHADER,
  LIVESTOCK_VERTEX_SHADER,
} from './shaders';

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Bundle returned by `buildLivestockMeshes`. Mount `group` into the
 * renderer's content group; call `syncFromSnapshot` every RAF tick;
 * call `dispose` once on renderer teardown.
 */
export interface LivestockMeshBundle {
  /**
   * Container that holds one `InstancedMesh` per archetype, plus a
   * seventh InstancedMesh for food-sprite billboards (F11.4 Wave 4)
   * and an eighth for bubble-stream billboards (F11.5 Wave 5).
   */
  group: Group;
  /**
   * Direct handle to the food-sprite billboard `InstancedMesh`.
   * Exposed so tests + future feeders can inspect / replace it without
   * walking the group's children. The mesh's `count` is driven by
   * `syncFromSnapshot` from `WorldSnapshot.foodSpriteCount`.
   */
  foodSpriteMesh: InstancedMesh;
  /**
   * Direct handle to the bubble billboard `InstancedMesh` (F11.5).
   * Drained from `WorldSnapshot.bubblePosition` each tick. Exposed for
   * tests + future bubble-stream sources (powerheads, aerators).
   */
  bubbleMesh: InstancedMesh;
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
  /**
   * Food-sprite instance cap (F11.4 Wave 4). The "Feed tank" command
   * spawns 3–6 sprites at a time and each despawns after 30 s, so even
   * impatient clicking won't approach this cap. Defaults to 64.
   */
  maxFoodSprites?: number;
  /**
   * Food-flake colour applied to every sprite. Defaults to a warm tan
   * (`0xd9a86c`) that reads against any backdrop.
   */
  foodColor?: ColorRepresentation;
  /**
   * Bubble-billboard instance cap (F11.5 Wave 5). The plan budgets up
   * to ~200 bubbles per active stone; 256 covers the common single-
   * stone case with margin. The bubble fragment shader colours each
   * instance directly (no body-colour uniform).
   */
  maxBubbles?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_MAX_INSTANCES = 256;

/** Silver-tetra blue — neutral, reads on every aquascape backdrop. */
const DEFAULT_BODY_COLOR = 0x9ec5d6;

/**
 * Food-sprite instance cap. Service spawns 3–6 per Feed-tank click,
 * each lives 30 s — 64 is roughly 10–20 simultaneous clicks of buffer.
 */
const DEFAULT_MAX_FOOD_SPRITES = 64;

/** Warm tan — reads as flake food against any aquascape backdrop. */
const DEFAULT_FOOD_COLOR = 0xd9a86c;

/** Food flake side length in mm. ~5mm matches real flake food. */
const FOOD_SPRITE_SIZE_MM = 5;

/**
 * Bubble billboard cap. F11.5 plan budgets ~200 bubbles max per active
 * bubble stone; 256 covers the common single-stone case with headroom.
 */
const DEFAULT_MAX_BUBBLES = 256;

/** Bubble quad side length in mm — smaller than food flakes (~3mm). */
const BUBBLE_SPRITE_SIZE_MM = 3;

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
  FISH_ARCHETYPE.CRAWLER,
] as const;

/** Human-readable name on the InstancedMesh for `disposeNode` debug walks. */
const ARCHETYPE_LABELS: Record<number, string> = {
  [FISH_ARCHETYPE.SLIM_TETRA]: 'slim-tetra',
  [FISH_ARCHETYPE.DEEP_BODIED]: 'deep-bodied',
  [FISH_ARCHETYPE.BARB]: 'barb',
  [FISH_ARCHETYPE.CORY_CYLINDER]: 'cory-cylinder',
  [FISH_ARCHETYPE.EEL]: 'eel',
  [FISH_ARCHETYPE.HATCHET_WEDGE]: 'hatchet-wedge',
  [FISH_ARCHETYPE.CRAWLER]: 'crawler',
};

// ─── Internal types ──────────────────────────────────────────────────────

/**
 * Food-sprite slot — owns the single billboard `InstancedMesh` + its
 * `instancePosition` attribute. Mirrors `ArchetypeSlot`'s shape so the
 * dispose path can iterate uniformly.
 */
interface FoodSpriteSlot {
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  instancePosition: InstancedBufferAttribute;
  /** Capacity = max sprites the attribute can hold. */
  capacity: number;
  /** One-time overflow warn flag — mirrors the fish-bucket pattern. */
  overflowWarned: boolean;
}

/**
 * Bubble billboard slot (F11.5 Wave 5). Same shape as
 * `FoodSpriteSlot` — independent slot so dispose / sync can iterate
 * each one without conditional bookkeeping.
 */
interface BubbleSlot {
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  instancePosition: InstancedBufferAttribute;
  /** Capacity = max bubbles the attribute can hold. */
  capacity: number;
  /** One-time overflow warn flag. */
  overflowWarned: boolean;
}

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
    instanceColor: InstancedBufferAttribute;
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

  const maxFoodSprites = opts.maxFoodSprites ?? DEFAULT_MAX_FOOD_SPRITES;
  if (!Number.isFinite(maxFoodSprites) || maxFoodSprites <= 0) {
    throw new Error(
      `buildLivestockMeshes: maxFoodSprites must be a positive finite number, got ${String(
        opts.maxFoodSprites,
      )}`,
    );
  }

  const maxBubbles = opts.maxBubbles ?? DEFAULT_MAX_BUBBLES;
  if (!Number.isFinite(maxBubbles) || maxBubbles <= 0) {
    throw new Error(
      `buildLivestockMeshes: maxBubbles must be a positive finite number, got ${String(
        opts.maxBubbles,
      )}`,
    );
  }

  const bodyColor = new Color(opts.defaultBodyColor ?? DEFAULT_BODY_COLOR);
  const foodColor = new Color(opts.foodColor ?? DEFAULT_FOOD_COLOR);

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

  // 7th InstancedMesh — food-sprite billboards (F11.4 Wave 4). Added
  // as a sibling under the same group so `disposeNode` walks find it
  // alongside the archetype meshes.
  const foodSlot = buildFoodSpriteSlot(maxFoodSprites, foodColor);
  group.add(foodSlot.mesh);

  // 8th InstancedMesh — bubble billboards (F11.5 Wave 5). Same sibling
  // pattern as the food sprite slot.
  const bubbleSlot = buildBubbleSlot(maxBubbles);
  group.add(bubbleSlot.mesh);

  let disposed = false;

  const bundle: LivestockMeshBundle = {
    group,
    foodSpriteMesh: foodSlot.mesh,
    bubbleMesh: bubbleSlot.mesh,

    syncFromSnapshot(snapshot: WorldSnapshot, currentTimeSec: number): void {
      if (disposed) return;
      syncFromSnapshotImpl(slots, snapshot, currentTimeSec);
      syncFoodSpritesImpl(foodSlot, snapshot);
      syncBubblesImpl(bubbleSlot, snapshot);
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
      // Release the food-sprite slot the same way.
      group.remove(foodSlot.mesh);
      foodSlot.geometry.dispose();
      foodSlot.material.dispose();
      foodSlot.mesh.dispose();
      // Release the bubble slot.
      group.remove(bubbleSlot.mesh);
      bubbleSlot.geometry.dispose();
      bubbleSlot.material.dispose();
      bubbleSlot.mesh.dispose();
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

  const { entityCount, position, orientation, phase, archetype, scale, color } = snapshot;

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

    const colArr = slot.attr.instanceColor.array as Float32Array;
    colArr[cursor * 3 + 0] = color[i * 3 + 0] as number;
    colArr[cursor * 3 + 1] = color[i * 3 + 1] as number;
    colArr[cursor * 3 + 2] = color[i * 3 + 2] as number;

    // F11.6 Wave 2 — crawler archetype (shrimp + snail) has no
    // carangiform tail to flex. Zero its per-instance amp on every
    // sync so the vertex shader produces no fish-style wiggle even if
    // the AnimationPhase slab carries a non-zero phase (which it does
    // — AnimationSystem advances it for every entity, since gating
    // there would require an archetype-aware branch in the hottest
    // per-frame loop). Cheaper to suppress at the per-instance amp.
    if (arch === FISH_ARCHETYPE.CRAWLER) {
      (slot.attr.instanceAmpHead.array as Float32Array)[cursor] = 0;
      (slot.attr.instanceAmpTail.array as Float32Array)[cursor] = 0;
    }

    slot.writeCursor = cursor + 1;
  }

  // Commit per-archetype counts + attribute updates. Seven slots; each
  // does at most seven `needsUpdate = true` flag flips. No
  // allocations.
  for (const slot of slots) {
    if (slot === undefined) continue;
    slot.mesh.count = slot.writeCursor;
    slot.attr.instancePosition.needsUpdate = true;
    slot.attr.instanceQuat.needsUpdate = true;
    slot.attr.instanceScale.needsUpdate = true;
    slot.attr.instancePhase.needsUpdate = true;
    slot.attr.instanceColor.needsUpdate = true;
    // The crawler slot rewrites ampHead/ampTail every tick (to keep
    // the carangiform deformation suppressed for crawler instances —
    // see the per-entity write above). Flag its amp attributes as
    // dirty so the GPU sees the zero values; other archetypes keep
    // their construction-time defaults and don't need a re-upload.
    if (slot.archetypeId === FISH_ARCHETYPE.CRAWLER) {
      slot.attr.instanceAmpHead.needsUpdate = true;
      slot.attr.instanceAmpTail.needsUpdate = true;
    }
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
    case FISH_ARCHETYPE.CRAWLER:
      return buildCrawlerGeometry();
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

  const attr = attachInstanceAttributes(geometry, maxInstances, bodyColor);

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
  // `spineUv` is stride-2. `.x` is the nose→tail spine coordinate; `.y`
  // carries the per-vertex FIN_TYPE code (body 0, caudal 1, dorsal 2,
  // anal 3, pectoral 4), PACKED here from `descriptor.finType`. The
  // domain descriptor authors `spineUv.y = 0` everywhere and keeps
  // `finType` as its own buffer — but the shader program sits at
  // ANGLE/SwiftShader's MAX_VERTEX_ATTRIBS = 16 budget (three's prefix
  // declares position + normal + uv + the 4-slot instanceMatrix = 7;
  // our 9 custom attributes make 16 — DECLARED attributes count against
  // the limit on that translator, active or not). Declaring a 17th
  // `finType` attribute fails program linking ("Too many attributes")
  // and NO fish render, so the code rides the spare `spineUv.y` channel
  // instead. The vertex shader's FIN FLUTTER block decodes it from there.
  geo.setAttribute('spineUv', new BufferAttribute(packFinTypeIntoSpineUv(descriptor), 2));

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

/**
 * Interleave `descriptor.finType` into the second channel of a copy of
 * `descriptor.spineUv`. The domain buffer authors `(s, 0)` per vertex, so
 * the packed result is `(s, finTypeCode)` — codes are small integers
 * (0–4), which keeps the fragment shader's scale-shimmer term (driven by
 * `fract(spineUv.y)`) exactly as inert as it was when the channel was a
 * constant 0. Returns a fresh array; the descriptor's buffers are shared
 * across bundles and must not be mutated.
 */
function packFinTypeIntoSpineUv(descriptor: FishGeometryDescriptor): Float32Array {
  const packed = new Float32Array(descriptor.spineUv);
  for (let i = 0; i < descriptor.finType.length; i++) {
    packed[i * 2 + 1] = descriptor.finType[i] as number;
  }
  return packed;
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
  bodyColor: Color,
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
  // Fidelity pass — per-instance body colour, initialised to the build-time
  // default so any un-synced (but somehow drawn) instance isn't black.
  const instanceColor = makeInstancedAttr(maxInstances, 3, (a) => {
    for (let i = 0; i < maxInstances; i++) {
      a[i * 3 + 0] = bodyColor.r;
      a[i * 3 + 1] = bodyColor.g;
      a[i * 3 + 2] = bodyColor.b;
    }
  });

  geometry.setAttribute('instancePosition', instancePosition);
  geometry.setAttribute('instanceQuat', instanceQuat);
  geometry.setAttribute('instanceScale', instanceScale);
  geometry.setAttribute('instancePhase', instancePhase);
  geometry.setAttribute('instanceTailBeatFreq', instanceTailBeatFreq);
  geometry.setAttribute('instanceAmpHead', instanceAmpHead);
  geometry.setAttribute('instanceAmpTail', instanceAmpTail);
  geometry.setAttribute('instanceColor', instanceColor);

  return {
    instancePosition,
    instanceQuat,
    instanceScale,
    instancePhase,
    instanceTailBeatFreq,
    instanceAmpHead,
    instanceAmpTail,
    instanceColor,
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

// ─── Food sprite slot (F11.4 Wave 4) ─────────────────────────────────────

function buildFoodSpriteSlot(maxFoodSprites: number, foodColor: Color): FoodSpriteSlot {
  // A single 5mm × 5mm quad — billboarded camera-facing in the vertex
  // shader, so the actual orientation in object space doesn't matter.
  // `PlaneGeometry` gives us 4 vertices + 2 triangles + UVs that run
  // (0,0) bottom-left through (1,1) top-right, which the fragment
  // shader uses for the circular-flake alpha falloff.
  const geometry = new PlaneGeometry(FOOD_SPRITE_SIZE_MM, FOOD_SPRITE_SIZE_MM);

  const instancePosition = makeInstancedAttr(maxFoodSprites, 3);
  geometry.setAttribute('instancePosition', instancePosition);

  const material = new ShaderMaterial({
    vertexShader: LIVESTOCK_FOOD_VERTEX_SHADER,
    fragmentShader: LIVESTOCK_FOOD_FRAGMENT_SHADER,
    uniforms: {
      uFoodColor: { value: foodColor.clone() },
    },
    // Sprites need alpha (soft circular falloff). DoubleSide because
    // the billboard math doesn't compute a consistent face normal —
    // either face could end up toward the camera depending on quad
    // orientation in world space (which the X-mirror flips).
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geometry, material, maxFoodSprites);
  mesh.name = 'aquascape:livestock/food-sprite';
  mesh.count = 0;
  // Instances can land anywhere inside the tank as food falls; the
  // InstancedMesh's own bounding box doesn't account for that.
  mesh.frustumCulled = false;

  return {
    mesh,
    geometry,
    material,
    instancePosition,
    capacity: maxFoodSprites,
    overflowWarned: false,
  };
}

function syncFoodSpritesImpl(slot: FoodSpriteSlot, snapshot: WorldSnapshot): void {
  const requested = snapshot.foodSpriteCount;
  const cap = slot.capacity;

  // Clamp + warn-once if the ECS world somehow exposes more sprites
  // than the renderer reserved capacity for. Defensive — the world
  // has its own pool growth + the service spawns small batches.
  let n = requested;
  if (n > cap) {
    n = cap;
    if (!slot.overflowWarned) {
      slot.overflowWarned = true;
      console.warn(
        `[livestock-renderer-3d] food sprite count (${requested}) exceeds maxFoodSprites (${cap}); ` +
          `dropping additional sprites`,
      );
    }
  }

  const dst = slot.instancePosition.array as Float32Array;
  const src = snapshot.foodSpritePosition;
  // Copy n × 3 floats. `Float32Array.set` with a clamped subarray is
  // allocation-free under V8 / JSC.
  if (n > 0) {
    dst.set(src.subarray(0, n * 3));
    slot.instancePosition.needsUpdate = true;
  }
  // Three.js skips the draw cleanly when count is 0; no need to clear
  // the attribute data (stale values won't render).
  slot.mesh.count = n;
}

// ─── Bubble slot (F11.5 Wave 5) ──────────────────────────────────────────

function buildBubbleSlot(maxBubbles: number): BubbleSlot {
  // 3mm × 3mm quad — smaller than food flakes (~5mm) so a stream of
  // ~200 bubbles still reads as fine-grained against any aquascape.
  const geometry = new PlaneGeometry(BUBBLE_SPRITE_SIZE_MM, BUBBLE_SPRITE_SIZE_MM);

  const instancePosition = makeInstancedAttr(maxBubbles, 3);
  geometry.setAttribute('instancePosition', instancePosition);

  const material = new ShaderMaterial({
    vertexShader: LIVESTOCK_BUBBLE_VERTEX_SHADER,
    fragmentShader: LIVESTOCK_BUBBLE_FRAGMENT_SHADER,
    uniforms: {
      // No body-colour uniform: the bubble fragment shader hard-codes
      // the blue-white tone + the highlight anchor so every bubble
      // reads identically. F11.6 could lift this to a uniform if
      // tinted bubbles (CO2 vs air) become a thing.
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geometry, material, maxBubbles);
  mesh.name = 'aquascape:livestock/bubble';
  mesh.count = 0;
  // Bubbles drift anywhere from the source upward; bounding box of the
  // mesh itself can't track that.
  mesh.frustumCulled = false;

  return {
    mesh,
    geometry,
    material,
    instancePosition,
    capacity: maxBubbles,
    overflowWarned: false,
  };
}

function syncBubblesImpl(slot: BubbleSlot, snapshot: WorldSnapshot): void {
  // Defensive: the parallel agent extends WorldSnapshot with these
  // fields. If a stale snapshot (e.g. a fixture from an older test)
  // omits them, treat as zero rather than crashing — the renderer's
  // job is to drain whatever the world exposes.
  const requested = snapshot.bubbleCount ?? 0;
  const src = snapshot.bubblePosition;
  if (src === undefined) {
    slot.mesh.count = 0;
    return;
  }

  const cap = slot.capacity;
  let n = requested;
  if (n > cap) {
    n = cap;
    if (!slot.overflowWarned) {
      slot.overflowWarned = true;
      console.warn(
        `[livestock-renderer-3d] bubble count (${requested}) exceeds maxBubbles (${cap}); ` +
          `dropping additional bubbles`,
      );
    }
  }

  const dst = slot.instancePosition.array as Float32Array;
  if (n > 0) {
    dst.set(src.subarray(0, n * 3));
    slot.instancePosition.needsUpdate = true;
  }
  slot.mesh.count = n;
}
