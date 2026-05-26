/**
 * `@aquascape/domain/stocking` type surface.
 *
 * Stocking-guidance warnings emitted by the rule engine. Plan Stage 7 F7.2.
 *
 * Every warning carries:
 *   - a stable `id` so UI lists can use it as a `track` key without reshuffling
 *     on every recompute,
 *   - a `severity` so the UI can prioritise (`error` > `warning` > `info`),
 *   - a `code` so styling + future i18n keys can branch deterministically,
 *   - a one-line `message` and a multi-sentence `explanation` so the UI shows
 *     a summary by default and a rationale on expand,
 *   - `relatedEntryIds` (sorted ascending) listing every livestock entry the
 *     warning implicates — drives the UI's "click to highlight" + the stable
 *     id suffix.
 *
 * Severity is intentionally string-based rather than numeric so consumers
 * (UI badges, log filters) read the value, not its position. Ordering for
 * sort purposes is implemented in `evaluate.ts` via an explicit rank table.
 */

/**
 * Warning severity. Sorted by the aggregator as `error` > `warning` > `info`.
 * - `error` — design will visibly fail (e.g. temperature ranges don't overlap;
 *   bioload severely past the heuristic capacity).
 * - `warning` — likely problem but recoverable (e.g. schooler kept solo,
 *   peaceful + aggressive species mixed).
 * - `info` — heads-up only (e.g. bioload near capacity).
 */
export type WarningSeverity = 'info' | 'warning' | 'error';

/**
 * Stable code identifying which rule produced the warning. Adding a new rule
 * appends a new code; existing codes never change meaning so external readers
 * (UI tests, future analytics) can rely on them.
 */
export type WarningCode =
  | 'bioload-near-capacity'
  | 'bioload-overstocked'
  | 'bioload-severely-overstocked'
  | 'temperature-incompatible'
  | 'ph-incompatible'
  | 'temperament-clash'
  | 'schooling-below-minimum'
  | 'fin-nipper-with-long-finned';

/**
 * A single stocking-guidance warning.
 *
 * `id` is `<code>:<sorted relatedEntryIds joined by ','>`. Two evaluations of
 * the same scene produce identical ids; reordering livestock without changing
 * membership produces identical ids; adding / removing one entry changes ids
 * for warnings that referenced it but not for the others.
 */
export interface StockingWarning {
  /** Stable id for keying in the UI (`<code>:<sorted relatedEntryIds>`). */
  readonly id: string;
  readonly severity: WarningSeverity;
  readonly code: WarningCode;
  /** One-line summary shown by default. */
  readonly message: string;
  /** Multi-sentence rationale shown on expand — explains WHY this fired. */
  readonly explanation: string;
  /** Implicated livestock entry ids (sorted asc for stable id). */
  readonly relatedEntryIds: readonly string[];
}
