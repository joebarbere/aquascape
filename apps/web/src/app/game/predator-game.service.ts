// PredatorGameService (Stage 16 F16.4) — the app-layer predator RULES loop.
//
// This is the GLUE that turns the generic playable shell (F16.1b) into the
// predator GAME: each frame it reads the live world, detects which prey the
// player has caught (pure `detectCatches` from `@aquascape/features/game`),
// despawns those prey, awards a point each, and evaluates the win/lose
// condition (target catches before the time limit) — dispatching the shared
// game state machine on the first decided outcome.
//
// WHERE THE LOGIC LIVES (layer discipline):
//   - PURE rules (catch detection given positions, win/lose, countdown) live in
//     `@aquascape/features/game` → `predator-rules.ts`, exhaustively unit-tested
//     framework-free.
//   - This SERVICE owns the WORLD MUTATION (despawn) + the per-frame wiring +
//     the GameModeService dispatch. It's app-scoped because it touches a
//     concrete `LivestockWorld` (a domain object) + the game service.
//
// DETERMINISM BOUNDARY (load-bearing — see docs/caveats/game-modes.md +
// livestock-ecs.md). A catch is a NON-deterministic GAME EVENT: it's gated on
// the LIVE player position, which comes from live input. So the despawn it
// triggers must stay OUT of the replay-critical deterministic sim core — and it
// does: this loop only runs while an ACTIVE predator game has a live player
// marked. A non-game world (no player) never instantiates this service's frame
// loop, so the 1000-tick byte-identical replay holds. The despawn mutates the
// world's entity set OUTSIDE world.step() (between sim ticks), exactly like the
// editor's add/remove livestock — it is not part of the seeded tick stream.

import { Injectable, inject } from '@angular/core';

import {
  GameModeService,
  DEFAULT_PREDATOR_PARAMS,
  detectCatches,
  evaluatePredatorOutcome,
  type PredatorRuleParams,
  type PreyCandidate,
} from '@aquascape/features/game';
import type { LivestockWorld } from '@aquascape/domain/livestock-ecs';

@Injectable({ providedIn: 'root' })
export class PredatorGameService {
  private readonly game = inject(GameModeService);

  /** The live world for the active run, or null when not running. */
  private world: LivestockWorld | null = null;
  /** The player's eid for the active run (excluded from the prey scan). */
  private playerEid = -1;
  /** Tuning for the active run. */
  private params: PredatorRuleParams = DEFAULT_PREDATOR_PARAMS;
  /** True once a terminal outcome has been dispatched (don't re-fire). */
  private decided = false;
  /** Scratch prey buffer reused each frame to avoid per-frame GC. */
  private readonly prey: PreyCandidate[] = [];

  /**
   * Begin the predator rules for `world` with `playerEid` marked as the
   * player. Flags the player a PREDATOR (reusing FearSystem so prey flee) and
   * resets the per-run state. Call `stop()` on leave. Idempotent — a re-`start`
   * re-binds cleanly.
   */
  start(world: LivestockWorld, playerEid: number, params = DEFAULT_PREDATOR_PARAMS): void {
    this.world = world;
    this.playerEid = playerEid;
    this.params = params;
    this.decided = false;
    // Reuse the existing Predator tag → prey flee the player via FearSystem.
    world.setPlayerPredator(true);
  }

  /** Tear down the rules loop. The player tag/predator flag are cleared by the host's `world.clearPlayer()`. */
  stop(): void {
    this.world = null;
    this.playerEid = -1;
    this.decided = false;
    this.prey.length = 0;
  }

  /**
   * Run one frame of predator rules. Called by the app's per-frame loop while
   * the run is live. No-op when not bound, not live, or already decided.
   * Returns the number of prey caught this frame (tests assert on it).
   *
   * `_dtSec` is accepted for symmetry with the frame-hook signature; the
   * win/lose evaluation reads the GameModeService's own elapsed clock (which
   * the input loop already advances), so we don't integrate time here.
   */
  frame(_dtSec: number): number {
    const world = this.world;
    if (world === null || this.decided) return 0;
    // Only hunt while the run is live (objective / paused / results freeze it).
    if (!this.game.isLive()) return 0;

    const caught = this.runCatchDetection(world);
    if (caught > 0) {
      // One point per prey eaten — score === catches for the predator mode.
      this.game.award(caught);
    }

    // Evaluate win/lose against the live score + elapsed clock. The outcome is
    // null while the hunt is ongoing; on the first decided result we transition
    // the shared state machine once and latch `decided` so we don't re-fire.
    const points = this.game.score().points;
    const elapsed = this.game.score().elapsedSec;
    const outcome = evaluatePredatorOutcome(points, elapsed, this.params);
    if (outcome === 'won') {
      this.decided = true;
      this.game.dispatch({ type: 'win' });
    } else if (outcome === 'lost') {
      this.decided = true;
      this.game.dispatch({ type: 'lose' });
    }
    return caught;
  }

  /**
   * Build the prey list from the live snapshot (every fish except the player),
   * run the pure `detectCatches`, despawn each caught prey, and return the
   * count. The despawn is the world mutation kept OUT of the deterministic core
   * (see the file header) — it happens between sim ticks, gated on a live game.
   */
  private runCatchDetection(world: LivestockWorld): number {
    const snap = world.snapshot(0);
    const n = snap.entityCount;
    // Locate the player's position + collect the prey candidates in one pass.
    let px = 0;
    let py = 0;
    let pz = 0;
    let playerFound = false;
    this.prey.length = 0;
    for (let i = 0; i < n; i++) {
      const id = snap.ids[i] as number;
      const x = snap.position[i * 3] as number;
      const y = snap.position[i * 3 + 1] as number;
      const z = snap.position[i * 3 + 2] as number;
      if (id === this.playerEid) {
        px = x;
        py = y;
        pz = z;
        playerFound = true;
        continue;
      }
      this.prey.push({ id, x, y, z });
    }
    if (!playerFound || this.prey.length === 0) return 0;

    const caughtIds = detectCatches({ x: px, y: py, z: pz }, this.prey, this.params.catchRadiusMm);
    for (const id of caughtIds) {
      world.despawn(id);
    }
    return caughtIds.length;
  }
}
