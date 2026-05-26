/**
 * Schooling rule. For every entry whose catalog `schoolingMin > 1` and whose
 * `quantity < schoolingMin`, emit one `warning` keyed on that entry alone.
 *
 *   - Solitary species (`schoolingMin === 1`) never trigger.
 *   - One warning per offending entry; if three different schoolers are
 *     under-stocked, the rule emits three warnings.
 *   - `relatedEntryIds` is a single-element array (the offending entry's id)
 *     so the warning id is unique per entry.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning } from '../types';
import { makeWarningId, resolveLivestock } from './shared';

export function evaluateSchooling(scene: Scene, catalog: Catalog): StockingWarning[] {
  const resolved = resolveLivestock(scene, catalog);
  if (resolved.length === 0) {
    return [];
  }

  const warnings: StockingWarning[] = [];
  for (const { entry, catalogEntry } of resolved) {
    if (catalogEntry.schoolingMin <= 1) {
      continue;
    }
    if (entry.quantity >= catalogEntry.schoolingMin) {
      continue;
    }
    const relatedEntryIds = [entry.id];
    warnings.push({
      id: makeWarningId('schooling-below-minimum', relatedEntryIds),
      severity: 'warning',
      code: 'schooling-below-minimum',
      message: `${catalogEntry.name} below recommended school size.`,
      explanation:
        `${catalogEntry.name} are schoolers; the catalog recommends at least ${catalogEntry.schoolingMin} ` +
        `to produce confident shoaling behaviour and reduce stress. The current design has only ` +
        `${entry.quantity}. Increase the group to ${catalogEntry.schoolingMin} or more, or remove this species.`,
      relatedEntryIds,
    });
  }
  return warnings;
}
