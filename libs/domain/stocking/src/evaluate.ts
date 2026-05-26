/**
 * Stocking-guidance aggregator. Runs every rule and returns the concatenated
 * warnings in a stable, deterministic order.
 *
 * Ordering (load-bearing for the UI's `track` keys — re-running the evaluator
 * on the same scene must produce the same array shape, position by position):
 *   1. severity rank descending: error → warning → info
 *   2. code ascending (alphabetical)
 *   3. comma-joined sorted relatedEntryIds ascending (already sorted upstream
 *      by `makeWarningId`'s contract)
 *
 * Rules NEVER short-circuit each other — a temperature clash does not skip
 * the temperament check; the UI is responsible for prioritising what's
 * shown first. Each rule is independently testable and the aggregator is a
 * plain `flatMap` over the rule functions.
 */

import type { Scene } from '@aquascape/domain/scene-model';
import type { Catalog } from '@aquascape/domain/catalog';
import type { StockingWarning, WarningSeverity } from './types';
import { evaluateBioload } from './rules/bioload';
import { evaluateTemperature } from './rules/temperature';
import { evaluatePH } from './rules/ph';
import { evaluateTemperament } from './rules/temperament';
import { evaluateSchooling } from './rules/schooling';
import { evaluateFinNippers } from './rules/fin-nippers';

/** Numeric rank used for sort comparison. Higher = higher priority. */
const SEVERITY_RANK: Record<WarningSeverity, number> = {
  error: 2,
  warning: 1,
  info: 0,
};

type RuleFn = (scene: Scene, catalog: Catalog) => StockingWarning[];

/**
 * Ordered list of rules the aggregator runs. Export-visible so test specs
 * can iterate the same surface and so future rules drop in by appending
 * here (no other change required).
 */
export const STOCKING_RULES: readonly RuleFn[] = [
  evaluateBioload,
  evaluateTemperature,
  evaluatePH,
  evaluateTemperament,
  evaluateSchooling,
  evaluateFinNippers,
];

export function evaluateStocking(scene: Scene, catalog: Catalog): StockingWarning[] {
  const warnings: StockingWarning[] = [];
  for (const rule of STOCKING_RULES) {
    const result = rule(scene, catalog);
    for (const w of result) {
      warnings.push(w);
    }
  }
  warnings.sort(compareWarnings);
  return warnings;
}

function compareWarnings(a: StockingWarning, b: StockingWarning): number {
  const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sevDiff !== 0) {
    return sevDiff;
  }
  if (a.code !== b.code) {
    return a.code < b.code ? -1 : 1;
  }
  // Both warnings carry pre-sorted relatedEntryIds (see `makeWarningId`'s
  // contract). Compare by joined string for total-order determinism.
  const aKey = a.relatedEntryIds.join(',');
  const bKey = b.relatedEntryIds.join(',');
  if (aKey === bKey) {
    return 0;
  }
  return aKey < bKey ? -1 : 1;
}
