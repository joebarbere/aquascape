/**
 * Per-species `ResolvedBehavior` table owned by a `LivestockWorld`.
 *
 * Why this exists: Couzin / Reynolds schooling params (`SchoolingParams`,
 * `DepthParams`) are species-level — every neon tetra reads the same eleven
 * floats. Storing them on each entity component would burn ~88 B per fish
 * for data that never changes during the entity's lifetime; in a 200-fish
 * school that's 17 kB of redundant Float32 reads inside the tightest
 * possible hot loop. Instead we keep one `ResolvedBehavior` object per
 * species and have entities point at it via `BehaviorParamsRef.handleIdx`.
 *
 * The store is append-only — registering a new species adds a row, and
 * existing rows never change identity. Behaviour systems can therefore
 * cache `paramStore.get(handle)` across the inner-loop iterations of a
 * single tick without worrying about the row moving underneath them.
 *
 * `maxNeighbourRadius()` is the only "computed" surface: PerceptionSystem
 * reads it once per tick to size the SpatialGrid's cell. Recomputing on
 * every read would be O(species); we cache + invalidate on register/clear.
 */
import type { ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';

/**
 * Sentinel value stored on `BehaviorParamsRef.handleIdx` when an entity has
 * no registered species behaviour. Equivalent to F11.1's static-wiggle
 * path — behaviour systems short-circuit and leave Velocity / Force alone.
 *
 * 0xffff is the maximum value of a `ui16` component slab, so we can never
 * collide with a legitimate registered handle (the store's append index
 * starts at 0 and the upper bound is enforced by the registration path).
 */
export const NO_BEHAVIOR_HANDLE = 0xffff;

/**
 * The append-only species → ResolvedBehavior table on each world. Construct
 * via `new ParamStore()`; mutate only through `registerSpecies` /
 * `clear`. Behaviour systems read via `get` and the cached
 * `maxNeighbourRadius`.
 */
export class ParamStore {
  /** species id (catalog-hash) → handleIdx. Cheap re-registration guard. */
  private readonly bySpeciesId = new Map<number, number>();
  /** handleIdx → ResolvedBehavior. Index 0 is the first registered row. */
  private readonly rows: ResolvedBehavior[] = [];
  /**
   * Cached `max(ZOR, ZOO, ZOA)` across every registered species. Read by
   * PerceptionSystem each tick to size the SpatialGrid cell. Recomputed
   * lazily on first read after each register / clear.
   */
  private cachedMaxRadius: number | null = null;

  /**
   * Register (or re-register) a species' behaviour. Returns a stable
   * handle index that callers should store on `BehaviorParamsRef`.
   *
   * Idempotent: registering the same `speciesId` twice updates the existing
   * row in place and returns the same handle. The "in place" path matters
   * because entities already holding the handle keep pointing at the
   * updated row — no entity rewrite needed when a catalog value is tuned.
   */
  registerSpecies(speciesId: number, behavior: ResolvedBehavior): number {
    const existing = this.bySpeciesId.get(speciesId);
    if (existing !== undefined) {
      this.rows[existing] = behavior;
      this.cachedMaxRadius = null;
      return existing;
    }
    if (this.rows.length >= NO_BEHAVIOR_HANDLE) {
      // ui16 max — defensive guard; nobody runs 65k species in one tank
      // but the typed-array slot can't store the sentinel as a valid row.
      throw new Error(`ParamStore exceeded ${NO_BEHAVIOR_HANDLE} species capacity`);
    }
    const handle = this.rows.length;
    this.rows.push(behavior);
    this.bySpeciesId.set(speciesId, handle);
    this.cachedMaxRadius = null;
    return handle;
  }

  /**
   * Read the ResolvedBehavior at `handleIdx`. Returns null for the
   * `NO_BEHAVIOR_HANDLE` sentinel or any out-of-range index. Behaviour
   * systems skip entities whose handle resolves to null.
   */
  get(handleIdx: number): ResolvedBehavior | null {
    if (handleIdx === NO_BEHAVIOR_HANDLE) return null;
    if (handleIdx < 0 || handleIdx >= this.rows.length) return null;
    return this.rows[handleIdx] ?? null;
  }

  /**
   * Largest `max(ZOR, ZOO, ZOA)` across every registered species. Drives
   * the SpatialGrid cell size. Returns 0 when nothing is registered —
   * PerceptionSystem treats that as a no-op (no behaviour systems can
   * fire anyway when there are no behaviour-tagged entities).
   */
  maxNeighbourRadius(): number {
    if (this.cachedMaxRadius !== null) return this.cachedMaxRadius;
    let max = 0;
    for (const row of this.rows) {
      const s = row.schooling;
      if (s.ZOR > max) max = s.ZOR;
      if (s.ZOO > max) max = s.ZOO;
      if (s.ZOA > max) max = s.ZOA;
    }
    this.cachedMaxRadius = max;
    return max;
  }

  /** Number of registered species rows. */
  get size(): number {
    return this.rows.length;
  }

  /** Drop every registered species. Called by `LivestockWorld.dispose`. */
  clear(): void {
    this.bySpeciesId.clear();
    this.rows.length = 0;
    this.cachedMaxRadius = null;
  }
}
