/**
 * Temperature compatibility rule. Computes the intersection of every
 * livestock entry's `temperatureRange`; emits one `error` warning when the
 * intersection is empty.
 *
 *   intersection.minC = max(every entry's minC)
 *   intersection.maxC = min(every entry's maxC)
 *   empty if minC > maxC
 *
 * Edge cases:
 *   - 0 or 1 resolved entry → no warning (a single range trivially overlaps
 *     itself; with no entries there's nothing to compare).
 *   - Missing catalog refs → skipped (per `resolveLivestock`).
 *   - Tied bounds (minC == maxC) are NOT flagged — the species can theoretically
 *     coexist at that exact temperature. Operationally tight, but advisory.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import { joinSpeciesNames, makeWarningId, resolveLivestock } from './shared';

export function evaluateTemperature(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length < 2) {
    return [];
  }

  let intersectionMin = -Infinity;
  let intersectionMax = Infinity;
  for (const { catalogEntry } of resolved) {
    if (catalogEntry.temperatureRange.minC > intersectionMin) {
      intersectionMin = catalogEntry.temperatureRange.minC;
    }
    if (catalogEntry.temperatureRange.maxC < intersectionMax) {
      intersectionMax = catalogEntry.temperatureRange.maxC;
    }
  }

  if (intersectionMin <= intersectionMax) {
    return [];
  }

  const relatedEntryIds = resolved.map(({ entry }) => entry.id).sort();
  const speciesList = joinSpeciesNames(
    resolved.map(
      ({ catalogEntry }) =>
        `${catalogEntry.name} (${catalogEntry.temperatureRange.minC}–${catalogEntry.temperatureRange.maxC} °C)`,
    ),
  );

  return [
    {
      id: makeWarningId('temperature-incompatible', relatedEntryIds),
      severity: 'error',
      code: 'temperature-incompatible',
      message: 'Species have no overlapping temperature range.',
      explanation:
        `No single temperature satisfies every species' tolerance window. ` +
        `${speciesList}. Drop or replace a species whose range falls outside the others, ` +
        `or split the design across two tanks.`,
      relatedEntryIds,
    },
  ];
}
