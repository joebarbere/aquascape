// Stage 11 F11.2 Wave 5 — owns the bitECS world that the 3D renderer's RAF
// loop steps + drains each frame, and wires the schooling/depth behaviour
// pipeline (ResolvedBehavior + ParamStore + tankAabb) into the world.
//
// RESPONSIBILITIES
// ----------------
// 1. Lazily build a `LivestockWorld` seeded from `scene.seed` on first
//    `getWorld()` (the 3D renderer asks for it on its first paint). The
//    world is constructed with the scene's tank interior AABB.
// 2. Subscribe to NgRx scene emissions: when `scene.livestock` (or the
//    seed) changes, re-spawn every entity deterministically. Same
//    `(seed, livestock)` pair → identical entity counts + initial
//    positions across two re-spawns.
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
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { Catalog, LivestockEntry as CatalogLivestockEntry } from '@aquascape/domain/catalog';
import { archetypeForSpecies, type FishArchetypeId } from '@aquascape/domain/fish-anatomy';
import {
  resolveBehavior,
  type BehaviorResolutionInput,
  type ResolvedBehavior,
} from '@aquascape/domain/livestock-behaviors';
import { seededHash01 } from '@aquascape/domain/geometry';
import {
  FISH_ARCHETYPE,
  NO_BEHAVIOR_HANDLE,
  createLivestockWorld,
  type LivestockWorld,
  type TankAabb,
} from '@aquascape/domain/livestock-ecs';
import type { LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';

/** Body length when the catalog entry can't be resolved (mm). */
const FALLBACK_BODY_LENGTH_MM = 35;
/** Inset from each interior wall so spawned fish never start inside the glass. */
const SPAWN_WALL_INSET_MM = 20;

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
    const key = this.spawnKey(scene.seed, livestock, scene.tank);
    const tankAabb = tankAabbFromScene(scene);

    // No livestock at all → tear down the world entirely so the
    // renderer's `options.livestockWorld` becomes null and the no-op
    // path lights up. This also frees the bitECS slab.
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
      this.spawnAll(this.world, scene, livestock);
      this.lastSpawnKey = key;
      return;
    }

    // Existing world — re-spawn only if the inputs that determine
    // entity layout actually changed.
    if (key === this.lastSpawnKey) return;

    // Seed change → must rebuild the world from scratch (the world's
    // `seed` is frozen at creation).
    if (this.world.seed !== (scene.seed | 0)) {
      this.world.dispose();
      this.world = createLivestockWorld(scene.seed, { tankAabb });
    } else {
      // Same seed: keep the world, mutate the AABB in place, then
      // re-spawn entities. setTankAabb + a re-spawn pass is cheaper
      // than a full world rebuild (no GC, no ParamStore reset).
      this.world.setTankAabb(tankAabb);
      this.despawnAll(this.world);
    }
    this.spawnAll(this.world, scene, livestock);
    this.lastSpawnKey = key;
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
  private spawnKey(seed: number, livestock: readonly LivestockEntry[], tank: Scene['tank']): string {
    const parts = livestock.map(
      (e) => `${e.id}:${e.ref.catalog}/${e.ref.id}@${e.ref.version}:${e.quantity}`,
    );
    return `${seed | 0}|${tank.width}x${tank.height}x${tank.depth}|${parts.join('|')}`;
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

      world.spawnFish({
        archetype,
        speciesId: species.speciesId,
        bodyLengthMm,
        position: { x, y, z },
        orientation,
        // Either species params or spawnFish defaults — never both.
        tailBeatFreq: anim?.tailBeatFreq,
        ampHead: anim?.ampHead,
        ampTail: anim?.ampTail,
        phaseOffset: rPhase * Math.PI * 2,
        behaviorHandleIdx: species.handleIdx,
      });
    }
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

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
