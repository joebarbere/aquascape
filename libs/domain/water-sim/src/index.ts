// Public API for @aquascape/domain/water-sim.
//
// Deterministic aquarium water-chemistry simulation engine (Plan Stage 13 F13.1,
// ADR-0006). The sibling of `domain/growth-sim`: pure, seeded, framework-free.
//
// Pieces:
//   - `simulateChemistry(params, state, elapsedWeeks, sourceN, seed)` — advances
//     the nitrogen cycle (two-stage nitrification with a growing colony
//     capacity), pH drift, and nitrate accumulation. Time is an INPUT.
//   - `cycleProgress(state)` — classifies the tank as uncycled | cycling | cycled.
//   - `algaeGrowth(type, nitrate, lightHours, flow, dt)` — per-type algae growth
//     increment driven by nutrient + light + flow.
//   - `freeAmmonia` / `freeAmmoniaFraction` — the pH/temperature NH3↔NH4+
//     equilibrium that makes ammonia toxicity honest.
//   - `freshWaterState` / `ENGINE_VERSION` — a brand-new-tank state + the
//     rate-model version for replay/migration provenance.
//
// All pure TS, no DOM/Angular/Electron, no `Date.now()`, no `Math.random()`.
// `domain/water-sim` depends only on other `domain/*` libs.

export {
  ENGINE_VERSION,
  type WaterChemistryParams,
  type WaterState,
  freshWaterState,
  simulateChemistry,
} from './chemistry';

export { type CycleStage, cycleProgress, SAFE_NITROGEN_MG_L } from './cycle';

export { type AlgaeType, ALGAE_TYPES, algaeGrowth } from './algae';

export { freeAmmonia, freeAmmoniaFraction } from './ammonia';

// F13.3 — bioload → source term + preview-time / tank-param adapters. The two
// driver paths (editor preview-time + the live WaterChemistryService) share
// these so they agree on bioload and tank params by construction.
export { FISH_BASELINE_WASTE_N_MG_PER_DAY, bioloadSourceN } from './bioload';

export {
  DEFAULT_KH_DKH,
  DEFAULT_TEMPERATURE_C,
  waterParamsFromTank,
  initialWaterState,
  evaluateChemistryAtWeek,
  evaluateSceneChemistryAtWeek,
} from './preview';
