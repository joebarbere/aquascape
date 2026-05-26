// Stage 11 F11.1 Wave 4 — owns the bitECS world that the 3D renderer's RAF
// loop steps + drains each frame.
//
// RESPONSIBILITIES
// ----------------
// 1. Lazily build a `LivestockWorld` seeded from `scene.seed` on first
//    `getWorld()` (the 3D renderer asks for it on its first paint).
// 2. Subscribe to NgRx scene emissions: when `scene.livestock` (or the
//    seed) changes, re-spawn every entity deterministically. Same
//    `(seed, livestock)` pair → identical entity counts + initial
//    positions across two re-spawns.
// 3. PERSIST the world across 2D↔3D toggles. The renderer's `dispose()`
//    drops its bundle and its reference to the world, but the service
//    keeps the same `LivestockWorld` instance alive. The next 3D switch
//    builds a fresh bundle and connects it to the existing world.
//
// DETERMINISM
// -----------
// Per-entry PRNG = `seededHash01(documentSeed, hash(entry.id), ...)`.
// `seededHash01` is the workspace's standard deterministic hash (see
// `docs/caveats/geometry.md`). Sequential random reads partition by an
// extra integer key, matching the `tickPrng` pattern from livestock-ecs.
//
// The document seed lives on `Scene.seed: number` today (not on a
// separate document envelope) — the marshal layer copies it from
// `AquaDocument.seed` so by the time the scene reaches NgRx, `scene.seed`
// is the authoritative source of truth. No schema change needed.

import { Injectable, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { Catalog, LivestockEntry as CatalogLivestockEntry } from '@aquascape/domain/catalog';
import { archetypeForSpecies, type FishArchetypeId } from '@aquascape/domain/fish-anatomy';
import { seededHash01 } from '@aquascape/domain/geometry';
import {
  FISH_ARCHETYPE,
  createLivestockWorld,
  type LivestockWorld,
} from '@aquascape/domain/livestock-ecs';
import type { LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';

/** Default tail-beat frequency, Hz. Matches `livestock-ecs/world.ts`. */
const DEFAULT_TAIL_BEAT_FREQ_HZ = 4;
/** Default carangiform head amplitude (body-lengths). */
const DEFAULT_AMP_HEAD = 0.02;
/** Default carangiform tail amplitude (body-lengths). */
const DEFAULT_AMP_TAIL = 0.12;
/** Default body length when the catalog entry can't be resolved (mm). */
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
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  /**
   * React to a new scene from the store. Re-spawn entities only when
   * `(seed, livestock fingerprint)` changes; an unrelated scene
   * mutation (e.g. a plant moved) leaves the existing ECS state alone.
   */
  private onSceneChanged(scene: Scene): void {
    const livestock = scene.livestock ?? [];
    const key = this.spawnKey(scene.seed, livestock);

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

    // First time we see livestock — build the world.
    if (this.world === null) {
      this.world = createLivestockWorld(scene.seed);
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
      this.world = createLivestockWorld(scene.seed);
    } else {
      this.despawnAll(this.world);
    }
    this.spawnAll(this.world, scene, livestock);
    this.lastSpawnKey = key;
  }

  /**
   * Build a stable string fingerprint of the inputs that drive spawn
   * layout. Two scenes with the same fingerprint MUST produce the same
   * spawned-entity set (determinism invariant).
   */
  private spawnKey(seed: number, livestock: readonly LivestockEntry[]): string {
    const parts = livestock.map((e) => `${e.id}:${e.ref.catalog}/${e.ref.id}@${e.ref.version}:${e.quantity}`);
    parts.sort();
    return `${seed | 0}|${parts.join('|')}`;
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

  /** Walk every livestock entry and spawn its quota into the world. */
  private spawnAll(world: LivestockWorld, scene: Scene, livestock: readonly LivestockEntry[]): void {
    for (const entry of livestock) {
      this.spawnEntry(world, scene, entry);
    }
  }

  /** Spawn `entry.quantity` ECS entities for a single `LivestockEntry`. */
  private spawnEntry(world: LivestockWorld, scene: Scene, entry: LivestockEntry): void {
    const catalogRow = this.catalog.get(entry.ref);
    // The entry could be missing (broken catalog ref). Fall back to a
    // generic slim-tetra at 35 mm — at worst the user sees a small
    // tetra-shaped placeholder instead of nothing.
    const archetype = resolveArchetype(catalogRow);
    const speciesId = (seededHash01(0, hashStringTo32(entry.ref.id)) * 65535) | 0;
    const bodyLengthMm = resolveBodyLengthMm(catalogRow);

    // Tail-beat frequency / amplitudes come from the catalog's optional
    // `behavior.animation` block when present (F11.2+ adds the block on
    // the schema; F11.1's spawning is forward-compatible by reading
    // through an `unknown` cast). Until the block lands, every spawn
    // uses the workspace defaults.
    const behaviorAnim = readBehaviorAnimation(catalogRow);
    const tailBeatFreq = behaviorAnim?.tailBeatFreq ?? DEFAULT_TAIL_BEAT_FREQ_HZ;
    const ampHead = behaviorAnim?.ampHead ?? DEFAULT_AMP_HEAD;
    const ampTail = behaviorAnim?.ampTail ?? DEFAULT_AMP_TAIL;

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
        speciesId,
        bodyLengthMm,
        position: { x, y, z },
        orientation,
        tailBeatFreq,
        ampHead,
        ampTail,
        phaseOffset: rPhase * Math.PI * 2,
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
 * Read the optional `behavior.animation` block from a catalog row when
 * present. F11.1's catalog schema doesn't declare the field yet (F11.2+
 * adds it on the `behavior` block); the cast keeps this forward-
 * compatible without a schema bump in F11.1.
 */
function readBehaviorAnimation(
  catalogRow: unknown,
): { tailBeatFreq?: number; ampHead?: number; ampTail?: number } | null {
  if (catalogRow === null || catalogRow === undefined) return null;
  const row = catalogRow as {
    behavior?: { animation?: { tailBeatFreq?: number; ampHead?: number; ampTail?: number } };
  };
  return row.behavior?.animation ?? null;
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
