// Public API for @aquascape/domain/stocking.
//
// Stocking-guidance rule engine. Plan Stage 7 F7.2.
//
// Given a `Scene` (from `@aquascape/domain/scene-model`) + a `Catalog` (from
// `@aquascape/domain/catalog`), `evaluateStocking` returns a deterministic
// `StockingWarning[]` covering bioload, temperature, pH, temperament,
// schooling, and fin-nipper compatibility.
//
// Pure TypeScript — no Angular, no DOM, no I/O — so it's safe to call from
// any layer (today: the inspector UI in `@aquascape/features/livestock-
// equipment`; later: a CLI/export pipeline).

export type { StockingWarning, WarningCode, WarningSeverity } from './types';

export { STOCKING_RULES, evaluateStocking } from './evaluate';

// ─── Individual rules (exposed for granular UI surfacing + testing) ───────
export { evaluateBioload } from './rules/bioload';
export { evaluateTemperature } from './rules/temperature';
export { evaluatePH } from './rules/ph';
export { evaluateTemperament } from './rules/temperament';
export { evaluateSchooling } from './rules/schooling';
export { evaluateFinNippers } from './rules/fin-nippers';

// ─── Tunable constants (re-exported for F7.4's "setup sheet") ─────────────
export {
  BIOLOAD_CLASS_MULTIPLIER,
  BIOLOAD_RATIO_NEAR_CAPACITY,
  BIOLOAD_RATIO_OVERSTOCKED,
  BIOLOAD_RATIO_SEVERELY_OVERSTOCKED,
  LONG_FINNED_CATALOG_IDS,
} from './rules/shared';
