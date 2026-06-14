// SurvivalGameService (Stage 16 F16.2) — the app-layer survival RULES loop.
//
// Mirrors PredatorGameService exactly (F16.4). The player is PREY: the existing
// `Predator`-tagged agents hunt them via the existing `FearSystem` proximity
// path (no parallel hunt code), and the player flees with the keyboard, using
// hardscape as cover. Each frame this service reads the live world, finds the
// nearest predators, and:
//
//   - flips the run to LOST if a predator is within the catch radius (caught),
//     or if the player's Stage 14 health hits 0, or stamina runs out,
//   - flips to WON once the player survives `timeLimitSec`,
//   - steps a game-local STAMINA bar (drains while a predator is in threat
//     range, recovers when safe) + awards the seconds-survived score,
//   - pushes the player's real `HealthDrive.health` + fullness + stamina onto
//     the HUD (replacing the F16.1 placeholder).
//
// WHERE THE LOGIC LIVES (layer discipline):
//   - PURE rules (caught/threat detection, stamina step, win/lose, countdown)
//     live in `@aquascape/features/game` → `survival-rules.ts`, exhaustively
//     unit-tested framework-free.
//   - This SERVICE owns the WORLD READS (predator + player positions, the
//     vitality slabs) + the per-frame wiring + the GameModeService dispatch.
//     It's app-scoped because it touches a concrete `LivestockWorld`.
//
// DETERMINISM BOUNDARY (load-bearing — see docs/caveats/game-modes.md). Being
// caught is a NON-deterministic GAME EVENT: it's gated on the LIVE player
// position (from live input). This loop runs ONLY while an active survival game
// has a live player marked, and it MUTATES NOTHING in the world (it only reads
// snapshots + queries) — the lose/win is a state-machine transition, not a sim
// change. A non-game world (no player) never instantiates this loop, so the
// 1000-tick byte-identical replay holds. The player does NOT chase predators
// into the sim core; predators roam as normal AI and the player avoids them.

import { Injectable, inject } from '@angular/core';

import {
  GameModeService,
  DEFAULT_SURVIVAL_PARAMS,
  SURVIVAL_MAX_STAMINA,
  evaluateSurvivalOutcome,
  isCaught,
  isThreatened,
  stepStamina,
  survivalScoreFor,
  type PredatorCandidate,
  type SurvivalRuleParams,
} from '@aquascape/features/game';
import {
  Orientation,
  Position,
  Predator,
  type LivestockWorld,
} from '@aquascape/domain/livestock-ecs';
import { addComponent, defineQuery, hasComponent, removeComponent } from 'bitecs';

import { readEntityPosition, readPlayerVitals } from './game-activation';

/** Predator-tagged entities with a position — the threats that hunt the player. */
const PREDATOR_QUERY = defineQuery([Predator, Position]);
/** All fish (Orientation discriminates fish from food sprites) — the hunter pool. */
const FISH_QUERY = defineQuery([Position, Orientation]);

/** How many existing fish are promoted to roaming predators at game start. */
const HUNTER_COUNT = 3;

@Injectable({ providedIn: 'root' })
export class SurvivalGameService {
  private readonly game = inject(GameModeService);

  /** The live world for the active run, or null when not running. */
  private world: LivestockWorld | null = null;
  /** The player's eid for the active run (excluded from the predator scan). */
  private playerEid = -1;
  /** Tuning for the active run. */
  private params: SurvivalRuleParams = DEFAULT_SURVIVAL_PARAMS;
  /** True once a terminal outcome has been dispatched (don't re-fire). */
  private decided = false;
  /** Game-local stamina `[0, 1]` — drains near predators, recovers when safe. */
  private stamina = SURVIVAL_MAX_STAMINA;
  /** Scratch predator buffer reused each frame to avoid per-frame GC. */
  private readonly predators: PredatorCandidate[] = [];
  /** The eids we promoted to predators on start, so `stop` can demote exactly them. */
  private readonly promoted: number[] = [];

  /**
   * Begin survival rules for `world` with `playerEid` marked as the player.
   * The player is PREY — we do NOT tag it `Predator` (it's the existing
   * `Predator` agents that hunt it). Resets the per-run state. Idempotent.
   *
   * If the loaded scene has no predators of its own, we PROMOTE a few existing
   * fish to roaming predators (between ticks, app-layer — never inside
   * `world.step()`) so survival always has a threat regardless of scene. This
   * mutation is reverted on `stop`/leave (the seam is gated on an active game),
   * so a non-game world is never touched and replays byte-identically.
   */
  start(world: LivestockWorld, playerEid: number, params = DEFAULT_SURVIVAL_PARAMS): void {
    this.world = world;
    this.playerEid = playerEid;
    this.params = params;
    this.decided = false;
    this.stamina = SURVIVAL_MAX_STAMINA;
    this.promoted.length = 0;
    this.ensureHunters(world, playerEid);
  }

  /** Tear down the rules loop. The player tag is cleared by the host's `world.clearPlayer()`. */
  stop(): void {
    const world = this.world;
    if (world !== null) {
      // Demote exactly the fish we promoted so a formerly-hunter fish doesn't
      // keep scaring prey once the game ends.
      for (const eid of this.promoted) {
        if (hasComponent(world.ecs, Predator, eid)) removeComponent(world.ecs, Predator, eid);
      }
    }
    this.world = null;
    this.playerEid = -1;
    this.decided = false;
    this.stamina = SURVIVAL_MAX_STAMINA;
    this.predators.length = 0;
    this.promoted.length = 0;
  }

  /**
   * Ensure the world has at least one predator hunting the player. If the scene
   * already has predator-tagged fish we leave them; otherwise we tag the
   * `HUNTER_COUNT` non-player fish FARTHEST from the player. Promoting distant
   * fish (not just the first in query order, which may sit on top of the player
   * and catch it on frame 0) gives the player a fair head start. Deterministic:
   * the farthest-N selection is a stable sort of the snapshot order. The
   * promoted eids are recorded so `stop` demotes exactly them.
   */
  private ensureHunters(world: LivestockWorld, playerEid: number): void {
    const existing = PREDATOR_QUERY(world.ecs).filter((e) => e !== playerEid);
    if (existing.length > 0) return;

    const player = readEntityPosition(world, playerEid);
    if (player === null) return;

    // Rank candidate fish by distance from the player (descending), then tag
    // the farthest few. Stable across runs for a given scene + seed.
    const ranked: Array<{ eid: number; d: number }> = [];
    for (const eid of FISH_QUERY(world.ecs)) {
      if (eid === playerEid) continue;
      if (hasComponent(world.ecs, Predator, eid)) continue;
      const dx = (Position.x[eid] as number) - player.x;
      const dy = (Position.y[eid] as number) - player.y;
      const dz = (Position.z[eid] as number) - player.z;
      ranked.push({ eid, d: dx * dx + dy * dy + dz * dz });
    }
    ranked.sort((a, b) => b.d - a.d);
    for (let i = 0; i < HUNTER_COUNT && i < ranked.length; i++) {
      const entry = ranked[i];
      if (entry === undefined) continue;
      addComponent(world.ecs, Predator, entry.eid);
      this.promoted.push(entry.eid);
    }
  }

  /** Test-only read of the current stamina (integration tests assert on it). */
  staminaForTest(): number {
    return this.stamina;
  }

  /**
   * Run one frame of survival rules. Called by the app's per-frame loop while
   * the run is live. No-op when not bound, not live, or already decided.
   * Returns `true` once a terminal outcome was dispatched this frame.
   */
  frame(dtSec: number): boolean {
    const world = this.world;
    if (world === null || this.decided) return false;
    if (!this.game.isLive()) return false;

    const player = readEntityPosition(world, this.playerEid);
    if (player === null) return false;

    // Collect the live predator positions (excluding the player, in case it
    // ever carries the tag — it doesn't in survival, but be defensive).
    this.collectPredators(world);

    const threatened = isThreatened(player, this.predators, this.params);
    this.stamina = stepStamina(this.stamina, threatened, dtSec, this.params);
    const caught = isCaught(player, this.predators, this.params);

    // Push the player's REAL Stage 14 vitality + the game-local stamina to the HUD.
    const vitals = readPlayerVitals(world, this.playerEid);
    this.game.setVitality(vitals.health, vitals.food, this.stamina);

    // Score = whole seconds survived. Award the delta since last frame so the
    // HUD score climbs with the clock.
    const elapsed = this.game.score().elapsedSec;
    const targetScore = survivalScoreFor(elapsed);
    const delta = targetScore - this.game.score().points;
    if (delta > 0) this.game.award(delta);

    const outcome = evaluateSurvivalOutcome(
      caught,
      vitals.health,
      this.stamina,
      elapsed,
      this.params,
    );
    if (outcome === 'won') {
      this.decided = true;
      this.game.dispatch({ type: 'win' });
      return true;
    }
    if (outcome === 'lost') {
      this.decided = true;
      this.game.dispatch({ type: 'lose' });
      return true;
    }
    return false;
  }

  /** Build the predator candidate list from the live world (a read, no mutation). */
  private collectPredators(world: LivestockWorld): void {
    this.predators.length = 0;
    const eids = PREDATOR_QUERY(world.ecs);
    for (const eid of eids) {
      if (eid === this.playerEid) continue;
      this.predators.push({
        id: eid,
        x: Position.x[eid] as number,
        y: Position.y[eid] as number,
        z: Position.z[eid] as number,
      });
    }
  }
}
