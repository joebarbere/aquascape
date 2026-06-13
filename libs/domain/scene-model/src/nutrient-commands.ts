/**
 * Nutrient dosing command. "Nutrients & additives + dosing" — F-B.
 *
 * Lives in a sibling module to keep `commands.ts` manageable, matching the
 * pattern set by `substrate-commands.ts` / `livestock-commands.ts`. The single
 * command's record shape + apply/invert switch cases + the builder factory all
 * live here; `commands.ts` only imports the union member + the two dispatcher
 * hooks and folds them into its own switch.
 *
 * RUNTIME-ONLY / CHEMISTRY DEFERRED
 * ---------------------------------
 * The "real" effect of dosing — raising `Tank.waterChemistry` — depends on a
 * Stage 13 field that does NOT exist yet. We ship "UX now, chemistry later":
 * `DoseNutrient` records the dose as a {@link DoseEvent} appended to the
 * runtime `scene.doseLog`. It applies NO chemistry. A future water-sim consumes
 * `doseLog` to compute the actual parameter changes.
 *
 * The appended `DoseEvent` is the undoable mutation: `apply` pushes it,
 * `invert` pops it.
 *
 * PURE PUSH / POP — DELTAS COMPUTED AT CONSTRUCTION
 * -------------------------------------------------
 * `apply` / `invert` never reach into the catalog. The {@link doseNutrient}
 * factory takes the ALREADY-RESOLVED nutrient entry, computes the per-parameter
 * deltas there, and bakes a fully-formed `DoseEvent` into the command record.
 * `apply` just appends that event; `invert` removes it by `id`. This keeps the
 * command serializable (no catalog reference, no closures) and the apply/invert
 * path trivially pure.
 *
 * DELTA COMPUTATION
 * -----------------
 *  - **disclosed** product → scale the catalog `contributes` block linearly by
 *    `amount / dose.amount` and store the resulting per-axis ppm/dGH map in
 *    `DoseEvent.deltas`. E.g. a product stating `+4.84 ppm NO3 per 0.3 g` dosed
 *    at `0.6 g` records `{ no3: 9.68 }`.
 *  - **proprietary** (`disclosed: false`) product → store NO numbers; the event
 *    carries only the qualitative `affects` list. Fabricating ppm is forbidden
 *    (the honesty contract from the catalog `NutrientEntry`).
 *
 * NO LOCKED-LAYER GUARD
 * ---------------------
 * Dosing is not object-scoped — a `DoseEvent` belongs to no layer — so the
 * locked-layer policy in `commands.ts` does not apply (same reasoning as
 * livestock / equipment commands). Dosing always runs regardless of any
 * layer's `locked` flag.
 */

import type { CatalogRef, DoseDeltas, DoseEvent, Scene, Uuid } from './types';

// ─── The resolved-nutrient input shape ────────────────────────────────────

/**
 * The minimal structural slice of a catalog `NutrientEntry` the dose factory
 * needs. Re-declared here (rather than importing `@aquascape/domain/catalog`)
 * so the scene-model keeps zero dependency on the catalog lib — the catalog's
 * `NutrientEntry` is structurally assignable to this. The factory caller is
 * responsible for resolving the entry from a `CatalogRef` before constructing.
 */
export interface ResolvedNutrient {
  catalog: string;
  id: string;
  version: number;
  disclosed: boolean;
  affects: readonly string[];
  dose: { amount: number; unit: 'g' | 'ml'; perLitres: number };
  contributes?: DoseDeltas;
}

// ─── Command shape ────────────────────────────────────────────────────────

/**
 * Append a fully-formed {@link DoseEvent} to `scene.doseLog` (initializing the
 * array when undefined). The event carries its own `id` + `seq` + computed
 * deltas; the {@link doseNutrient} factory builds it from a resolved nutrient
 * entry. Inverse: a `RemoveDoseEvent` keyed off the event's id.
 */
export interface DoseNutrientCommand {
  kind: 'DoseNutrient';
  event: DoseEvent;
  /** Insertion index; null/out-of-range/omitted → append. */
  index?: number | null;
}

/**
 * Remove a dose event by id. The inverse of `DoseNutrient`. Apply captures the
 * removed event + its index into `inverse` (populated by `invertCommand` on the
 * stored record) so the undo step re-inserts at the original ordinal. Reports
 * `'not-found'` when no event has that id.
 */
export interface RemoveDoseEventCommand {
  kind: 'RemoveDoseEvent';
  eventId: Uuid;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command.
   */
  inverse?: { event: DoseEvent; index: number };
}

/** Discriminated union of all nutrient-dosing commands. */
export type NutrientCommand = DoseNutrientCommand | RemoveDoseEventCommand;

// ─── Helpers ──────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

const DELTA_AXES = ['no3', 'po4', 'k', 'fe', 'mg', 'ca', 'gh', 'kh'] as const;

function findEvent(
  scene: Scene,
  eventId: Uuid,
): { event: DoseEvent; index: number } | null {
  const list = scene.doseLog;
  if (list === undefined) return null;
  const index = list.findIndex((e) => e.id === eventId);
  if (index < 0) return null;
  return { event: list[index] as DoseEvent, index };
}

function validateCatalogRefShape(ref: CatalogRef, label: string): string | null {
  if (typeof ref !== 'object' || ref === null) return `${label} must be an object`;
  if (typeof ref.catalog !== 'string' || ref.catalog.length === 0) {
    return `${label}.catalog must be a non-empty string`;
  }
  if (typeof ref.id !== 'string' || ref.id.length === 0) {
    return `${label}.id must be a non-empty string`;
  }
  if (!Number.isInteger(ref.version) || ref.version < 1) {
    return `${label}.version must be a positive integer`;
  }
  return null;
}

function validateEvent(event: DoseEvent): string | null {
  if (typeof event.id !== 'string' || event.id.length === 0) {
    return 'event.id must be a non-empty string';
  }
  if (!Number.isFinite(event.seq)) {
    return `event.seq must be a finite number; got ${String(event.seq)}`;
  }
  const refErr = validateCatalogRefShape(event.ref, 'event.ref');
  if (refErr !== null) return refErr;
  if (!Number.isFinite(event.amount) || event.amount <= 0) {
    return `event.amount must be a positive number; got ${String(event.amount)}`;
  }
  if (event.unit !== 'g' && event.unit !== 'ml') {
    return `event.unit must be 'g' or 'ml'; got ${String(event.unit)}`;
  }
  if (typeof event.disclosed !== 'boolean') {
    return 'event.disclosed must be a boolean';
  }
  if (!Array.isArray(event.affects)) {
    return 'event.affects must be an array';
  }
  return null;
}

// ─── Apply ────────────────────────────────────────────────────────────────

/**
 * Apply a nutrient-dosing command. Mirrors the `CommandResult` shape used by
 * `commands.applyCommand` so the main dispatcher can delegate without adapting
 * types. Following the substrate/livestock convention, validation runs on every
 * apply (including the inverse pathway) so latent bugs surface at the boundary.
 */
export function applyNutrientCommand(
  scene: Scene,
  command: NutrientCommand,
):
  | { ok: true; scene: Scene }
  | { ok: false; reason: 'invalid' | 'not-found' | 'locked'; message: string } {
  switch (command.kind) {
    case 'DoseNutrient': {
      const err = validateEvent(command.event);
      if (err !== null) {
        return { ok: false, reason: 'invalid', message: `DoseNutrient: ${err}` };
      }
      const current = scene.doseLog ?? [];
      if (current.some((e) => e.id === command.event.id)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `DoseNutrient: event id "${command.event.id}" already exists`,
        };
      }
      const doseLog = current.slice();
      const length = current.length;
      const insertAt =
        command.index === undefined ||
        command.index === null ||
        command.index < 0 ||
        command.index > length
          ? length
          : command.index;
      doseLog.splice(insertAt, 0, clone(command.event));
      return { ok: true, scene: { ...scene, doseLog } };
    }

    case 'RemoveDoseEvent': {
      const found = findEvent(scene, command.eventId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `RemoveDoseEvent: event "${command.eventId}" not found`,
        };
      }
      const list = scene.doseLog as readonly DoseEvent[];
      const doseLog = list.slice();
      doseLog.splice(found.index, 1);
      // Empty array → drop the field so "absent stays absent" holds across
      // Dose → invert(Remove) when the original scene had no `doseLog` at all.
      if (doseLog.length === 0) {
        const { doseLog: _omit, ...sceneWithout } = scene;
        return { ok: true, scene: sceneWithout };
      }
      return { ok: true, scene: { ...scene, doseLog } };
    }
  }
}

// ─── Invert ───────────────────────────────────────────────────────────────

/**
 * Build the inverse for a nutrient-dosing command given the scene it will/did
 * apply to. Returns a `NutrientCommand` or a `'Noop'`-shaped record when the
 * forward command would have rejected (Noop is sound — "apply nothing then
 * invert nothing" preserves state).
 */
export function invertNutrientCommand(
  scene: Scene,
  command: NutrientCommand,
): NutrientCommand | { kind: 'Noop' } {
  switch (command.kind) {
    case 'DoseNutrient': {
      // Inverse: remove the event we'd have just appended.
      return { kind: 'RemoveDoseEvent', eventId: command.event.id };
    }

    case 'RemoveDoseEvent': {
      const found = findEvent(scene, command.eventId);
      if (found === null) return { kind: 'Noop' };
      // Re-add at the original index so undo restores ordering.
      return {
        kind: 'DoseNutrient',
        event: clone(found.event),
        index: found.index,
      };
    }
  }
}

// ─── Delta computation ────────────────────────────────────────────────────

/**
 * Scale a nutrient's disclosed `contributes` block linearly by the dosed
 * amount: `delta[axis] = contributes[axis] × (amount / dose.amount)`. Returns
 * `undefined` for proprietary products (so no numbers are recorded) and skips
 * non-finite / absent axes. Exported for direct unit testing.
 */
export function computeDoseDeltas(
  nutrient: ResolvedNutrient,
  amount: number,
): DoseDeltas | undefined {
  if (!nutrient.disclosed) return undefined;
  const contributes = nutrient.contributes;
  if (contributes === undefined) return undefined;
  const baseAmount = nutrient.dose.amount;
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return undefined;
  const factor = amount / baseAmount;
  const deltas: DoseDeltas = {};
  let any = false;
  for (const axis of DELTA_AXES) {
    const v = contributes[axis];
    if (typeof v === 'number' && Number.isFinite(v)) {
      deltas[axis] = v * factor;
      any = true;
    }
  }
  return any ? deltas : undefined;
}

// ─── Builder factory ──────────────────────────────────────────────────────

/**
 * Build a `DoseNutrient` command for a resolved nutrient entry + dosed amount.
 *
 * The factory does all the catalog-aware work UP FRONT — resolves the units,
 * computes the linearly-scaled deltas (disclosed only), and bakes a finished
 * {@link DoseEvent} into the command — so the apply/invert path stays a pure
 * push/pop with no catalog access.
 *
 * @param nutrient  the already-resolved catalog nutrient entry.
 * @param amount    the dosed amount (must be > 0), in the nutrient's dose unit
 *                  unless `unit` overrides.
 * @param opts.id   the event id (UUID). Caller mints it; defaults are NOT
 *                  generated here so the command stays deterministic + the
 *                  scene-model has no id factory dependency baked into dosing.
 * @param opts.seq  monotonic ordering key. Caller typically passes
 *                  `nextDoseSeq(scene)`.
 * @param opts.unit override the dose unit (defaults to `nutrient.dose.unit`).
 */
export function doseNutrient(
  nutrient: ResolvedNutrient,
  amount: number,
  opts: { id: Uuid; seq: number; unit?: 'g' | 'ml' },
): DoseNutrientCommand {
  const unit = opts.unit ?? nutrient.dose.unit;
  const deltas = computeDoseDeltas(nutrient, amount);
  const event: DoseEvent = {
    id: opts.id,
    seq: opts.seq,
    ref: { catalog: nutrient.catalog, id: nutrient.id, version: nutrient.version },
    amount,
    unit,
    disclosed: nutrient.disclosed,
    affects: nutrient.affects.slice(),
    // Only attach `deltas` when present — proprietary products omit it.
    ...(deltas !== undefined ? { deltas } : {}),
  };
  return { kind: 'DoseNutrient', event };
}

/** Build a `RemoveDoseEvent` command for a dose-event id. */
export const removeDoseEvent = (eventId: Uuid): RemoveDoseEventCommand => ({
  kind: 'RemoveDoseEvent',
  eventId,
});
