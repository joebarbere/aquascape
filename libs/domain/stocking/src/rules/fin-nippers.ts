/**
 * Fin-nipper rule. Emits one `warning` when at least one entry flagged
 * `compatibilityFlags.finNipper === true` coexists with at least one entry
 * whose catalog id appears in `LONG_FINNED_CATALOG_IDS` (v1: just betta).
 *
 * `relatedEntryIds` lists every nipper + every long-finned target — the
 * warning is a single tank-wide event, not one per pair, so the UI can show
 * the implicated cohorts together.
 *
 * The long-finned set lives in `./shared.ts` so it's one-line to add fancy
 * guppies / goldfish / pearlscale-anglefish / etc. as the catalog grows.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import {
  LONG_FINNED_CATALOG_IDS,
  joinSpeciesNames,
  makeWarningId,
  resolveLivestock,
} from './shared';

export function evaluateFinNippers(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length < 2) {
    return [];
  }

  const nippers: { entryId: string; name: string }[] = [];
  const longFinned: { entryId: string; name: string }[] = [];
  for (const { entry, catalogEntry } of resolved) {
    if (catalogEntry.compatibilityFlags?.finNipper === true) {
      nippers.push({ entryId: entry.id, name: catalogEntry.name });
    }
    if (LONG_FINNED_CATALOG_IDS.has(catalogEntry.id)) {
      longFinned.push({ entryId: entry.id, name: catalogEntry.name });
    }
  }

  if (nippers.length === 0 || longFinned.length === 0) {
    return [];
  }

  // De-duplicate ids — a species in both buckets (hypothetical) shouldn't
  // appear twice in `relatedEntryIds`.
  const relatedEntryIds = Array.from(
    new Set<string>([...nippers, ...longFinned].map((x) => x.entryId)),
  ).sort();

  const nipperList = joinSpeciesNames(nippers.map((x) => x.name));
  const longFinnedList = joinSpeciesNames(longFinned.map((x) => x.name));

  return [
    {
      id: makeWarningId('fin-nipper-with-long-finned', relatedEntryIds),
      severity: 'warning',
      code: 'fin-nipper-with-long-finned',
      message: 'Fin-nipping species kept with long-finned tankmates.',
      explanation:
        `${nipperList} are known fin-nippers and will damage the trailing fins of ${longFinnedList}. ` +
        `Either remove the nippers, or replace the long-finned species with a short-finned variant.`,
      relatedEntryIds,
    },
  ];
}
