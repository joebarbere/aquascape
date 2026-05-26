/**
 * Deterministic per-tick PRNG used by F11.2+ behavior systems.
 *
 * The whole stage's reproducibility invariant — *same `document.seed` + same
 * `SpawnOpts` + same `step()` count → bit-identical snapshot* — depends on
 * every random read inside the world going through this helper (or
 * `seededHash01` for spawn-time randomness). `Math.random()` is forbidden;
 * see this lib's `eslint.config.cjs` for the lint rule.
 *
 * Algorithm: reuses `seededHash01` from `domain/geometry`, mixing in the
 * world's seed XOR tickCounter as the first key so randomness rotates each
 * tick. Additional `keys` partition the per-tick stream (e.g. a query for
 * "noise on entity 42 axis 1" passes `(42, 1)`).
 */
import { seededHash01 } from '@aquascape/domain/geometry';
import type { LivestockWorld } from './world';

/**
 * Returns a deterministic value in `[0, 1)`. Two invocations with the same
 * `(world.seed, world.tickCounter, ...keys)` tuple always produce the same
 * result.
 */
export function tickPrng(world: LivestockWorld, ...keys: readonly number[]): number {
  // XOR-fold the tick counter into the seed so that per-tick streams are
  // independent. We pass the folded seed through `seededHash01`'s key list
  // rather than as the first arg so the variadic key path runs at least
  // once — otherwise `seededHash01(seed)` would just return the un-mixed
  // bit pattern of the seed.
  const folded = (world.seed ^ world.tickCounter) | 0;
  return seededHash01(folded, ...keys);
}
