// CleanerGameService (Stage 16 F16.5) — the app-layer cleaner RULES loop.
//
// Mirrors PredatorGameService exactly (F16.4). The player swims the tank
// wielding a `cleaning-tool` (scraper / brush / siphon) and scrubs the Stage 13
// F13.6 per-type algae off hardscape; the gravel siphon lifts settled waste
// (the Stage 13 chemistry tie-in). The objective is a CLEAN tank. Each frame
// this service reads the live world, finds the hardscape surfaces NEAR the
// player, and — while the player HOLDS the use button (the `primary` action) —
//
//   - rasps the active tool's TARGETED algae types off each surface in reach
//     (pure `surfacesInReach` + `toolAlgaeTargets` → `world.raspAlgaeType`),
//   - for the gravel siphon, nudges the live chemistry cleaner via the existing
//     `WaterChemistryService.applyWaterChange` dilution (no new dilution math),
//
// then computes tank CLEANLINESS (sum of `getAlgaeByType` across hardscape →
// `cleanlinessFraction`), pushes it to the HUD, awards the clean-% score, and
// evaluates win/lose (clean below the target → win; clock → lose).
//
// WHERE THE LOGIC LIVES (layer discipline):
//   - PURE rules (reach detection, tool→algae mapping, rasp amount, cleanliness
//     scoring, win/lose, countdown) live in `@aquascape/features/game` →
//     `cleaner-rules.ts`, exhaustively unit-tested framework-free.
//   - This SERVICE owns the WORLD MUTATION (rasp algae) + the chemistry tie-in
//     (waste dilution) + the per-frame wiring + the GameModeService dispatch +
//     the TOOL-SELECT state (which tool is active). App-scoped because it
//     touches a concrete `LivestockWorld` + the chemistry service.
//   - The SIPHON NOZZLE (renderer imperative calls) stays in AppComponent — the
//     service exposes `siphonActive()` + the active tool so the component can
//     drive `setSiphonPosition` / `setSiphonMode` from event/effect handlers
//     (NG0600 — never inside the render effect). No renderer dependency here.
//
// DETERMINISM BOUNDARY (load-bearing — see docs/caveats/game-modes.md). A clean
// STROKE is a NON-deterministic GAME EVENT: it's gated on the LIVE player
// position + tool + held button (all live input). So the rasp it triggers MUST
// stay OUT of the replay-critical deterministic sim core — and it does: this
// loop only runs while an ACTIVE cleaner game has a live player marked. The
// algae rasp (`world.raspAlgaeType`) mutates the Hardscape SoA slabs BETWEEN sim
// ticks, never inside `world.step()` / a system — the exact analogue of the
// predator catch's despawn. A non-game world (no player) never instantiates this
// loop, so the 1000-tick byte-identical replay holds.

import { Injectable, inject, signal } from '@angular/core';

import {
  GameModeService,
  DEFAULT_CLEANER_PARAMS,
  cleanlinessFraction,
  cleanlinessScore,
  evaluateCleanerOutcome,
  raspAmountPerType,
  surfacesInReach,
  toolAlgaeTargets,
  type CleanerRuleParams,
  type CleanerToolProfile,
  type SurfaceCandidate,
} from '@aquascape/features/game';
import type { LivestockWorld } from '@aquascape/domain/livestock-ecs';
import { coreCatalog } from '@aquascape/domain/catalog';
import type { Catalog, CleaningToolEntry } from '@aquascape/domain/catalog';

import { WaterChemistryService } from '../water-chemistry.service';
import { readEntityPosition, readPlayerVitals } from './game-activation';

/**
 * Per-surface algae seed in the showcase tank (each rock/wood starts at total
 * 1.0). The reference dirty load for the cleanliness fraction is this × a few
 * surfaces, so the HUD bar climbs smoothly. Captured once at `start` from the
 * actual registered surface count so the bar is honest for any scene.
 */
const SEED_PER_SURFACE = 1.0;

@Injectable({ providedIn: 'root' })
export class CleanerGameService {
  private readonly game = inject(GameModeService);
  private readonly waterChemistry = inject(WaterChemistryService);

  /** The live world for the active run, or null when not running. */
  private world: LivestockWorld | null = null;
  /** The player's eid for the active run. */
  private playerEid = -1;
  /** Tuning for the active run. */
  private params: CleanerRuleParams = DEFAULT_CLEANER_PARAMS;
  /** True once a terminal outcome has been dispatched (don't re-fire). */
  private decided = false;
  /** The reference dirty total used to map total algae → cleanliness fraction. */
  private referenceTotal = 1;
  /** Scratch surface buffer reused each frame to avoid per-frame GC. */
  private readonly surfaces: SurfaceCandidate[] = [];

  /** The catalog used to resolve the `cleaning-tool` rows (overridable in tests). */
  private catalog: Catalog = coreCatalog;

  /** The resolved tool profiles the player can cycle through (scraper / brush / siphon). */
  private tools: ReadonlyArray<{ readonly entry: CleaningToolEntry; readonly profile: CleanerToolProfile }> = [];

  /** Index into `tools` of the active tool. */
  private readonly toolIndex = signal(0);

  /** The active tool's catalog entry (UI label / swatch), or null before `start`. */
  readonly activeTool = signal<CleaningToolEntry | null>(null);

  /**
   * True when the active tool is the SIPHON — AppComponent reads this to mount
   * the shared `SiphonTool` nozzle (`RenderOptions.siphonTool`) + drive it.
   */
  readonly siphonActive = signal<boolean>(false);

  /** Inject an alternate catalog (tests, headless tools). */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
  }

  /**
   * Begin cleaner rules for `world` with `playerEid` marked as the player.
   * Resolves the `cleaning-tool` catalog rows into the cycle list, selects the
   * first tool, captures the reference dirty load, and resets the per-run state.
   * Idempotent — a re-`start` re-binds cleanly.
   */
  start(world: LivestockWorld, playerEid: number, params = DEFAULT_CLEANER_PARAMS): void {
    this.world = world;
    this.playerEid = playerEid;
    this.params = params;
    this.decided = false;
    this.surfaces.length = 0;

    // Resolve the cleaning-tool catalog rows into cycle order (scraper → brush →
    // siphon, the catalog `byKind` order). Each row distils into a pure profile.
    this.tools = this.catalog.byKind('cleaning-tool').map((entry) => ({
      entry,
      profile: {
        type: entry.type,
        targetAlgae: entry.targetAlgae,
        surfaces: entry.surfaces,
        effectiveness: entry.effectiveness,
        removesWaste: entry.removesWaste === true,
      },
    }));
    this.toolIndex.set(0);
    this.syncActiveTool();

    // Reference dirty load = the seed × the registered surface count (clamped to
    // ≥ 1 so an empty-hardscape scene doesn't divide by zero). The cleanliness
    // bar reads 0 at the start of a fully-dirty showcase tank and 1 when clean.
    const surfaceCount = world.getHardscapeCount();
    this.referenceTotal = Math.max(1, surfaceCount * SEED_PER_SURFACE);
  }

  /** Tear down the rules loop. The player tag is cleared by the host's `world.clearPlayer()`. */
  stop(): void {
    this.world = null;
    this.playerEid = -1;
    this.decided = false;
    this.surfaces.length = 0;
    this.tools = [];
    this.siphonActive.set(false);
    this.activeTool.set(null);
  }

  /**
   * Cycle to the next tool (scraper → brush → siphon → scraper …). The app calls
   * this on a dedicated key (the tool-select UX). No-op before `start` / with no
   * tools resolved. Updates `activeTool` + `siphonActive` so the HUD + the
   * AppComponent siphon wiring react.
   */
  cycleTool(): void {
    if (this.tools.length === 0) return;
    this.toolIndex.update((i) => (i + 1) % this.tools.length);
    this.syncActiveTool();
  }

  /** Test-only: the active tool index. */
  toolIndexForTest(): number {
    return this.toolIndex();
  }

  /** Push the active tool's entry + the siphon flag from the current index. */
  private syncActiveTool(): void {
    const active = this.tools[this.toolIndex()] ?? null;
    this.activeTool.set(active?.entry ?? null);
    this.siphonActive.set(active?.profile.type === 'siphon');
  }

  /** The active tool's pure profile, or null before `start`. */
  private activeProfile(): CleanerToolProfile | null {
    return this.tools[this.toolIndex()]?.profile ?? null;
  }

  /**
   * Run one frame of cleaner rules. Called by the app's per-frame loop while the
   * run is live. No-op when not bound, not live, or already decided. Returns the
   * total algae removed this frame (tests assert on it).
   */
  frame(dtSec: number): number {
    const world = this.world;
    if (world === null || this.decided) return 0;
    if (!this.game.isLive()) return 0;

    const profile = this.activeProfile();
    const using = this.game.intent().actions.primary;

    let removed = 0;
    if (profile !== null && using) {
      const player = readEntityPosition(world, this.playerEid);
      if (player !== null) {
        removed = this.runCleaning(world, profile, player, dtSec);
      }
    }

    // Compute the live tank cleanliness from the per-type algae stocks and push
    // it onto the HUD (the cleaner "Food" bar IS the cleanliness meter) + score.
    const total = this.totalAlgae(world);
    const cleanliness = cleanlinessFraction(total, this.referenceTotal);
    const vitals = readPlayerVitals(world, this.playerEid);
    this.game.setVitality(vitals.health, cleanliness, null);

    // Score = the clean-% (0–100). Award the delta so the HUD score tracks it.
    const targetScore = cleanlinessScore(cleanliness);
    const delta = targetScore - this.game.score().points;
    if (delta !== 0) this.game.award(delta);

    // Evaluate win/lose against the total algae + clock.
    const elapsed = this.game.score().elapsedSec;
    const outcome = evaluateCleanerOutcome(total, elapsed, this.params);
    if (outcome === 'won') {
      this.decided = true;
      this.game.dispatch({ type: 'win' });
    } else if (outcome === 'lost') {
      this.decided = true;
      this.game.dispatch({ type: 'lose' });
    }
    return removed;
  }

  /**
   * Do the actual cleaning for one frame: rasp the active tool's targeted algae
   * off every hardscape surface in reach, and — for the gravel siphon — nudge
   * the live chemistry cleaner. The algae rasp is the world mutation kept OUT of
   * the deterministic core (see the file header) — between sim ticks, gated on a
   * live game. Returns the total algae removed.
   */
  private runCleaning(
    world: LivestockWorld,
    profile: CleanerToolProfile,
    player: { x: number; y: number; z: number },
    dtSec: number,
  ): number {
    let removed = 0;

    // 1. Scrape algae off the hardscape surfaces within reach.
    const targets = toolAlgaeTargets(profile);
    if (targets.length > 0) {
      this.collectSurfaces(world);
      const hit = surfacesInReach(player, this.surfaces, this.params.reachMm);
      const amountPerType = raspAmountPerType(profile, dtSec);
      if (amountPerType > 0) {
        for (const id of hit) {
          for (const type of targets) {
            removed += world.raspAlgaeType(id, type, amountPerType);
          }
        }
      }
    }

    // 2. Siphon removes waste — dilute the live chemistry (the Stage 13 tie-in).
    //    Reuses WaterChemistryService.applyWaterChange (the single dilution
    //    truth) — a small continuous nudge, not a full water change. No-op when
    //    no chemistry tick is running (the fraction clamps internally).
    if (profile.removesWaste) {
      const frac = this.params.wasteDrainPerSec * dtSec;
      if (frac > 0) this.waterChemistry.applyWaterChange(Math.min(0.5, frac));
    }

    return removed;
  }

  /** Build the surface candidate list from the live world (a read, no mutation). */
  private collectSurfaces(world: LivestockWorld): void {
    this.surfaces.length = 0;
    for (const h of world.getHardscapeEntities()) {
      this.surfaces.push({ id: h.eid, x: h.x, y: h.y, z: h.z });
    }
  }

  /** Sum the per-type algae stocks across every hardscape surface (a read). */
  private totalAlgae(world: LivestockWorld): number {
    let total = 0;
    for (const h of world.getHardscapeEntities()) {
      const byType = world.getAlgaeByType(h.eid);
      if (byType === null) continue;
      total += byType['green-spot'] + byType.hair + byType['black-beard'] + byType.diatom;
    }
    return total;
  }
}
