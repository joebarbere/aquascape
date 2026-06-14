/**
 * Per-type food-sprite kinematics (Stage 14 F14.1).
 *
 * Stage 11 F11.4 spawned every food sprite stationary at the water surface
 * and let `foodSpriteLifetimeSystem` tick its lifetime down. F14.1 makes the
 * four catalog food forms (`FOOD_TYPE.*`) fall + settle differently, so a
 * tank of mixed food reads as physically distinct drops:
 *
 *   - FLAKE  — floats at the surface for `floatRemaining` seconds, then
 *              transitions to a slow, gentle sink (light flakes drift down).
 *   - PELLET — sinks fast from the moment it's dropped (dense granules).
 *   - WAFER  — sinks at a medium rate, then RESTS on the substrate (the disc
 *              settles flat at the floor and stays put for bottom grazers).
 *   - LIVE   — near-neutral buoyancy with a deterministic erratic DART
 *              (live/frozen prey twitch through the column).
 *
 * DETERMINISM (load-bearing): the sink is pure height/physics — vertical
 * velocity integrates a per-type terminal speed; the substrate clamp is a
 * positional comparison. The ONLY entropy is the live-food dart, whose
 * lateral + vertical jitter come from `tickPrng(world, FOOD_KINEMATIC_KEY,
 * spawnIndex, axis)` keyed by the sprite's STABLE `spawnIndex` (never the
 * bitECS eid, never `Math.random`, never wall-clock). Two cold worlds built
 * from the same seed + the same spawn sequence therefore advect every sprite
 * identically — the 1000-tick byte-identical replay holds.
 *
 * This system runs in the FoodSprite seat just BEFORE `foodSpriteLifetimeSystem`
 * (which despawns expired sprites) so the position the renderer reads this
 * tick already reflects the sink. It never allocates in the hot loop.
 */
import { defineQuery } from 'bitecs';
import { FOOD_TYPE, FoodSprite, Position } from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

const foodSpriteQuery = defineQuery([FoodSprite, Position]);

/**
 * `tickPrng` partition key for the live-food dart. An FNV-1a fold of the
 * literal `'food-kinematic'` string so the stream sits clear of the
 * per-entity behaviour keys (small integers) and the feed-tank / bubble
 * keys. Module-scope constant — two worlds at the same tick draw the same
 * stream layout.
 */
export const FOOD_KINEMATIC_KEY = (() => {
  let h = 0x811c9dc5;
  const s = 'food-kinematic';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

// ─── Per-type terminal speeds (mm/s) ──────────────────────────────────────
// Signed: positive = rising, negative = sinking. Tuned so the four forms
// read distinct on the 30 Hz / time-slider scale: a flake takes a few
// seconds to cross the column, a pellet a fraction of that.

/** Initial upward velocity a flake floats at while buoyant (mm/s). */
export const FLAKE_FLOAT_VY_MM_PER_S = 6;
/** Seconds a flake stays buoyant before it begins to sink. */
export const FLAKE_FLOAT_SECONDS = 4;
/** Terminal sink speed of a flake once it stops floating (mm/s, negative). */
export const FLAKE_SINK_VY_MM_PER_S = -18;
/** Terminal sink speed of a fast-sinking pellet (mm/s, negative). */
export const PELLET_SINK_VY_MM_PER_S = -90;
/** Terminal sink speed of a wafer before it settles (mm/s, negative). */
export const WAFER_SINK_VY_MM_PER_S = -60;
/** Baseline (drift) vertical speed of near-neutral live food (mm/s). */
export const LIVE_DRIFT_VY_MM_PER_S = -8;

/**
 * Rate (1/s) at which a sprite's vertical velocity relaxes toward its
 * per-type terminal speed. A first-order approach so the drop eases in
 * rather than teleporting to terminal velocity on tick 1 — physically the
 * "water drag ramps the sprite up to terminal velocity" read.
 */
export const SINK_RELAX_PER_SEC = 6;

/** Peak lateral dart speed for live food (mm/s). */
export const LIVE_DART_SPEED_MM_PER_S = 45;
/** Peak vertical bob speed added to live food on top of its drift (mm/s). */
export const LIVE_BOB_SPEED_MM_PER_S = 30;

/**
 * Per-type terminal vertical velocity (mm/s). Flakes return their FLOAT or
 * SINK speed depending on whether the float window is still open.
 */
function terminalVy(foodType: number, floatRemaining: number): number {
  switch (foodType) {
    case FOOD_TYPE.FLAKE:
      return floatRemaining > 0 ? FLAKE_FLOAT_VY_MM_PER_S : FLAKE_SINK_VY_MM_PER_S;
    case FOOD_TYPE.PELLET:
      return PELLET_SINK_VY_MM_PER_S;
    case FOOD_TYPE.WAFER:
      return WAFER_SINK_VY_MM_PER_S;
    case FOOD_TYPE.LIVE:
      return LIVE_DRIFT_VY_MM_PER_S;
    default:
      return FLAKE_SINK_VY_MM_PER_S;
  }
}

/**
 * Initialise the kinematic state for a newly-spawned sprite of `foodType`.
 * Called from `world.spawnFoodSprite`. Flakes start at their float velocity
 * with a float window; every other form starts at rest (vy = 0) and ramps
 * toward its terminal sink speed via `SINK_RELAX_PER_SEC` so the drop eases
 * in. Returns the `(vy, floatRemaining)` pair the slab is seeded with.
 */
export function initialFoodKinematics(foodType: number): {
  vy: number;
  floatRemaining: number;
} {
  if (foodType === FOOD_TYPE.FLAKE) {
    return { vy: FLAKE_FLOAT_VY_MM_PER_S, floatRemaining: FLAKE_FLOAT_SECONDS };
  }
  return { vy: 0, floatRemaining: 0 };
}

/**
 * Advance every food sprite's vertical (and, for live food, lateral)
 * position by one fixed sim tick. Runs before `foodSpriteLifetimeSystem`
 * in `world.step()`.
 *
 * Substrate rest: a sprite whose centre would dip below `tankAabb.minY`
 * is pinned to the floor with `vy = 0` — wafers (and any settled food)
 * then stay put for substrate feeders to graze. Surface clamp: a buoyant
 * flake never rises past the waterline (`tankAabb.maxY`).
 */
export function foodSpriteKinematicSystem(world: LivestockWorld, dt: number): void {
  const ecs = world.ecs;
  const aabb = world.tankAabb;
  const floorY = aabb.minY;
  const surfaceY = aabb.maxY;

  for (const eid of foodSpriteQuery(ecs)) {
    const foodType = FoodSprite.foodType[eid] as number;

    // Flake float-window countdown (clamped at 0). Non-flakes carry 0.
    let floatRemaining = FoodSprite.floatRemaining[eid] as number;
    if (floatRemaining > 0) {
      floatRemaining -= dt;
      if (floatRemaining < 0) floatRemaining = 0;
      FoodSprite.floatRemaining[eid] = floatRemaining;
    }

    // First-order relaxation of vy toward the per-type terminal speed.
    const target = terminalVy(foodType, floatRemaining);
    let vy = FoodSprite.vy[eid] as number;
    const relax = SINK_RELAX_PER_SEC * dt;
    vy += (target - vy) * (relax < 1 ? relax : 1);

    let y = (Position.y[eid] as number) + vy * dt;
    let x = Position.x[eid] as number;
    let z = Position.z[eid] as number;

    // Live food darts: deterministic erratic lateral motion + vertical bob
    // on top of the near-neutral drift. Keyed by the STABLE spawnIndex so
    // two cold worlds dart identically. We add a velocity (not a position)
    // so the dart integrates smoothly and the substrate clamp still applies.
    if (foodType === FOOD_TYPE.LIVE) {
      const idx = FoodSprite.spawnIndex[eid] as number;
      // Re-centre the [0,1) draws to [-1, 1) per axis. The tick counter is
      // folded into tickPrng's seed already, so passing only (key, idx,
      // axis) still rotates the stream every tick.
      const dartX = (tickPrng(world, FOOD_KINEMATIC_KEY, idx, 0) * 2 - 1) * LIVE_DART_SPEED_MM_PER_S;
      const dartZ = (tickPrng(world, FOOD_KINEMATIC_KEY, idx, 2) * 2 - 1) * LIVE_DART_SPEED_MM_PER_S;
      const bob = (tickPrng(world, FOOD_KINEMATIC_KEY, idx, 1) * 2 - 1) * LIVE_BOB_SPEED_MM_PER_S;
      x += dartX * dt;
      z += dartZ * dt;
      y += bob * dt;
    }

    // Substrate rest — pin to the floor + kill vertical velocity so settled
    // food (wafers especially) stays put.
    if (y <= floorY) {
      y = floorY;
      vy = 0;
    } else if (y >= surfaceY) {
      // Buoyant flakes can't breach the waterline.
      y = surfaceY;
      if (vy > 0) vy = 0;
    }

    // Keep live-food lateral darts inside the glass.
    if (x < aabb.minX) x = aabb.minX;
    else if (x > aabb.maxX) x = aabb.maxX;
    if (z < aabb.minZ) z = aabb.minZ;
    else if (z > aabb.maxZ) z = aabb.maxZ;

    Position.x[eid] = x;
    Position.y[eid] = y;
    Position.z[eid] = z;
    FoodSprite.vy[eid] = vy;
  }
}
