// Live water-chemistry tick. Plan Stage 13 F13.3 (simulation-mode path).
//
// The runtime, real-time sibling of the editor's `PreviewChemistryService`.
// Where the editor PROJECTS the chemistry a tank would reach after N weeks
// (driven by the preview-time slider), THIS service TICKS the chemistry forward
// over accumulated simulated time while the showcase/simulation mode runs, and
// closes the loop:
//
//   world.getWasteSourceN()  (live ammonia source: per-fish baseline + uneaten
//                             food decay — Stage 14 F14.4 producer)
//        │
//        ▼
//   simulateChemistry(...)   (advance the nitrogen cycle by a deterministic
//                             accumulated dt — NOT wall-clock — see below)
//        │
//        ▼
//   world.setWaterQuality({ammonia, nitrite})  (feeds VitalitySystem → fish
//                                                health responds: feed → waste
//                                                → ammonia → health, end-to-end)
//
// ─── Determinism / time-acceleration ────────────────────────────────────────
// The tick fires on a fixed wall-clock interval (`TICK_INTERVAL_MS`), but the
// chemistry NEVER advances by the measured wall-clock delta. Each tick advances
// the model by a FIXED `WEEKS_PER_TICK` — so after N ticks the chemistry is a
// pure function of (initial state, the source-term trace, N), replay-stable
// given the tick count. (A dropped/late frame doesn't smear the model; it just
// means one fewer tick happened.) This mirrors the livestock fixed-dt scheduler.
//
// TIME ACCELERATION: a real aquarium cycles over WEEKS. To make cycling VISIBLE
// in a showcase (minutes, not weeks) we compress sim-time: `WEEKS_PER_TICK` is
// sized so ~6 simulated weeks — the hobby fishless-cycle window — elapse in
// ~2 real minutes of ticking. The acceleration lives ONLY here (the model is
// honest per-week); it's the runtime presentation choice, documented in
// `docs/caveats/water-sim.md` + the simulation-mode guide.
//
// ─── Persistence ────────────────────────────────────────────────────────────
// Initial state loads from `Tank.waterChemistry` (the persisted snapshot) when
// present, else `freshWaterState()`. The live tick state is RUNTIME-ONLY — it
// is NOT written back to the document per-tick (that would spam the undo stack
// and churn autosave). The current `WaterState` is exposed as a signal for HUDs;
// persisting it (a non-undoable save-time snapshot) is left to save-time code.
//
// ─── Replay safety for the livestock world ──────────────────────────────────
// `world.setWaterQuality` defaults clean (0/0). A world with NO WaterChemistry
// service running stays byte-identical (the 1000-tick replay holds). Only an
// ACTIVE service injects non-zero water quality — and it injects between sim
// ticks, reading `getWasteSourceN()` (a host-driven scalar), so it never
// perturbs the ECS PRNG streams. Stop the service ⇒ the next tick clean-resets.

import { Injectable, NgZone, type OnDestroy, inject, signal } from '@angular/core';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { Catalog } from '@aquascape/domain/catalog';
import { applyWaterChange, type ReplacementWater, type Scene } from '@aquascape/domain/scene-model';
import {
  bioloadSourceN,
  cycleProgress,
  initialWaterState,
  simulateChemistry,
  waterParamsFromTank,
  type CycleStage,
  type WaterChemistryParams,
  type WaterState,
} from '@aquascape/domain/water-sim';

import { LivestockSimulationService } from './livestock-simulation.service';

/** Wall-clock interval between chemistry ticks (ms). 4 Hz — smooth but cheap. */
export const TICK_INTERVAL_MS = 250;

/**
 * Simulated weeks advanced PER TICK — the time-acceleration knob. At 4 Hz this
 * is 4 ticks/sec; `0.0125 weeks/tick × 4 /sec = 0.05 weeks/real-second`, so the
 * ~6-week hobby cycle window elapses in ~120 real seconds. Labelled
 * presentation constant — the model itself stays honest per simulated week.
 */
export const WEEKS_PER_TICK = 0.0125;

/** Live chemistry the HUD reads. */
export interface LiveChemistry {
  readonly state: WaterState;
  readonly cycle: CycleStage;
  /** Number of chemistry ticks applied so far (the deterministic clock). */
  readonly ticks: number;
}

@Injectable({ providedIn: 'root' })
export class WaterChemistryService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly livestockSim = inject(LivestockSimulationService);

  /** Catalog for the bioload fallback when the world has no fish yet. */
  private catalog: Catalog = coreCatalog;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Running chemistry state + params for the active run. */
  private state: WaterState = initialWaterState(undefined);
  private params: WaterChemistryParams = waterParamsFromTank({
    width: 600,
    height: 400,
    depth: 400,
  } as Scene['tank']);
  private seed = 0;
  private tickCount = 0;
  /**
   * Fallback source term derived from the scene's stocking, used until the
   * livestock world materialises (the renderer builds the world lazily on its
   * first 3D paint). Once the world exists we read `getWasteSourceN()` instead
   * — the same per-fish baseline plus uneaten-food decay.
   */
  private fallbackSourceN = 0;

  /** Live chemistry signal for the HUD. */
  private readonly liveSig = signal<LiveChemistry>({
    state: this.state,
    cycle: 'uncycled',
    ticks: 0,
  });
  readonly live = this.liveSig.asReadonly();

  /** Inject an alternate catalog (tests). */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
  }

  /**
   * Begin ticking chemistry for a scene. Loads the initial state from the
   * scene's persisted `Tank.waterChemistry` (or a fresh tank), derives the tank
   * params + the stocking fallback source term, then starts the fixed-interval
   * tick. Idempotent restart: a second `start` re-seeds from the new scene.
   */
  start(scene: Scene): void {
    this.stop();
    this.state = initialWaterState(scene.tank.waterChemistry);
    this.params = waterParamsFromTank(scene.tank);
    this.seed = scene.seed | 0;
    this.fallbackSourceN = bioloadSourceN(scene, this.catalog);
    this.tickCount = 0;
    this.publish();

    // Tick outside Angular so the timer doesn't churn change detection; the
    // signal write re-enters the zone. Same pattern as the simulation HUDs.
    this.zone.runOutsideAngular(() => {
      this.intervalHandle = setInterval(() => this.tickOnce(), TICK_INTERVAL_MS);
    });
  }

  /** Stop ticking. Idempotent. Leaves the last `live()` value in place. */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /**
   * Advance the chemistry one tick. PUBLIC so a deterministic test (or a future
   * console command) can drive ticks without a real timer — the determinism
   * contract is "same initial state + same per-tick source trace + N ticks ⇒
   * identical WaterState", which a test pins by calling this N times with a
   * fixed-source world.
   *
   * Source term: the live `world.getWasteSourceN()` when a world exists; the
   * scene's stocking-derived `bioloadSourceN` otherwise (pre-world warm-up).
   */
  tickOnce(): void {
    const world = this.livestockSim.getWorld();
    const sourceN = world !== null ? world.getWasteSourceN() : this.fallbackSourceN;

    this.state = simulateChemistry(this.params, this.state, WEEKS_PER_TICK, sourceN, this.seed);
    this.tickCount += 1;

    // Close the loop: push ammonia + nitrite (VitalitySystem) + nitrate
    // (F13.6 AlgaeGrowthSystem) to the world so they read the latest chemistry
    // next sim tick. No-op when there's no world yet.
    world?.setWaterQuality({
      ammonia: this.state.ammonia,
      nitrite: this.state.nitrite,
      nitrate: this.state.nitrate,
    });

    this.zone.run(() => this.publish());
  }

  /**
   * Apply a water change to the LIVE runtime state — the simulation-mode path
   * of F13.5b. Dilutes the running `WaterState` by `fractionReplaced` (in
   * `(0, 1]`) of clean (or `replacement`) water, REUSING the single source of
   * dilution truth `applyWaterChange` from `domain/scene-model` so the live
   * tick and the persisted `WaterChange` Command agree by construction — no
   * re-implemented dilution math here.
   *
   * The colony + cycling clock are preserved (a water change doesn't reset the
   * cycle — nitrifiers live on surfaces), so the cycle keeps its progress and
   * only the dissolved nitrogen drops. The diluted ammonia + nitrite are pushed
   * straight to the livestock world so fish health responds immediately, then
   * the live signal republishes for the HUD readout.
   *
   * No-op when the fraction is out of range. Returns the new `WaterState`.
   */
  applyWaterChange(fractionReplaced: number, replacement?: ReplacementWater): WaterState {
    if (!Number.isFinite(fractionReplaced) || fractionReplaced <= 0 || fractionReplaced > 1) {
      return this.state;
    }
    // Lift the live WaterState into a WaterChemistry snapshot (the chemistry
    // block IS a WaterState field-for-field), dilute via the shared helper,
    // then lift the result back. cycle is recomputed inside the helper.
    const diluted = applyWaterChange(
      { chemistry: this.state, cycle: cycleProgress(this.state) },
      fractionReplaced,
      replacement,
    );
    this.state = diluted.chemistry;

    // Push the diluted ammonia + nitrite + nitrate to the world so
    // VitalitySystem + AlgaeGrowthSystem read the cleaner water next sim tick —
    // a water change cuts nitrate, so algae growth eases off immediately too.
    this.livestockSim.getWorld()?.setWaterQuality({
      ammonia: this.state.ammonia,
      nitrite: this.state.nitrite,
      nitrate: this.state.nitrate,
    });

    this.zone.run(() => this.publish());
    return this.state;
  }

  private publish(): void {
    this.liveSig.set({
      state: this.state,
      cycle: cycleProgress(this.state),
      ticks: this.tickCount,
    });
  }
}
