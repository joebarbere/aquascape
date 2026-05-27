// Stage 11 F11.2 Wave 5 + F11.3 — owns the bitECS world that the 3D
// renderer's RAF loop steps + drains each frame, wires the
// schooling/depth behaviour pipeline (ResolvedBehavior + ParamStore +
// tankAabb) into the world, AND registers hardscape entries so the
// world's auto-anchor assignment at spawn time has something to look at.
//
// RESPONSIBILITIES
// ----------------
// 1. Lazily build a `LivestockWorld` seeded from `scene.seed` on first
//    `getWorld()` (the 3D renderer asks for it on its first paint). The
//    world is constructed with the scene's tank interior AABB.
// 2. Subscribe to NgRx scene emissions: when `scene.livestock` (or the
//    seed, tank, or hardscape) changes, re-spawn every entity
//    deterministically. Same `(seed, livestock, hardscape)` triple →
//    identical entity counts + initial positions + anchor assignments
//    across two re-spawns.
// 3. PERSIST the world across 2D↔3D toggles. The renderer's `dispose()`
//    drops its bundle and its reference to the world, but the service
//    keeps the same `LivestockWorld` instance alive. The next 3D switch
//    builds a fresh bundle and connects it to the existing world.
// 4. F11.2: For each unique catalog row referenced in `scene.livestock`,
//    resolve a `ResolvedBehavior` via `resolveBehavior()` and register
//    it on the world's ParamStore. The returned `handleIdx` is passed
//    through to every spawned entity for that species, and the species'
//    animation params (tailBeatFreq / ampHead / ampTail) come straight
//    off the resolved behaviour — no hardcoded F11.1 defaults.
// 5. F11.2: Push the tank interior AABB through to the world on every
//    spawn pass via `setTankAabb`, so DepthSystem + SteeringIntegrator
//    + the post-Kinematic clamp track tank resizes without a world rebuild.
// 6. F11.3: Walk `scene.layers[].objects` for `kind === 'hardscape'` items
//    in document order, build a `HardscapeRegistrationEntry[]` from the
//    LOADED catalog row (coverScore + category are already defaulted by
//    the catalog loader — do NOT re-default here), and call
//    `world.registerHardscape(...)` BEFORE `spawnAll`. The world's
//    `spawnFish` auto-picks the nearest hardscape within
//    `2 * coreRadius` of the spawn position as the Territory anchor for
//    any species whose resolved behaviour carries `territory !== null`.
//    Hardscape mutations land in the same `scene` signal we already
//    observe, so the existing tear-down + re-spawn pipeline picks them
//    up — we only extend the spawnKey fingerprint so the rebuild
//    actually fires (the prior key only tracked livestock + tank).
//    Plants are NOT registered here: plant cover is runtime-computed by
//    FearSystem from scatter density (per the catalog contract), not
//    treated as a refuge anchor.
//
// FALLBACK POLICY (F11.1 static-wiggle preservation)
// --------------------------------------------------
// If a catalog row is missing or `resolveBehavior` throws, that entry's
// entities spawn with `behaviorHandleIdx = NO_BEHAVIOR_HANDLE` so the
// behaviour systems early-out and the fish wiggles in place at its spawn
// position. We log a warning + continue (a single console.warn per missing
// ref, gated on the resolveBehavior failure path). This is the documented
// "log + skip the behaviour wiring, keep the visual" policy.
//
// DETERMINISM
// -----------
// - Per-entry spawn PRNG = `seededHash01(documentSeed XOR hash(entry.id), ...)`.
//   `seededHash01` is the workspace's standard deterministic hash (see
//   `docs/caveats/geometry.md`).
// - Iteration order is `scene.livestock` document order, and within each
//   entry, `0..quantity-1`. Two cold service starts with the same scene
//   produce identical bitECS spawn sequences, which makes the world's
//   `spawnIndex` (used as the tickPrng partition key per the
//   livestock-ecs caveat) stable across runs — that's the 1000-tick
//   byte-identity gate.
// - Behaviour registration order matters for the ParamStore handle
//   numbering. Species are registered in document order on first
//   encounter, so the same scene reproduces the same handleIdx layout
//   across cold starts.

import { Injectable, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import type {
  Catalog,
  EquipmentEntry as CatalogEquipmentEntry,
  HardscapeEntry as CatalogHardscapeEntry,
  LivestockEntry as CatalogLivestockEntry,
} from '@aquascape/domain/catalog';
import { archetypeForSpecies, type FishArchetypeId } from '@aquascape/domain/fish-anatomy';
import {
  bakeFlowField,
  bakeHardscapeSdf,
  type FlowSource,
  type HardscapeSphere,
} from '@aquascape/domain/fluid-sim';
import {
  resolveBehavior,
  type BehaviorResolutionInput,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import { seededHash01 } from '@aquascape/domain/geometry';
import {
  FISH_ARCHETYPE,
  HARDSCAPE_CATEGORY,
  NO_BEHAVIOR_HANDLE,
  createLivestockWorld,
  tickPrng,
  type BubbleSourceRegistration,
  type HardscapeRegistrationEntry,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';
import type {
  EquipmentEntry,
  HardscapeObject,
  LivestockEntry,
  Scene,
} from '@aquascape/domain/scene-model';
import { LivestockPulseActions, selectScene } from '@aquascape/state';

/** Body length when the catalog entry can't be resolved (mm). */
const FALLBACK_BODY_LENGTH_MM = 35;
/** Inset from each interior wall so spawned fish never start inside the glass. */
const SPAWN_WALL_INSET_MM = 20;
/** F11.4 — wall inset for food-sprite XZ positions (mm). Smaller than the
 *  fish inset because sprites are visually tiny billboards, not ellipsoids. */
const FOOD_SPRITE_WALL_INSET_MM = 30;
/** F11.4 — how far below the waterline food sprites spawn (mm). */
const FOOD_SPRITE_SURFACE_OFFSET_MM = 20;
/** F11.4 — bounds for the random sprite-count default (inclusive). */
const FOOD_SPRITE_DEFAULT_MIN = 3;
const FOOD_SPRITE_DEFAULT_MAX = 6;

/**
 * F11.5 — fallback sphere radius for the hardscape SDF bake (mm). The
 * scene-model `HardscapeObject` doesn't carry a body-radius today, and the
 * catalog's `naturalSize` is a `{ width, height, depth }` AABB rather than
 * a sphere — both are coarse approximations relative to the actual mesh.
 *
 * 50 mm is the sensible default for the small/medium rocks the demo
 * catalog ships (matches the order-of-magnitude of `naturalSize.width`
 * for `hardscape.rock.seiryu` and friends). When the catalog row's
 * `naturalSize` is present we use **half of the longest dimension**
 * instead — a "bounding sphere of the bounding box" approximation that
 * scales correctly for both small pebbles and large boulders without
 * importing the full mesh geometry. F11.6's perf pass will likely refine
 * to per-mesh AABB → SDF; this is the F11.5 placeholder.
 */
const HARDSCAPE_SDF_FALLBACK_RADIUS_MM = 50;

/**
 * Service that owns the `LivestockWorld` for the running app. Lazily
 * created on the first `getWorld()` call; persists across 2D↔3D toggles
 * (the renderer-swap effect in `AppComponent` tears down the 3D renderer
 * but leaves this service's world untouched).
 */
@Injectable({ providedIn: 'root' })
export class LivestockSimulationService implements OnDestroy {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  // F11.4 — `Actions` is provided at the app's composition root by
  // `provideEffects()`. We mark it optional so service tests that don't
  // need the pulse pipeline (most of the F11.1-F11.3 specs) can configure
  // a TestBed without `provideMockActions`. Tests that exercise the Feed
  // tank path inject Actions explicitly.
  private readonly actions$ = inject(Actions, { optional: true });

  /** The catalog used to resolve `LivestockEntry.ref` → archetype + size. */
  private catalog: Catalog = coreCatalog;

  /** Lazily-created world. `null` until the first 3D switch (or a manual
   *  `getWorld()`). Persisted across renderer disposals. */
  private world: LivestockWorld | null = null;

  /** Most-recent (seed, livestock-fingerprint) pair we spawned for. Used
   *  to short-circuit re-spawn when the document changes but livestock
   *  + seed are unchanged. */
  private lastSpawnKey: string | null = null;

  constructor() {
    // Subscribe at construction so the first store emission populates
    // `lastSpawnKey` and triggers a re-spawn if `getWorld()` already
    // built a world. We don't pre-build the world here — that would
    // pay the bitECS allocation on every cold boot even if the user
    // never enters 3D mode.
    this.store
      .select(selectScene)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((scene) => {
        if (scene === null) return;
        this.onSceneChanged(scene);
      });

    // F11.4 — listen for transient "Feed tank" pulses. The action stream
    // is fire-and-forget: each emission drops N food sprite entities at
    // the surface. Determinism contract: two services driven by the same
    // dispatch sequence + same world.tickCounter at the moment of dispatch
    // produce identical sprite positions (sprite count + per-sprite x/z
    // come from `tickPrng`). In real usage the user clicks asynchronously
    // so positions vary trial-to-trial — that's expected; tests pin the
    // dispatch order to reproduce a fixed distribution.
    //
    // The `Actions` token is provided by `provideEffects()` at the app
    // root. When tests inject the service without `provideMockActions`,
    // `actions$` is null and the subscription is skipped (no feed-tank
    // pulses to consume in those tests anyway).
    if (this.actions$ !== null) {
      this.actions$
        .pipe(ofType(LivestockPulseActions.feedTank), takeUntilDestroyed(this.destroyRef))
        .subscribe((action) => this.onFeedTank(action.spriteCount));
    }
  }

  /**
   * Inject an alternate catalog (tests, headless tools). Production
   * always uses the default `coreCatalog`. Safe to call multiple
   * times; takes effect on the next `onSceneChanged` invocation.
   */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
  }

  /**
   * Return the world for the 3D renderer to read on the next render.
   * Returns `null` when the current scene has no livestock — the
   * renderer treats that as a no-op (no fish drawn). The world is
   * BUILT here on first request (lazy); subsequent calls return the
   * same instance unless the scene's `seed` changed.
   */
  getWorld(): LivestockWorld | null {
    if (this.world === null) return null;
    return this.world;
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  /** Idempotent — safe to call from `ngOnDestroy` AND from tests. */
  dispose(): void {
    if (this.world !== null) {
      this.world.dispose();
      this.world = null;
    }
    this.lastSpawnKey = null;
    this.warnedRefs.clear();
  }

  /**
   * F11.4 — drop food sprites into the world at the water surface.
   * Called from the `LivestockPulseActions.feedTank` subscription; also
   * safe to call directly from tests.
   *
   * Behaviour:
   *  - No-op if the world hasn't been built (no livestock in the scene).
   *  - When `spriteCount` is undefined, picks a deterministic random count
   *    in `[FOOD_SPRITE_DEFAULT_MIN, FOOD_SPRITE_DEFAULT_MAX]` via
   *    `tickPrng(world, 'feed-tank-count')`. Two pulses at the same
   *    `world.tickCounter` therefore drop the same number of sprites.
   *  - Per-sprite XZ is uniform inside the tank interior with a
   *    `FOOD_SPRITE_WALL_INSET_MM` inset; Y is pinned just below the
   *    waterline (`tankAabb.maxY - FOOD_SPRITE_SURFACE_OFFSET_MM`).
   *
   * Sprite despawn is owned by `foodSpriteLifetimeSystem` (already running
   * in `world.step`); we don't track sprites here.
   */
  private onFeedTank(spriteCount?: number): void {
    const world = this.world;
    if (world === null) return;
    if (world.snapshot(0).entityCount === 0) return;

    const aabb = world.tankAabb;
    // Count comes from either the explicit override or a deterministic
    // tickPrng draw. The `FEED_TANK_COUNT_KEY` is partitioned away from
    // other tickPrng keys (BehaviorSystems use entity ids) so streams
    // don't alias.
    const count =
      spriteCount !== undefined
        ? Math.max(0, Math.floor(spriteCount))
        : pickSpriteCount(world);
    if (count === 0) return;

    // XZ bounds inset from the glass; Y pinned to just below the surface.
    const minX = aabb.minX + FOOD_SPRITE_WALL_INSET_MM;
    const maxX = aabb.maxX - FOOD_SPRITE_WALL_INSET_MM;
    const minZ = aabb.minZ + FOOD_SPRITE_WALL_INSET_MM;
    const maxZ = aabb.maxZ - FOOD_SPRITE_WALL_INSET_MM;
    const y = aabb.maxY - FOOD_SPRITE_SURFACE_OFFSET_MM;

    // Defensive: a tiny tank could have inverted bounds after the inset.
    // Fall back to the tank centre on that axis to avoid NaN positions.
    const xLo = minX <= maxX ? minX : (aabb.minX + aabb.maxX) * 0.5;
    const xHi = minX <= maxX ? maxX : xLo;
    const zLo = minZ <= maxZ ? minZ : (aabb.minZ + aabb.maxZ) * 0.5;
    const zHi = minZ <= maxZ ? maxZ : zLo;

    for (let i = 0; i < count; i++) {
      // Two independent draws per sprite (axis 0 = X, axis 2 = Z); the
      // sprite index `i` partitions the stream so two sprites in the same
      // pulse get independent positions. We skip axis 1 (Y) since Y is
      // pinned to the surface.
      const rx = tickPrng(world, FEED_TANK_KEY, i, 0);
      const rz = tickPrng(world, FEED_TANK_KEY, i, 2);
      const x = xLo + rx * (xHi - xLo);
      const z = zLo + rz * (zHi - zLo);
      world.spawnFoodSprite({ x, y, z });
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  /**
   * React to a new scene from the store. Re-spawn entities only when
   * `(seed, livestock fingerprint)` changes; an unrelated scene
   * mutation (e.g. a plant moved) leaves the existing ECS state alone.
   *
   * Tank-AABB changes go through `setTankAabb` without a rebuild — the
   * world's PRNG state stays untouched, but DepthSystem + SteeringIntegrator
   * pick up the new bounds on the next tick. (Tests cover this case.)
   */
  private onSceneChanged(scene: Scene): void {
    const livestock = scene.livestock ?? [];
    // F11.3: hardscape registration entries are derived from the LOADED
    // catalog (coverScore + category come straight off the catalog row;
    // the loader has already filled defaults). Built once per
    // onSceneChanged so the same array drives both the spawnKey
    // fingerprint and the world.registerHardscape call below.
    const hardscape = collectHardscape(scene, this.catalog);
    // F11.5 Wave 5: equipment-driven inputs for FlowField bake +
    // HardscapeSdf bake + bubble-source registration. All three are
    // pure derivations from the scene + catalog; built once per
    // onSceneChanged so the spawnKey fingerprint and the world
    // register* calls see the exact same arrays.
    const equipment = scene.equipment ?? [];
    const flowSources = collectFlowSources(equipment, this.catalog);
    const bubbleSources = collectBubbleSources(equipment, this.catalog, scene);
    const sphereInputs = collectHardscapeSpheres(scene, this.catalog);
    const key = this.spawnKey(scene.seed, livestock, scene.tank, hardscape, equipment);
    const tankAabb = tankAabbFromScene(scene);

    // No livestock at all → tear down the world entirely so the
    // renderer's `options.livestockWorld` becomes null and the no-op
    // path lights up. This also frees the bitECS slab. Hardscape
    // registration is skipped — without fish there's nothing to anchor.
    if (livestock.length === 0) {
      if (this.world !== null) {
        this.world.dispose();
        this.world = null;
      }
      this.lastSpawnKey = key;
      return;
    }

    // First time we see livestock — build the world WITH the scene's
    // tank AABB so DepthSystem reads the real interior height from tick 1.
    if (this.world === null) {
      this.world = createLivestockWorld(scene.seed, { tankAabb });
      // Hardscape MUST be registered before spawnAll so spawnFish's
      // auto-anchor pass can see refuges within range.
      this.world.registerHardscape(hardscape);
      // F11.5: bake + register flow + SDF + bubble sources BEFORE spawn
      // so the world is fully populated when fish first integrate.
      this.wireFluidAndBubbles(this.world, tankAabb, flowSources, sphereInputs, bubbleSources);
      this.spawnAll(this.world, scene, livestock);
      this.lastSpawnKey = key;
      return;
    }

    // Existing world — re-spawn only if the inputs that determine
    // entity layout actually changed (livestock fingerprint, seed,
    // tank dims, hardscape order/coverScore/category — all baked into
    // spawnKey).
    if (key === this.lastSpawnKey) return;

    // Seed change → must rebuild the world from scratch (the world's
    // `seed` is frozen at creation).
    if (this.world.seed !== (scene.seed | 0)) {
      this.world.dispose();
      this.world = createLivestockWorld(scene.seed, { tankAabb });
    } else {
      // Same seed: keep the world, mutate the AABB in place, then
      // tear down entities. setTankAabb + a re-spawn pass is cheaper
      // than a full world rebuild (no GC, no ParamStore reset).
      this.world.setTankAabb(tankAabb);
      this.despawnAll(this.world);
    }
    // Hardscape registration runs on EVERY rebuild — even when the
    // mutation that triggered us was livestock-only. registerHardscape
    // tears down + replaces the whole hardscape set, so the cost is
    // bounded by the hardscape count, not the diff. This keeps the
    // contract simple: post-rebuild, the world's hardscape state
    // always matches the latest scene.
    this.world.registerHardscape(hardscape);
    // F11.5: re-bake + re-register flow + SDF + bubble sources on every
    // rebuild. Empty inputs clear (pass null / empty array). Spawn fish
    // LAST so auto-anchor + initial bubble debt are consistent with the
    // fully-populated world state.
    this.wireFluidAndBubbles(this.world, tankAabb, flowSources, sphereInputs, bubbleSources);
    this.spawnAll(this.world, scene, livestock);
    this.lastSpawnKey = key;
  }

  /**
   * F11.5 Wave 5 — bake + register flow field + hardscape SDF + bubble
   * sources on the given world. Centralised so the "first time" and
   * "existing world" branches in `onSceneChanged` share the same
   * empty-input semantics:
   *
   *   - Empty `flowSources` → register null (no current, FlowFieldSystem
   *     early-returns and pays zero cost per tick).
   *   - Empty `sphereInputs` → register null (CollisionSystem still runs
   *     fish-vs-fish separation, just no SDF deflect pass).
   *   - Empty `bubbleSources` → register [] (bubble systems early-return
   *     on `count === 0`; any live bubbles still rise + pop naturally).
   *
   * The bake itself is pure + deterministic — same inputs always produce
   * the same typed-array outputs (see `domain/fluid-sim`'s spec).
   */
  private wireFluidAndBubbles(
    world: LivestockWorld,
    tankAabb: TankAabb,
    flowSources: ReadonlyArray<FlowSource>,
    sphereInputs: ReadonlyArray<HardscapeSphere>,
    bubbleSources: ReadonlyArray<BubbleSourceRegistration>,
  ): void {
    const aabb3 = {
      min: { x: tankAabb.minX, y: tankAabb.minY, z: tankAabb.minZ },
      max: { x: tankAabb.maxX, y: tankAabb.maxY, z: tankAabb.maxZ },
    };
    if (flowSources.length > 0) {
      world.registerFlowField(bakeFlowField({ tankAabb: aabb3, sources: flowSources }));
    } else {
      world.registerFlowField(null);
    }
    if (sphereInputs.length > 0) {
      world.registerHardscapeSdf(bakeHardscapeSdf({ tankAabb: aabb3, hardscape: sphereInputs }));
    } else {
      world.registerHardscapeSdf(null);
    }
    world.registerBubbleSources(bubbleSources);
  }

  /**
   * Build a stable string fingerprint of the inputs that drive spawn
   * layout. Two scenes with the same fingerprint MUST produce the same
   * spawned-entity set (determinism invariant).
   *
   * Tank dimensions are part of the key — they bound the spawn random
   * draws, so a tank resize must trigger a re-spawn even when seed +
   * livestock are unchanged.
   *
   * NOTE: we do NOT sort the parts. Document-order iteration is
   * load-bearing for determinism: per the livestock-ecs caveat, the
   * world's per-entity `spawnIndex` is the tickPrng partition key, and
   * spawnIndex monotonically increments in the order the service calls
   * spawnFish. Sorting would silently break replay across cold starts
   * if the document author re-ordered the livestock array.
   */
  private spawnKey(
    seed: number,
    livestock: readonly LivestockEntry[],
    tank: Scene['tank'],
    hardscape: readonly HardscapeRegistrationEntry[],
    equipment: readonly EquipmentEntry[],
  ): string {
    const parts = livestock.map(
      (e) => `${e.id}:${e.ref.catalog}/${e.ref.id}@${e.ref.version}:${e.quantity}`,
    );
    // Hardscape is fingerprinted in registration order (which is document
    // order — `collectHardscape` walks `scene.layers[].objects` without
    // re-sorting, matching the auto-anchor's order-stable nearest-pick).
    // Position is rounded to whole mm so sub-millimetre noise in the
    // transform doesn't fire spurious rebuilds; coverScore is rounded to
    // 3 decimals to swallow loader-default float wobble.
    const hardparts = hardscape.map(
      (h) =>
        `${h.category}:${Math.round(h.position.x)},${Math.round(h.position.y)},${Math.round(h.position.z)}:${h.coverScore.toFixed(3)}`,
    );
    // F11.5 Wave 5: equipment fingerprint. Catalog ref (drives flow +
    // airRateMl lookups) is the load-bearing axis — settings are
    // user-facing knobs the bake doesn't consume yet. Iteration order
    // is `scene.equipment` document order — same stability contract as
    // the livestock + hardscape parts. If an entry gains a per-instance
    // position field in a future stage, fingerprint it here so a moved
    // air stone re-bakes; for F11.5 the catalog row owns the position.
    const eqparts = equipment.map(
      (e) => `${e.id}:${e.ref.catalog}/${e.ref.id}@${e.ref.version}`,
    );
    return `${seed | 0}|${tank.width}x${tank.height}x${tank.depth}|${parts.join('|')}|H:${hardparts.join('|')}|E:${eqparts.join('|')}`;
  }

  /** Despawn every fish in the world. Used on re-spawn (same seed). */
  private despawnAll(world: LivestockWorld): void {
    const snap = world.snapshot(0);
    // Copy because `snapshot.ids` is a *view* into the world's pooled
    // buffer; despawning while iterating the view would mutate it
    // mid-loop.
    const ids = Array.from(snap.ids);
    for (const id of ids) world.despawn(id);
  }

  /**
   * Walk every livestock entry and spawn its quota into the world.
   *
   * Behaviour resolution + species registration happens here, NOT in
   * `spawnEntry`, so we can dedupe by `ref.id` and call
   * `world.registerSpeciesBehavior(...)` exactly once per unique
   * species in the scene. The returned handleIdx is then handed to
   * `spawnEntry` for every entity in that entry.
   */
  private spawnAll(world: LivestockWorld, scene: Scene, livestock: readonly LivestockEntry[]): void {
    // speciesId → handleIdx (or NO_BEHAVIOR_HANDLE for the fallback path).
    const handleBySpecies = new Map<number, number>();

    for (const entry of livestock) {
      const catalogRow = this.catalog.get(entry.ref);
      const speciesId = speciesIdForRef(entry.ref.id);

      let handleIdx: number;
      if (handleBySpecies.has(speciesId)) {
        // Same species already registered for an earlier entry — reuse
        // the handle (no double registration; ParamStore is idempotent
        // on speciesId anyway, but this also avoids the work).
        handleIdx = handleBySpecies.get(speciesId) as number;
      } else {
        handleIdx = this.resolveAndRegister(world, catalogRow, entry.ref.id);
        handleBySpecies.set(speciesId, handleIdx);
      }

      // Pull the resolved animation params from the ParamStore so each
      // entity for this species gets the species-level frequency +
      // amplitudes (NOT the F11.1 hardcoded defaults). When the handle
      // is NO_BEHAVIOR_HANDLE we fall back to the world's spawnFish
      // defaults (4 Hz / 0.02 / 0.12) — the behaviour systems early-out
      // so animation is the only thing that runs anyway.
      const resolved = handleIdx === NO_BEHAVIOR_HANDLE ? null : world.paramStore.get(handleIdx);
      this.spawnEntry(world, scene, entry, {
        speciesId,
        handleIdx,
        resolved,
        catalogRow,
      });
    }
  }

  /**
   * Resolve a catalog row to a ResolvedBehavior and register it on the
   * world's ParamStore. Returns the handle index for spawnFish.
   *
   * Fallback policy (documented + tested):
   *  - catalogRow === null/undefined → log once (per ref id), return
   *    NO_BEHAVIOR_HANDLE.
   *  - resolveBehavior throws → log once, return NO_BEHAVIOR_HANDLE.
   * Either path leaves the fish on the F11.1 static-wiggle path.
   */
  private resolveAndRegister(
    world: LivestockWorld,
    catalogRow: unknown,
    refId: string,
  ): number {
    if (catalogRow === null || catalogRow === undefined || !isLivestockRow(catalogRow)) {
      this.warnOnce(refId, 'missing');
      return NO_BEHAVIOR_HANDLE;
    }
    let resolved: ResolvedBehavior;
    try {
      // `BehaviorResolutionInput` is structural; the catalog
      // LivestockEntry shape carries every field it reads (group,
      // temperament, schoolingMin, tags, id, behavior). Pass through
      // directly — no `assertHasBehavior` runtime check.
      resolved = resolveBehavior(catalogRow as BehaviorResolutionInput);
    } catch (err) {
      this.warnOnce(refId, `resolveBehavior failed: ${String(err)}`);
      return NO_BEHAVIOR_HANDLE;
    }
    const speciesId = speciesIdForRef(refId);
    return world.registerSpeciesBehavior(speciesId, resolved);
  }

  /**
   * Service-lifetime dedup for the missing-catalog-ref warning. Without
   * this, every `onSceneChanged` emission (autosave tick, selection
   * mutation, etc.) re-emits the same warning since spawnAll re-walks
   * every entry. Cleared on `dispose()` so a new document gets a fresh
   * warn window for previously-seen-and-now-removed refs.
   *
   * NOTE: this does NOT promise the warn fires *exactly once* per ref
   * across the service's lifetime — only that it fires *at most once*
   * per re-spawn pass per ref. The store may re-emit the same scene
   * shape (e.g. after `refreshState` in tests, or an autosave round
   * trip in prod) and trigger another spawn pass that hasn't yet seen
   * the ref. That's intentional — the warn is a "you have a broken
   * doc" signal, and re-emitting it on every document load is fine.
   */
  private readonly warnedRefs = new Set<string>();
  private warnOnce(refId: string, reason: string): void {
    if (this.warnedRefs.has(refId)) return;
    this.warnedRefs.add(refId);
    console.warn(
      `[livestock-sim] ref "${refId}" — ${reason}. Spawning with NO_BEHAVIOR_HANDLE (static wiggle).`,
    );
  }

  /** Spawn `entry.quantity` ECS entities for a single `LivestockEntry`. */
  private spawnEntry(
    world: LivestockWorld,
    scene: Scene,
    entry: LivestockEntry,
    species: {
      speciesId: number;
      handleIdx: number;
      resolved: ResolvedBehavior | null;
      catalogRow: unknown;
    },
  ): void {
    const archetype = resolveArchetype(species.catalogRow);
    const bodyLengthMm = resolveBodyLengthMm(species.catalogRow);

    // Animation params come from the resolved behaviour. When we're on
    // the fallback path (NO_BEHAVIOR_HANDLE) `resolved` is null and we
    // omit the animation fields so spawnFish's own defaults (4 Hz /
    // 0.02 / 0.12 — matching the F11.1 wiggle look) kick in.
    const anim = species.resolved?.animation ?? null;

    // Per-entry seed: `documentSeed XOR hashOfEntryId`. Reuses
    // `seededHash01` for the partition-by-key trick — each random read
    // passes a unique key tuple so the stream is reproducible.
    const entrySeed = (scene.seed ^ hashStringTo32(entry.id)) | 0;

    // Inset bounds so a spawned fish never starts clipping the glass.
    const minX = Math.min(SPAWN_WALL_INSET_MM, scene.tank.width * 0.5);
    const maxX = Math.max(scene.tank.width - SPAWN_WALL_INSET_MM, minX);
    const minY = Math.min(SPAWN_WALL_INSET_MM, scene.tank.height * 0.5);
    const maxY = Math.max(scene.tank.height - SPAWN_WALL_INSET_MM, minY);
    const minZ = Math.min(SPAWN_WALL_INSET_MM, scene.tank.depth * 0.5);
    const maxZ = Math.max(scene.tank.depth - SPAWN_WALL_INSET_MM, minZ);

    for (let i = 0; i < entry.quantity; i++) {
      // Six independent random reads per spawn — partition by `i` AND
      // by an axis index so two spawns at different `i` produce
      // independent streams.
      const rx = seededHash01(entrySeed, i, 0);
      const ry = seededHash01(entrySeed, i, 1);
      const rz = seededHash01(entrySeed, i, 2);
      const rYaw = seededHash01(entrySeed, i, 3);
      const rPhase = seededHash01(entrySeed, i, 4);

      const x = minX + rx * (maxX - minX);
      const y = minY + ry * (maxY - minY);
      const z = minZ + rz * (maxZ - minZ);

      // Random Y rotation as a unit quaternion `(0, sin(θ/2), 0, cos(θ/2))`.
      const yaw = rYaw * Math.PI * 2;
      const orientation = {
        x: 0,
        y: Math.sin(yaw * 0.5),
        z: 0,
        w: Math.cos(yaw * 0.5),
      };

      // Either species params or spawnFish defaults — never both. Spread the
      // animation overrides only when present so `exactOptionalPropertyTypes`
      // doesn't see `undefined` as a value (it forbids explicit `undefined`
      // even where the field is optional).
      world.spawnFish({
        archetype,
        speciesId: species.speciesId,
        bodyLengthMm,
        position: { x, y, z },
        orientation,
        ...(anim?.tailBeatFreq !== undefined ? { tailBeatFreq: anim.tailBeatFreq } : {}),
        ...(anim?.ampHead !== undefined ? { ampHead: anim.ampHead } : {}),
        ...(anim?.ampTail !== undefined ? { ampTail: anim.ampTail } : {}),
        phaseOffset: rPhase * Math.PI * 2,
        behaviorHandleIdx: species.handleIdx,
      });
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

/**
 * F11.4 — `tickPrng` partition key for Feed tank position draws. Picked as
 * an FNV-1a fold of the literal `'feed-tank'` string so it sits well clear
 * of the per-entity keys (which are small integers ≤ 65535). Kept as a
 * module-scope constant so two different feeds at the same tickCounter
 * draw from the same stream layout.
 */
const FEED_TANK_KEY = (() => {
  let h = 0x811c9dc5;
  for (let i = 0; i < 'feed-tank'.length; i++) {
    h ^= 'feed-tank'.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

/** F11.4 — separate partition key for the sprite-count draw. */
const FEED_TANK_COUNT_KEY = (() => {
  let h = 0x811c9dc5;
  for (let i = 0; i < 'feed-tank-count'.length; i++) {
    h ^= 'feed-tank-count'.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

/**
 * Pick a deterministic sprite count in `[FOOD_SPRITE_DEFAULT_MIN,
 * FOOD_SPRITE_DEFAULT_MAX]` from the world's current tick. Two pulses
 * at the same tickCounter draw the same count — that's what makes the
 * test invariant "same dispatch sequence → same sprite layout" hold.
 */
function pickSpriteCount(world: LivestockWorld): number {
  const r = tickPrng(world, FEED_TANK_COUNT_KEY);
  const span = FOOD_SPRITE_DEFAULT_MAX - FOOD_SPRITE_DEFAULT_MIN + 1;
  return FOOD_SPRITE_DEFAULT_MIN + Math.floor(r * span);
}

/** Map a string archetype id (from fish-anatomy) to the `FISH_ARCHETYPE` enum. */
function archetypeIdToEnum(id: FishArchetypeId): number {
  switch (id) {
    case 'slim-tetra':
      return FISH_ARCHETYPE.SLIM_TETRA;
    case 'deep-bodied':
      return FISH_ARCHETYPE.DEEP_BODIED;
    case 'barb':
      return FISH_ARCHETYPE.BARB;
    case 'cory-cylinder':
      return FISH_ARCHETYPE.CORY_CYLINDER;
    case 'eel':
      return FISH_ARCHETYPE.EEL;
    case 'hatchet-wedge':
      return FISH_ARCHETYPE.HATCHET_WEDGE;
  }
}

/**
 * Resolve the procedural archetype for a catalog row. Falls back to the
 * default `slim-tetra` when the row is missing or shapeless.
 */
function resolveArchetype(catalogRow: unknown): number {
  if (catalogRow === null || catalogRow === undefined) {
    return archetypeIdToEnum('slim-tetra');
  }
  // `archetypeForSpecies` accepts any `{ group?, tags?, id? }` shape;
  // narrowing the catalog row to that surface is safe.
  const row = catalogRow as { group?: string; tags?: readonly string[]; id?: string; kind?: string };
  if (row.kind !== 'livestock') return archetypeIdToEnum('slim-tetra');
  return archetypeIdToEnum(archetypeForSpecies(row));
}

/** Resolve `adultSize` (mm) for a catalog livestock row, with a safe fallback. */
function resolveBodyLengthMm(catalogRow: unknown): number {
  if (catalogRow === null || catalogRow === undefined) return FALLBACK_BODY_LENGTH_MM;
  const row = catalogRow as Partial<CatalogLivestockEntry>;
  if (row.kind !== 'livestock') return FALLBACK_BODY_LENGTH_MM;
  if (typeof row.adultSize !== 'number' || !Number.isFinite(row.adultSize) || row.adultSize <= 0) {
    return FALLBACK_BODY_LENGTH_MM;
  }
  return row.adultSize;
}

/**
 * Hash a catalog ref id to a stable 16-bit species id. The bitECS
 * SpeciesId.id slot is `ui16`, so we squeeze the 32-bit FNV-1a hash
 * down to that range. Two different ref ids could in principle collide,
 * but the ParamStore keys by speciesId so a collision means the second
 * registration would overwrite the first — acceptable for F11.2 (the
 * catalog has tens of species, not tens of thousands), and the failure
 * mode is "two species share params" rather than "fish disappear".
 */
function speciesIdForRef(refId: string): number {
  return (seededHash01(0, hashStringTo32(refId)) * 65535) | 0;
}

/**
 * Narrow an unknown catalog row to a "looks like a livestock entry"
 * shape so we can safely pass it to `resolveBehavior` (which is
 * structurally typed). Returns false for hardscape / plant / equipment
 * rows so the service skips behaviour registration for non-fish refs
 * that somehow leak through.
 */
function isLivestockRow(catalogRow: unknown): boolean {
  if (catalogRow === null || typeof catalogRow !== 'object') return false;
  return (catalogRow as { kind?: string }).kind === 'livestock';
}

/**
 * F11.3 — Walk a scene's hardscape SceneObjects and build the
 * `HardscapeRegistrationEntry[]` the world expects. The catalog row is
 * the LOADED `CoreCatalog` row (post-loader-fill), so `coverScore` is
 * already populated from `category` defaults (wood→0.6, rock→0.4,
 * other→0). We re-default ONLY as a last-ditch defensive fallback for
 * the case where a test fixture or broken catalog bypasses the loader;
 * the design contract is "loader fills, service reads".
 *
 * Iteration order = document order (`scene.layers` outer, `layer.objects`
 * inner) — load-bearing for determinism. The auto-anchor pick at
 * spawn-time is order-stable (first-nearest-wins), so reshuffling
 * hardscape would silently change anchor assignments and break the
 * 1000-tick replay invariant.
 *
 * Plants are intentionally excluded: per the livestock-ecs caveat,
 * plant cover is runtime-computed by FearSystem from scatter density,
 * not registered as a discrete refuge anchor. Decor entries are also
 * skipped — only `kind === 'hardscape'` SceneObjects make the list.
 *
 * `category` mapping: catalog's string union `'rock' | 'wood' | 'other'`
 * → the integer `HARDSCAPE_CATEGORY.*` the ECS slab stores. Plants would
 * map to `HARDSCAPE_CATEGORY.PLANT` if they were ever registered here,
 * but they're not.
 */
/**
 * F11.5 Wave 5 — Walk a scene's equipment entries and project to
 * `FlowSource[]` for `bakeFlowField`. Only equipment whose catalog row
 * declares `flow?: { ... }` contributes; everything else is skipped (zero
 * contribution to the field is identical to "not present at all" once the
 * source set is empty, so we keep the array small for the bake's hot loop).
 *
 * Iteration order = document order — load-bearing for determinism: the
 * bake's Gaussian deposit sums in iteration order, and floating-point
 * summation isn't associative, so reshuffling sources would produce a
 * different field on the same inputs.
 */
function collectFlowSources(
  equipment: readonly EquipmentEntry[],
  catalog: Catalog,
): FlowSource[] {
  const out: FlowSource[] = [];
  for (const eq of equipment) {
    const row = catalog.get(eq.ref);
    if (row === null || row.kind !== 'equipment') continue;
    const eqRow = row as CatalogEquipmentEntry;
    if (eqRow.flow === undefined) continue;
    const fs: FlowSource = {
      outflowPos: eqRow.flow.outflowPos ?? { x: 0, y: 0, z: 0 },
      outflowVec: eqRow.flow.outflowVec ?? { x: 0, y: 0, z: 1 },
      flowRate: eqRow.flow.flowRate ?? 200,
      // Spread an optional intakePos via the spread trick so we never
      // assign `undefined` (which `exactOptionalPropertyTypes` forbids
      // for declared-optional fields).
      ...(eqRow.flow.intakePos !== undefined ? { intakePos: eqRow.flow.intakePos } : {}),
    };
    out.push(fs);
  }
  return out;
}

/**
 * F11.5 Wave 5 — Walk a scene's equipment entries and project to
 * `BubbleSourceRegistration[]`. Only entries whose catalog row declares
 * `airRateMl > 0` contribute (an `airRateMl: 0` row is a documented
 * sentinel for "this is technically an air stone but produces no visible
 * bubbles" — we treat it as no source).
 *
 * Position resolution policy:
 *   1. Catalog row's `flow.outflowPos` if present (an air-driven sponge
 *      filter is often both a flow source AND a bubble source, and the
 *      outflow position is the natural emission point).
 *   2. Otherwise tank center-bottom (`width/2, 0, depth/2`) — the
 *      typical air-stone placement when authoring.
 *
 * Documented as a placeholder until the document format gains a per-
 * equipment-instance position field; for F11.5 the catalog row owns it.
 * Flagged for review in the agent report.
 */
function collectBubbleSources(
  equipment: readonly EquipmentEntry[],
  catalog: Catalog,
  scene: Scene,
): BubbleSourceRegistration[] {
  const out: BubbleSourceRegistration[] = [];
  for (const eq of equipment) {
    const row = catalog.get(eq.ref);
    if (row === null || row.kind !== 'equipment') continue;
    const eqRow = row as CatalogEquipmentEntry;
    if (eqRow.airRateMl === undefined || eqRow.airRateMl <= 0) continue;
    const position = eqRow.flow?.outflowPos ?? {
      x: scene.tank.width / 2,
      y: 0,
      z: scene.tank.depth / 2,
    };
    out.push({ position, airRateMl: eqRow.airRateMl });
  }
  return out;
}

/**
 * F11.5 Wave 5 — Walk a scene's hardscape SceneObjects and project to
 * `HardscapeSphere[]` for the SDF bake. The scene-model doesn't ship a
 * sphere-radius today; we approximate from the catalog row's
 * `naturalSize` (half of the longest dim, "bounding sphere of bounding
 * box") and fall back to `HARDSCAPE_SDF_FALLBACK_RADIUS_MM` when the
 * row is missing or has no `naturalSize`.
 *
 * Iteration order matches `collectHardscape` (document order) so the
 * SDF bake's per-sphere min reduction sees the same input ordering as
 * the bitECS Hardscape registration — keeps the per-cell SDF value
 * byte-identical across two cold service builds with the same scene.
 */
function collectHardscapeSpheres(scene: Scene, catalog: Catalog): HardscapeSphere[] {
  const out: HardscapeSphere[] = [];
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.kind !== 'hardscape') continue;
      const row = catalog.get(obj.ref);
      const hardscapeRow =
        row !== null && row.kind === 'hardscape' ? (row as CatalogHardscapeEntry) : null;
      const radius = sphereRadiusForHardscape(hardscapeRow);
      out.push({
        position: {
          x: obj.transform.position.x,
          y: obj.transform.position.y,
          z: obj.transform.position.z,
        },
        radius,
      });
    }
  }
  return out;
}

/**
 * Pick a sphere radius approximating the hardscape entry's mesh extent.
 * Half of the longest `naturalSize` dim is the "bounding sphere of the
 * bounding box" — coarse but correct in order of magnitude for both
 * small pebbles + large boulders. Falls back to the const when
 * `naturalSize` is missing (catalog row absent or under-populated).
 */
function sphereRadiusForHardscape(row: CatalogHardscapeEntry | null): number {
  if (row === null) return HARDSCAPE_SDF_FALLBACK_RADIUS_MM;
  const ns = row.naturalSize;
  if (ns === undefined) return HARDSCAPE_SDF_FALLBACK_RADIUS_MM;
  const longest = Math.max(ns.width, ns.height, ns.depth);
  if (!Number.isFinite(longest) || longest <= 0) return HARDSCAPE_SDF_FALLBACK_RADIUS_MM;
  return longest * 0.5;
}

function collectHardscape(
  scene: Scene,
  catalog: Catalog,
): HardscapeRegistrationEntry[] {
  const out: HardscapeRegistrationEntry[] = [];
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.kind !== 'hardscape') continue;
      const row = catalog.get(obj.ref);
      const hardscapeRow =
        row !== null && row.kind === 'hardscape' ? (row as CatalogHardscapeEntry) : null;
      const category = mapHardscapeCategory(obj, hardscapeRow);
      // coverScore should be loader-defaulted on `hardscapeRow`; the
      // `?? defaultCoverScore(...)` is a defensive fallback for the
      // missing-row path (tests that don't register the entry) — NOT a
      // re-defaulting of an already-loaded row.
      const coverScore =
        hardscapeRow?.coverScore ?? defaultCoverScoreForCategoryInt(category);
      out.push({
        position: {
          x: obj.transform.position.x,
          y: obj.transform.position.y,
          z: obj.transform.position.z,
        },
        coverScore,
        category,
      });
    }
  }
  return out;
}

/**
 * Map a hardscape SceneObject + (optional) catalog row to the
 * `HARDSCAPE_CATEGORY.*` integer. The SceneObject's own `category`
 * field (Stage 7) wins when present; otherwise we fall back to the
 * catalog row's category; otherwise OTHER.
 */
function mapHardscapeCategory(
  obj: HardscapeObject,
  row: CatalogHardscapeEntry | null,
): number {
  const str = obj.category ?? row?.category ?? 'other';
  switch (str) {
    case 'wood':
      return HARDSCAPE_CATEGORY.WOOD;
    case 'rock':
      return HARDSCAPE_CATEGORY.ROCK;
    default:
      return HARDSCAPE_CATEGORY.OTHER;
  }
}

/**
 * Defensive coverScore default used only when the catalog row is missing
 * entirely. The loader does the real defaulting (see
 * `libs/domain/catalog/src/loader.ts` → `defaultCoverScoreForCategory`)
 * — these numbers must stay in sync.
 */
function defaultCoverScoreForCategoryInt(category: number): number {
  switch (category) {
    case HARDSCAPE_CATEGORY.WOOD:
      return 0.6;
    case HARDSCAPE_CATEGORY.ROCK:
      return 0.4;
    default:
      return 0;
  }
}

/**
 * Derive the world's tank interior AABB from a scene. Per the document
 * format caveat, canonical coords place the origin at the front-bottom-
 * left interior corner, so the AABB is `[0, dim]` on each axis.
 */
function tankAabbFromScene(scene: Scene): TankAabb {
  return {
    minX: 0,
    maxX: scene.tank.width,
    minY: 0,
    maxY: scene.tank.height,
    minZ: 0,
    maxZ: scene.tank.depth,
  };
}

/**
 * Folds a string into a 32-bit integer hash. The algorithm is a tiny
 * FNV-1a — fast, allocation-free, and stable across browsers (the
 * determinism contract requires JS engines produce the same result, so
 * we avoid `Math.imul` chains that could rely on engine-specific int
 * coercion timing). The output is squeezed into the `int32` range that
 * `seededHash01` and bitECS components expect.
 */
function hashStringTo32(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime 16777619, applied via the integer-safe multiplication
    // trick so we stay in 32-bit land without relying on engine specifics.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) | 0;
  }
  return hash | 0;
}
