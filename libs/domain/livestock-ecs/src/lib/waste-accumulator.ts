/**
 * Waste → chemistry source term (Stage 14 F14.4 — PRODUCER side only).
 *
 * Closes the feed → waste → bioload → nitrogen loop on the SIM side: the world
 * accumulates an ammonia SOURCE TERM (nitrogen mass rate, mg-N/day) from two
 * contributions and exposes it via `world.getWasteSourceN()`. A future
 * `WaterChemistryService` (Stage 13 F13.3 — DEFERRED; not in this PR) reads
 * that value each chemistry tick and feeds it into `simulateChemistry`'s
 * `sourceN` argument. This PR lands the producer; the consumer is documented
 * as pending (see `docs/caveats/water-sim.md`).
 *
 * Two contributions:
 *
 *   1. PER-FISH BASELINE — every fish excretes ammonia continuously (gill +
 *      urine). Accumulated each tick as `fishCount * FISH_BASELINE_WASTE_N_MG_PER_DAY`,
 *      time-weighted by `dt` into a running mg-N total, then re-expressed as a
 *      smoothed mg-N/day rate (see the EMA below). This is the steady bioload
 *      floor a stocked tank always carries.
 *
 *   2. UNEATEN FOOD — when a `FoodSprite` despawns by LIFETIME expiry (rotted,
 *      never eaten) `foodSpriteLifetimeSystem` calls `recordUneatenFood(world,
 *      calories, wasteFactor)`. The nitrogen released scales with the sprite's
 *      `calories` (proxy for food mass) AND its catalog `wasteFactor` (uneaten
 *      food wastes more — exactly the F14.1 mapping). An EATEN sprite (consumed
 *      by `feedingSystem`, `removeEntity` directly) contributes NOTHING here —
 *      its nitrogen became fish bioload, counted under contribution (1).
 *
 * DETERMINISM: pure scalar accumulation in fixed eid-order iteration; no random
 * draws, no wall-clock. A world with no food + a fixed fish count produces a
 * byte-identical `getWasteSourceN()` trace across two cold worlds.
 *
 * The accumulator is HOST-DRIVEN, allocation-free, and lives on the world so a
 * future chemistry tick can poll it between sim ticks without reaching into the
 * ECS slabs.
 */
import { defineQuery } from 'bitecs';
import { Position, Orientation } from './components';
import type { LivestockWorld } from './world';

// Fish = entities with Position + Orientation (food sprites + bubbles lack
// Orientation). Same discriminator the snapshot's fish slab uses.
const fishQuery = defineQuery([Position, Orientation]);

/**
 * Steady per-fish ammonia excretion, expressed as nitrogen mass per day
 * (mg-N/day). A loose hobby figure: a small community fish contributes on the
 * order of a fraction of a mg-N/day of dissolved ammonia. Tuned so a typical
 * stocked tank's baseline source term lands in the same ballpark the
 * `domain/stocking` bioload uses to drive `simulateChemistry`. A labelled
 * approximation, not a measured excretion rate.
 */
export const FISH_BASELINE_WASTE_N_MG_PER_DAY = 0.6;

/**
 * Nitrogen released per unit of `FoodSprite.calories` when a sprite rots
 * uneaten, at `wasteFactor = 1`. Scaled by the sprite's actual `wasteFactor`
 * so a high-waste food (e.g. a fatty flake) releases more than a clean pellet.
 * mg-N per calorie-unit. A labelled approximation tuned so an unattended feed
 * of a few uneaten sprites produces a noticeable but non-catastrophic ammonia
 * pulse on top of the baseline.
 */
export const UNEATEN_FOOD_WASTE_N_MG_PER_CALORIE = 8;

/**
 * EMA smoothing factor per second for the source-term rate. The uneaten-food
 * contribution arrives in discrete impulses (a sprite rots in one tick); a raw
 * per-tick rate would spike to a huge instantaneous value then drop to the
 * baseline. We instead fold each tick's released nitrogen into a smoothed
 * mg-N/day rate so the future chemistry consumer reads a stable source. The
 * EMA half-life is a few minutes — long enough to spread a feed's waste, short
 * enough to track stocking changes.
 */
export const WASTE_RATE_EMA_PER_SEC = 0.01;

/**
 * Per-world mutable waste state. Holds the smoothed source-term rate the
 * chemistry consumer reads, plus the per-tick impulse bucket uneaten food
 * folds into. Reset on `dispose`.
 */
export interface WasteAccumulator {
  /**
   * Smoothed ammonia source term in nitrogen mass per day (mg-N/day). This is
   * the value `getWasteSourceN()` returns and the future `WaterChemistryService`
   * feeds into `simulateChemistry`'s `sourceN`.
   */
  sourceNMgPerDay: number;
  /**
   * Nitrogen (mg-N) released by uneaten food THIS tick, before it's folded
   * into the smoothed rate. Reset to 0 at the end of every `wasteSystem` call.
   */
  pendingUneatenN: number;
}

/** Build a zeroed waste accumulator. */
export function makeWasteAccumulator(): WasteAccumulator {
  return { sourceNMgPerDay: 0, pendingUneatenN: 0 };
}

/**
 * Record nitrogen released by an UNEATEN food sprite that's despawning by
 * lifetime expiry. Called from `foodSpriteLifetimeSystem` the moment a sprite
 * rots. `calories` is the sprite's remaining satiation (proxy for mass);
 * `wasteFactor ∈ [0, 1]` is the catalog row's modelled waste fraction. The
 * released nitrogen is bucketed into `pendingUneatenN` and folded into the
 * smoothed rate by `wasteSystem` the same tick.
 */
export function recordUneatenFood(
  world: LivestockWorld,
  calories: number,
  wasteFactor: number,
): void {
  const wf = wasteFactor < 0 ? 0 : wasteFactor > 1 ? 1 : wasteFactor;
  const cal = calories > 0 ? calories : 0;
  world.__waste.pendingUneatenN += cal * wf * UNEATEN_FOOD_WASTE_N_MG_PER_CALORIE;
}

/**
 * Advance the waste accumulator one sim tick. Folds the per-fish baseline plus
 * any uneaten-food impulse recorded this tick into the smoothed mg-N/day rate.
 *
 * Runs at the END of `world.step()`, AFTER `foodSpriteLifetimeSystem` (so the
 * `pendingUneatenN` bucket already holds this tick's rotted-food nitrogen) —
 * the same tail seat the bubble systems run in. Pure scalar math; allocation-free.
 */
export function wasteSystem(world: LivestockWorld, dt: number): void {
  const acc = world.__waste;
  const fishCount = fishQuery(world.ecs).length;

  // Instantaneous source rate (mg-N/day) this tick:
  //   - baseline: every fish excretes continuously.
  //   - uneaten food: this tick's rotted nitrogen, re-expressed as a daily
  //     rate (the impulse `pendingUneatenN` mg-N landed over `dt` seconds →
  //     `pendingUneatenN / dt * SECONDS_PER_DAY` mg-N/day before smoothing).
  const baselineRate = fishCount * FISH_BASELINE_WASTE_N_MG_PER_DAY;
  const SECONDS_PER_DAY = 86400;
  const uneatenRate =
    dt > 0 ? (acc.pendingUneatenN / dt) * SECONDS_PER_DAY : 0;
  const instantRate = baselineRate + uneatenRate;

  // EMA toward the instantaneous rate so discrete food impulses don't spike
  // the source term the chemistry consumer reads.
  const a = WASTE_RATE_EMA_PER_SEC * dt;
  const alpha = a < 1 ? a : 1;
  acc.sourceNMgPerDay += (instantRate - acc.sourceNMgPerDay) * alpha;

  // Drain the per-tick impulse bucket.
  acc.pendingUneatenN = 0;
}
