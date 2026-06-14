/**
 * AlgaeGrowthSystem (Stage 13 F13.6 — per-type algae simulation).
 *
 * Grows per-hardscape algae through the SINGLE source-of-truth growth model in
 * `@aquascape/domain/water-sim` — `algaeGrowth(type, nitrate, lightHours, flow,
 * dt)`. The four algae types (green-spot / hair / black-beard / diatom) each
 * track an independent `[0, 1]` stock on the `Hardscape` slab; this system
 * accumulates each type's per-tick growth increment and re-derives the
 * aggregate `Hardscape.algaeScore` (= clamped sum) so the F11.4 renderer
 * overlay + grazer-targeting gate keep reading one scalar.
 *
 * ── Inputs (all DEFAULT-SAFE for determinism) ────────────────────────────────
 *   - nitrate (mg/L)   : `world.waterQuality.nitrate`. Defaults to 0. With
 *                        nitrate 0 the model's Monod nutrient driver is 0, so
 *                        NO algae grows — a world with no `WaterChemistryService`
 *                        wired sees zero growth and replays run-to-run identical.
 *   - lightHours       : `world.photoperiodHours`. Defaults to
 *                        `DEFAULT_PHOTOPERIOD_HOURS` (8 h). The host sets it from
 *                        `EquipmentEntry.photoperiodHours` / the day-night state.
 *   - flow (0..1)      : sampled flow-field magnitude at the hardscape position,
 *                        normalised by `FLOW_NORMALISE_MM_PER_S`. 0 when no field
 *                        is registered (still tank).
 *
 * ── Per-type config ──────────────────────────────────────────────────────────
 * Registered `algae` catalog rows supply a `growthRate` weight (`(0,1]`) and a
 * `lightDependence` `[0,1]` per type via `world.registerAlgaeProfiles(...)`.
 * When no row is registered for a type, the built-in model profile drives it
 * alone (weight 1, full light dependence) — the model is still the source of
 * truth; the catalog only scales it.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 * Pure scalar math — no PRNG, no Date.now, no Math.random. `algaeGrowth` is a
 * deterministic function of (type, nitrate, lightHours, flow, dt). The
 * flow-field sample is a pure trilinear interpolation. Hardscape entities are
 * walked in eid order and each type folded in fixed `ALGAE_TYPE_FIELDS` order,
 * so two worlds with identical inputs grow byte-identically over 1000 ticks.
 *
 * ── Slot order ───────────────────────────────────────────────────────────────
 * Runs at the very TOP of the fish-behaviour block, BEFORE `feedingSystem`, so
 * the algae a grazer rasps this tick is already grown + the aggregate is fresh
 * for the snapshot. (`feedingSystem` no longer regrows algae — that flat-rate
 * F11.4 regrowth is replaced by this model-driven per-type growth.)
 */
import { defineQuery } from 'bitecs';
import { algaeGrowth, type AlgaeType } from '@aquascape/domain/water-sim';
import { sampleFlowField } from '@aquascape/domain/fluid-sim';
import { Hardscape, Position } from './components';
import type { LivestockWorld } from './world';

/**
 * The four algae types in their canonical order. The `field` names MUST line
 * up with the `Hardscape` per-type slabs (component.ts) — the snapshot getter
 * + grazing rule index by the same order.
 */
export const ALGAE_TYPE_FIELDS: ReadonlyArray<{ type: AlgaeType; field: AlgaeFieldKey }> = [
  { type: 'green-spot', field: 'algaeGreenSpot' },
  { type: 'hair', field: 'algaeHair' },
  { type: 'black-beard', field: 'algaeBlackBeard' },
  { type: 'diatom', field: 'algaeDiatom' },
];

/** Keys of the per-type `Hardscape` stock slabs. */
export type AlgaeFieldKey =
  | 'algaeGreenSpot'
  | 'algaeHair'
  | 'algaeBlackBeard'
  | 'algaeDiatom';

/**
 * Default daily photoperiod (hours) when the host hasn't wired a real one from
 * `EquipmentEntry.photoperiodHours` / the day-night state. 8 h is a modest
 * planted-tank default — long enough that under nitrate the bright-light types
 * grow, short enough that it isn't the photoperiod optimum for every type.
 */
export const DEFAULT_PHOTOPERIOD_HOURS = 8;

/**
 * Flow magnitude (mm/s) that maps to the model's normalised `flow = 1.0`
 * (strong current). The flow field's peak source velocity is ~50 mm/s
 * (`NOMINAL_PEAK_VELOCITY_MM_PER_S` in fluid-sim), so 50 mm/s ⇒ full-flow
 * affinity at a filter outflow; a still corner ⇒ ~0.
 */
export const FLOW_NORMALISE_MM_PER_S = 50;

/**
 * Per-type tuning scale registered from the catalog `algae` rows. `growthRate`
 * scales the whole increment; `lightDependence` blends the model's light driver
 * toward 1 (shade-tolerant types feel light less). Absent ⇒ the model profile
 * drives the type alone (weight 1, full light dependence).
 */
export interface AlgaeProfileScale {
  /** Catalog `growthRate` ∈ (0, 1] — relative growth weight. Default 1. */
  growthRate: number;
  /** Catalog `lightDependence` ∈ [0, 1] — how strongly growth tracks light. Default 1. */
  lightDependence: number;
}

/** Default scale used for a type with no registered catalog row. */
export const DEFAULT_ALGAE_SCALE: AlgaeProfileScale = { growthRate: 1, lightDependence: 1 };

const hardscapeQuery = defineQuery([Hardscape, Position]);

/** Clamp a scalar into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Run the AlgaeGrowthSystem once per sim tick. `dt` is in SECONDS (the sim
 * fixed dt); the water-sim model takes DAYS, so we convert. Always runs — the
 * per-tick cost is one `algaeGrowth` call per (hardscape × type), trivial for
 * the handful of hardscape entries in a scene. Early-outs to a cheap aggregate
 * re-derive when nitrate is 0 (no growth possible) so the common no-chemistry
 * world pays almost nothing.
 */
export function algaeGrowthSystem(world: LivestockWorld, dt: number): void {
  const ecs = world.ecs;
  const nitrate = world.waterQuality.nitrate;
  const lightHours = world.photoperiodHours;
  const dtDays = dt / 86400;
  const field = world.getFlowField();
  const scales = world.algaeProfiles;
  // probe reused across the loop — sampleFlowField returns a fresh Vec3 but
  // takes a structural input we can pre-allocate (no per-hardscape alloc).
  const probe = { x: 0, y: 0, z: 0 };

  for (const eid of hardscapeQuery(ecs)) {
    // Flow magnitude at this rock, normalised to [0, 1]. 0 when no field.
    let flow = 0;
    if (field !== null) {
      probe.x = Position.x[eid] as number;
      probe.y = Position.y[eid] as number;
      probe.z = Position.z[eid] as number;
      const s = sampleFlowField(field, probe);
      const mag = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      flow = clamp(mag / FLOW_NORMALISE_MM_PER_S, 0, 1);
    }

    let aggregate = 0;
    for (let t = 0; t < ALGAE_TYPE_FIELDS.length; t++) {
      const { type, field: key } = ALGAE_TYPE_FIELDS[t]!;
      let stock = Hardscape[key][eid] as number;
      // nitrate 0 ⇒ growth 0 (Monod). Skip the model call for that hot path.
      if (nitrate > 0) {
        const scale = scales[type] ?? DEFAULT_ALGAE_SCALE;
        // The water-sim model is the single source of truth for the growth
        // curve. The catalog row tunes it on top:
        //   - `growthRate` scales the whole increment (a type's relative
        //     weight in the set).
        //   - `lightDependence` blends the photoperiod-driven increment (the
        //     model run at the SCENE's lightHours) against the type's
        //     light-NEUTRAL increment (the model run at the type's OWN optimum
        //     photoperiod, where its light factor peaks). A fully
        //     light-dependent type (1) feels the scene photoperiod fully; a
        //     shade-tolerant type (0) ignores it and grows at its peak-light
        //     rate regardless of the scene's day length.
        const litInc = algaeGrowth(type, nitrate, lightHours, flow, dtDays);
        const dep = clamp(scale.lightDependence, 0, 1);
        let blended: number;
        if (dep >= 1) {
          blended = litInc;
        } else {
          const neutralInc = algaeGrowth(
            type,
            nitrate,
            LIGHT_PROFILES[type].optimum,
            flow,
            dtDays,
          );
          blended = litInc * dep + neutralInc * (1 - dep);
        }
        stock = clamp(stock + blended * scale.growthRate, 0, 1);
        Hardscape[key][eid] = stock;
      }
      aggregate += stock;
    }
    Hardscape.algaeScore[eid] = clamp(aggregate, 0, 1);
  }
}

/**
 * Light-optimum mirror of the water-sim model profiles, used ONLY to look up
 * the per-type optimum photoperiod for the shade-tolerance blend (run the model
 * at the type's own optimum to get its light-NEUTRAL increment). The growth
 * curve itself stays owned by the model; these optima track `algae.ts`'s
 * `lightOptimumHours` and a spec asserts they agree. `tolerance` is unused by
 * the blend but kept alongside the optimum for documentation parity.
 */
const LIGHT_PROFILES: Record<AlgaeType, { optimum: number; tolerance: number }> = {
  'green-spot': { optimum: 10, tolerance: 4 },
  hair: { optimum: 11, tolerance: 4 },
  'black-beard': { optimum: 8, tolerance: 6 },
  diatom: { optimum: 6, tolerance: 5 },
};
