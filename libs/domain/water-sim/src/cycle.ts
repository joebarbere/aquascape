/**
 * Tank cycling stage classification, derived from the chemistry state.
 *
 * A tank is:
 *   - `uncycled`  — no established filter yet (negligible nitrifier colonies).
 *   - `cycling`   — bacteria establishing; ammonia and/or nitrite still elevated
 *                   above safe levels (the dangerous middle of the cycle).
 *   - `cycled`    — both colonies mature: ammonia AND nitrite are processed to
 *                   ~0 and the tank can safely carry its bioload. Nitrate may be
 *                   high (that's the water-change signal, not a cycling fault).
 *
 * Thresholds are at the hobby "safe" floor. Hobby test kits read ammonia and
 * nitrite as toxic above ~0.25 mg/L; a cycled tank holds both at ~0. (API
 * Freshwater Master Test Kit colour-chart conventions — labelled approximation
 * of the readable bands, not a calibrated instrument spec.)
 */

import type { WaterState } from './chemistry';

export type CycleStage = 'uncycled' | 'cycling' | 'cycled';

/** Ammonia/nitrite (mg/L-N) at or below this read as "safe / processed". */
export const SAFE_NITROGEN_MG_L = 0.25;
/** Combined colony capacity below this reads as a brand-new, uncycled tank. */
const UNCYCLED_COLONY_FLOOR = 0.05;

export function cycleProgress(state: WaterState): CycleStage {
  const ammonia = safeNum(state.ammonia);
  const nitrite = safeNum(state.nitrite);
  const colonies = safeNum(state.aobColony) + safeNum(state.nobColony);

  // Cycled: both nitrogen species processed down to safe AND both colonies
  // have actually established (so a never-dosed empty tank doesn't read cycled).
  if (
    ammonia <= SAFE_NITROGEN_MG_L &&
    nitrite <= SAFE_NITROGEN_MG_L &&
    safeNum(state.aobColony) > UNCYCLED_COLONY_FLOOR &&
    safeNum(state.nobColony) > UNCYCLED_COLONY_FLOOR
  ) {
    return 'cycled';
  }

  // Uncycled: no meaningful bacteria yet AND nothing elevated to process.
  if (colonies <= UNCYCLED_COLONY_FLOOR && ammonia <= SAFE_NITROGEN_MG_L && nitrite <= SAFE_NITROGEN_MG_L) {
    return 'uncycled';
  }

  // Everything in between is mid-cycle (bacteria establishing / spike in flight).
  return 'cycling';
}

function safeNum(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
