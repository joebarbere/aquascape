/**
 * Temperament compatibility rule. Emits one `warning` when at least one
 * `peaceful` species coexists with at least one `aggressive` species.
 *
 * Notes:
 *   - `semi-aggressive` does NOT trigger by itself — it's the buffer zone
 *     between the two tiers. (A `semi-aggressive` species with peacefuls is
 *     advisory; with aggressives it's expected coexistence.)
 *   - `relatedEntryIds` lists only the peaceful + aggressive entries that
 *     actually clash; semi-aggressive entries are NOT included even when
 *     they happen to be present in the scene.
 *   - 0 or 1 resolved entry → no warning.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import { joinSpeciesNames, makeWarningId, resolveLivestock } from './shared';

export function evaluateTemperament(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length < 2) {
    return [];
  }

  const peaceful: { entryId: string; name: string }[] = [];
  const aggressive: { entryId: string; name: string }[] = [];
  for (const { entry, catalogEntry } of resolved) {
    if (catalogEntry.temperament === 'peaceful') {
      peaceful.push({ entryId: entry.id, name: catalogEntry.name });
    } else if (catalogEntry.temperament === 'aggressive') {
      aggressive.push({ entryId: entry.id, name: catalogEntry.name });
    }
  }

  if (peaceful.length === 0 || aggressive.length === 0) {
    return [];
  }

  const relatedEntryIds = [...peaceful, ...aggressive].map((x) => x.entryId).sort();
  const peacefulList = joinSpeciesNames(peaceful.map((x) => x.name));
  const aggressiveList = joinSpeciesNames(aggressive.map((x) => x.name));

  return [
    {
      id: makeWarningId('temperament-clash', relatedEntryIds),
      severity: 'warning',
      code: 'temperament-clash',
      message: 'Peaceful and aggressive species in the same tank.',
      explanation:
        `Peaceful species (${peacefulList}) are likely to be harassed or out-competed by ` +
        `aggressive species (${aggressiveList}). Consider separating them, or substitute one group ` +
        `with semi-aggressive alternatives that share the same niche.`,
      relatedEntryIds,
    },
  ];
}
