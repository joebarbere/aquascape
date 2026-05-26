/**
 * Bioload rule. Estimates tank load from weighted body cm vs. gross interior
 * litres and surfaces a tiered warning.
 *
 * Heuristic (deliberately coarse — calibrated to surface gross-overstock cases,
 * not replace water-chem testing):
 *
 *   class_multiplier  low = 0.5, medium = 1.0, high = 2.0
 *   weighted_body_cm  = Σ (adultSize_mm / 10) × quantity × class_multiplier
 *   tank_litres       = (width × depth × height) / 1_000_000
 *   load_ratio        = weighted_body_cm / tank_litres
 *
 * Tiers:
 *   < 1.0   no warning
 *   ≥ 1.0   info     bioload-near-capacity
 *   ≥ 1.5   warning  bioload-overstocked
 *   ≥ 2.5   error    bioload-severely-overstocked
 *
 * Edge cases:
 *   - Empty/undefined livestock → no warning.
 *   - Degenerate tank dimensions (volume ≤ 0) → no warning (the scene is
 *     too broken to evaluate; F7.1 elsewhere surfaces the dimension error).
 *   - Missing catalog refs → skipped in the sum (per `resolveLivestock`).
 *   - Tank-wide rule → `relatedEntryIds` lists every resolved entry id.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import {
  BIOLOAD_CLASS_MULTIPLIER,
  BIOLOAD_RATIO_NEAR_CAPACITY,
  BIOLOAD_RATIO_OVERSTOCKED,
  BIOLOAD_RATIO_SEVERELY_OVERSTOCKED,
  makeWarningId,
  resolveLivestock,
  tankGrossLitres,
} from './shared';

export function evaluateBioload(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length === 0) {
    return [];
  }
  const litres = tankGrossLitres(scene);
  if (litres <= 0) {
    return [];
  }

  let weightedBodyCm = 0;
  for (const { entry, catalogEntry } of resolved) {
    const bodyCm = catalogEntry.adultSize / 10;
    const mult = BIOLOAD_CLASS_MULTIPLIER[catalogEntry.bioloadClass];
    weightedBodyCm += bodyCm * entry.quantity * mult;
  }

  const ratio = weightedBodyCm / litres;
  if (ratio < BIOLOAD_RATIO_NEAR_CAPACITY) {
    return [];
  }

  let severity: StockingWarning['severity'];
  let code: StockingWarning['code'];
  let headline: string;
  if (ratio >= BIOLOAD_RATIO_SEVERELY_OVERSTOCKED) {
    severity = 'error';
    code = 'bioload-severely-overstocked';
    headline = 'Tank is severely overstocked';
  } else if (ratio >= BIOLOAD_RATIO_OVERSTOCKED) {
    severity = 'warning';
    code = 'bioload-overstocked';
    headline = 'Tank is overstocked';
  } else {
    severity = 'info';
    code = 'bioload-near-capacity';
    headline = 'Tank is near stocking capacity';
  }

  const ratioRounded = Math.round(ratio * 100) / 100;
  const litresRounded = Math.round(litres * 10) / 10;
  const bodyCmRounded = Math.round(weightedBodyCm * 10) / 10;
  const relatedEntryIds = resolved.map(({ entry }) => entry.id).sort();

  const message = `${headline} (load ratio ${ratioRounded.toFixed(2)}).`;
  const explanation =
    `Weighted body length sums to ${bodyCmRounded.toFixed(1)} cm against ${litresRounded.toFixed(1)} L of ` +
    `gross tank volume, giving a load ratio of ${ratioRounded.toFixed(2)}. Weights apply per bioload class ` +
    `(low ×0.5, medium ×1.0, high ×2.0). Warnings start at ratio ${BIOLOAD_RATIO_NEAR_CAPACITY.toFixed(1)}, ` +
    `escalate at ${BIOLOAD_RATIO_OVERSTOCKED.toFixed(1)}, and become critical at ` +
    `${BIOLOAD_RATIO_SEVERELY_OVERSTOCKED.toFixed(1)}. This is a planning heuristic — it does not replace ` +
    `routine water testing.`;

  return [
    {
      id: makeWarningId(code, relatedEntryIds),
      severity,
      code,
      message,
      explanation,
      relatedEntryIds,
    },
  ];
}
