// FeedingGameService (Stage 16 F16.3) — the app-layer feeding RULES loop.
//
// Mirrors PredatorGameService exactly (F16.4). The player swims the tank and
// EATS falling food (Stage 14 typed food sprites) by proximity. Each frame this
// service reads the live world, detects which food the player has eaten (pure
// `detectEaten` from `@aquascape/features/game`), despawns those sprites, folds
// the bites into a game-local FOOD METER + score (over-eating penalises), and
// evaluates the win/lose condition (fill the meter to win; starve to health-0
// or run out the clock below target to lose). It also periodically DROPS new
// food from the surface so there's always something to chase.
//
// WHERE THE LOGIC LIVES (layer discipline):
//   - PURE rules (eat detection, meter fill/drain, bite scoring, win/lose,
//     countdown) live in `@aquascape/features/game` → `feeding-rules.ts`,
//     exhaustively unit-tested framework-free.
//   - This SERVICE owns the WORLD MUTATION (despawn eaten sprites, spawn new
//     food) + the per-frame wiring + the GameModeService dispatch. App-scoped
//     because it touches a concrete `LivestockWorld`.
//
// DETERMINISM BOUNDARY (load-bearing — see docs/caveats/game-modes.md). An eat
// is a NON-deterministic GAME EVENT: it's gated on the LIVE player position
// (from live input). So the despawn it triggers — AND the periodic food drop —
// stay OUT of the replay-critical deterministic sim core: they run in this app
// loop only while an active feeding game has a live player marked, BETWEEN sim
// ticks, exactly like the editor's add/remove livestock. A non-game world (no
// player) never instantiates this loop, so the 1000-tick byte-identical replay
// holds. The drop positions come from a SERVICE-LOCAL LCG (never `Math.random`
// / `Date.now`, and never read inside `world.step()`), so nothing leaks into
// the seeded tick stream.

import { Injectable, inject } from '@angular/core';

import {
  GameModeService,
  DEFAULT_FEEDING_PARAMS,
  applyBites,
  detectEaten,
  drainFill,
  evaluateFeedingOutcome,
  type FeedingRuleParams,
  type FoodCandidate,
} from '@aquascape/features/game';
import {
  FOOD_TYPE,
  FoodSprite,
  Position,
  type LivestockWorld,
} from '@aquascape/domain/livestock-ecs';
import { defineQuery } from 'bitecs';

import { readEntityPosition, readPlayerVitals } from './game-activation';

/** Live food sprites with a position — the eat candidates. */
const FOOD_QUERY = defineQuery([FoodSprite, Position]);

/** Seconds between automatic food drops from the surface. */
const DROP_INTERVAL_SEC = 1.2;
/** How many sprites each drop releases. */
const DROP_BATCH = 2;
/** Keep at most this many live sprites so the tank doesn't choke. */
const MAX_LIVE_FOOD = 24;
/** Margin (mm) kept off each wall when choosing a drop column. */
const DROP_WALL_MARGIN_MM = 60;

@Injectable({ providedIn: 'root' })
export class FeedingGameService {
  private readonly game = inject(GameModeService);

  /** The live world for the active run, or null when not running. */
  private world: LivestockWorld | null = null;
  /** The player's eid for the active run (excluded from the food scan — N/A but defensive). */
  private playerEid = -1;
  /** Tuning for the active run. */
  private params: FeedingRuleParams = DEFAULT_FEEDING_PARAMS;
  /** True once a terminal outcome has been dispatched (don't re-fire). */
  private decided = false;
  /** Game-local food meter `[0, 1]` — fills per bite, drains over time. */
  private fill = 0;
  /** Seconds since the last food drop. */
  private dropTimer = 0;
  /**
   * Service-local PRNG state for drop positions. Seeded to a fixed constant on
   * `start` so a run's drop pattern is reproducible WITHOUT `Math.random`. This
   * never runs inside `world.step()`, so it can't perturb the seeded tick stream.
   */
  private rngState = 0;
  /** Scratch food buffer reused each frame to avoid per-frame GC. */
  private readonly food: FoodCandidate[] = [];

  /**
   * Begin feeding rules for `world` with `playerEid` marked as the player.
   * Resets the per-run state (empty meter, fresh drop timer + RNG seed).
   * Idempotent — a re-`start` re-binds cleanly.
   */
  start(world: LivestockWorld, playerEid: number, params = DEFAULT_FEEDING_PARAMS): void {
    this.world = world;
    this.playerEid = playerEid;
    this.params = params;
    this.decided = false;
    this.fill = 0;
    this.dropTimer = DROP_INTERVAL_SEC; // drop on the first frame so food's there immediately
    this.rngState = 0x1234_5678 >>> 0;
  }

  /** Tear down the rules loop. */
  stop(): void {
    this.world = null;
    this.playerEid = -1;
    this.decided = false;
    this.fill = 0;
    this.dropTimer = 0;
    this.food.length = 0;
  }

  /** Test-only read of the current food-meter fill (integration tests assert on it). */
  fillForTest(): number {
    return this.fill;
  }

  /**
   * Run one frame of feeding rules. Called by the app's per-frame loop while
   * the run is live. No-op when not bound, not live, or already decided.
   * Returns the number of food sprites eaten this frame (tests assert on it).
   */
  frame(dtSec: number): number {
    const world = this.world;
    if (world === null || this.decided) return 0;
    if (!this.game.isLive()) return 0;

    // 1. Drop new food periodically (the world mutation kept out of step()).
    this.maybeDropFood(world, dtSec);

    // 2. Drain the meter (hunger creeps back), THEN fold in this frame's bites.
    this.fill = drainFill(this.fill, dtSec, this.params);

    const player = readEntityPosition(world, this.playerEid);
    let eaten = 0;
    if (player !== null) {
      eaten = this.runEatDetection(world, player);
      if (eaten > 0) {
        const res = applyBites(this.fill, eaten, this.params);
        this.fill = res.fill;
        if (res.scoreDelta !== 0) this.game.award(res.scoreDelta);
      }
    }

    // 3. Push the player's REAL health + the game-local meter to the HUD. The
    //    feeding HUD's "Food" bar IS the game meter (not the fish's intrinsic
    //    hunger) so the bar tracks the objective directly.
    const vitals = readPlayerVitals(world, this.playerEid);
    this.game.setVitality(vitals.health, this.fill, null);

    // 4. Evaluate win/lose against the meter + health + clock.
    const elapsed = this.game.score().elapsedSec;
    const outcome = evaluateFeedingOutcome(this.fill, vitals.health, elapsed, this.params);
    if (outcome === 'won') {
      this.decided = true;
      this.game.dispatch({ type: 'win' });
    } else if (outcome === 'lost') {
      this.decided = true;
      this.game.dispatch({ type: 'lose' });
    }
    return eaten;
  }

  /**
   * Build the food list from the live world, run the pure `detectEaten`, and
   * despawn each eaten sprite. The despawn is the world mutation kept OUT of the
   * deterministic core (see the file header) — between sim ticks, gated on a
   * live game. Returns the count eaten.
   */
  private runEatDetection(world: LivestockWorld, player: { x: number; y: number; z: number }): number {
    this.food.length = 0;
    const eids = FOOD_QUERY(world.ecs);
    for (const eid of eids) {
      if (eid === this.playerEid) continue; // food sprites are never the player; defensive
      this.food.push({
        id: eid,
        x: Position.x[eid] as number,
        y: Position.y[eid] as number,
        z: Position.z[eid] as number,
      });
    }
    if (this.food.length === 0) return 0;

    const eatenIds = detectEaten(player, this.food, this.params.eatRadiusMm);
    for (const id of eatenIds) {
      world.despawn(id);
    }
    return eatenIds.length;
  }

  /**
   * Drop a batch of food from the surface every `DROP_INTERVAL_SEC`, capped at
   * `MAX_LIVE_FOOD` live sprites. Drop columns come from the service-local LCG
   * (deterministic per run, never `Math.random`). The food then sinks per its
   * `FOOD_TYPE` kinematics via the sim's `foodSpriteKinematicSystem` — we only
   * place the drop.
   */
  private maybeDropFood(world: LivestockWorld, dtSec: number): void {
    this.dropTimer += dtSec;
    if (this.dropTimer < DROP_INTERVAL_SEC) return;
    this.dropTimer = 0;
    if (world.getFoodSpriteCount() >= MAX_LIVE_FOOD) return;

    const aabb = world.tankAabb;
    const surfaceY = aabb.maxY - 5; // just under the rim
    const minX = aabb.minX + DROP_WALL_MARGIN_MM;
    const spanX = Math.max(0, aabb.maxX - aabb.minX - 2 * DROP_WALL_MARGIN_MM);
    const minZ = aabb.minZ + DROP_WALL_MARGIN_MM;
    const spanZ = Math.max(0, aabb.maxZ - aabb.minZ - 2 * DROP_WALL_MARGIN_MM);

    for (let i = 0; i < DROP_BATCH; i++) {
      const x = minX + this.nextRandom() * spanX;
      const z = minZ + this.nextRandom() * spanZ;
      // Flakes float-then-sink, giving the player a beat to reach them.
      world.spawnFoodSprite({ x, y: surfaceY, z }, undefined, undefined, FOOD_TYPE.FLAKE);
    }
  }

  /** A deterministic `[0, 1)` draw from the service-local LCG (no `Math.random`). */
  private nextRandom(): number {
    // Numerical Recipes LCG — plenty for cosmetic drop scatter.
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 0x1_0000_0000;
  }
}
