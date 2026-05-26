/**
 * pH compatibility rule. Mirrors `evaluateTemperature` — intersects each
 * species' `pHRange` and emits one `error` warning when the intersection is
 * empty.
 *
 * Edge cases match temperature:
 *   - 0 or 1 resolved entry → no warning.
 *   - Missing catalog refs → skipped (per `resolveLivestock`).
 *   - Tied bounds (min == max) are NOT flagged.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import { joinSpeciesNames, makeWarningId, resolveLivestock } from './shared';

export function evaluatePH(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length < 2) {
    return [];
  }

  let intersectionMin = -Infinity;
  let intersectionMax = Infinity;
  for (const { catalogEntry } of resolved) {
    if (catalogEntry.pHRange.min > intersectionMin) {
      intersectionMin = catalogEntry.pHRange.min;
    }
    if (catalogEntry.pHRange.max < intersectionMax) {
      intersectionMax = catalogEntry.pHRange.max;
    }
  }

  if (intersectionMin <= intersectionMax) {
    return [];
  }

  const relatedEntryIds = resolved.map(({ entry }) => entry.id).sort();
  const speciesList = joinSpeciesNames(
    resolved.map(
      ({ catalogEntry }) =>
        `${catalogEntry.name} (pH ${catalogEntry.pHRange.min}–${catalogEntry.pHRange.max})`,
    ),
  );

  return [
    {
      id: makeWarningId('ph-incompatible', relatedEntryIds),
      severity: 'error',
      code: 'ph-incompatible',
      message: 'Species have no overlapping pH range.',
      explanation:
        `No single pH satisfies every species' tolerance window. ` +
        `${speciesList}. Drop or replace a species whose range falls outside the others.`,
      relatedEntryIds,
    },
  ];
}
