/**
 * Water-change command — Stage 13 F13.5a.
 *
 * The undoable model primitive that the Stage 15 siphon tool drives and the
 * water-change action (F13.5b) dispatches. A `WaterChange` removes a proportion
 * of the tank water and (optionally) mixes in replacement water with its own
 * dissolved parameters, diluting the water column's chemistry.
 *
 * ─── HONEST-BIOLOGY CONSTRAINT (load-bearing) ───────────────────────────────
 * A water change dilutes the **water column only**. Nitrifying bacteria live on
 * SURFACES — filter media, substrate, hardscape — NOT suspended in the water,
 * so a water change does **NOT** set back the nitrogen cycle. The command must
 * leave `aobColony`, `nobColony`, and `ageWeeks` (the cycling clock) UNTOUCHED.
 * Only the dissolved compounds (`ammonia` / `nitrite` / `nitrate`) and the bulk
 * parameters (`ph` / `gh` / `kh`, when a replacement supplies them) move. This
 * is a real aquarium fact; getting it wrong would let the sim "reset cycling"
 * on every water change.
 *
 * (`gh` / `kh` are not part of the persisted `WaterChemistry.chemistry` block —
 * which mirrors `water-sim`'s `WaterState` — so today only `ph` of the bulk
 * parameters is shiftable here. The `replacement.gh` / `.kh` fields are accepted
 * by the shared dilution helper for the runtime `WaterChemistryService` (F13.5b)
 * to consume; the command's chemistry mutation ignores axes the snapshot can't
 * store. See the helper's JSDoc.)
 *
 * ─── PURE / CAPTURE-AND-RESTORE INVERT ──────────────────────────────────────
 * `apply` dilutes via the shared {@link applyWaterChange} helper, then recomputes
 * the denormalized `cycle` stage from the new chemistry. `invert` restores the
 * EXACT prior `Tank.waterChemistry` snapshot it captured (lossy dilution can't
 * be re-derived from the post-state — see `RemoveDoseEvent`'s capture pattern).
 *
 * ─── ABSENT-CHEMISTRY EDGE CASE ─────────────────────────────────────────────
 * When `Tank.waterChemistry` is absent there is nothing to dilute, so the
 * command REJECTS with `reason: 'invalid'` (a clean typed error, not a silent
 * no-op). The Stage 15 / F13.5b callers only enable the water-change action once
 * chemistry is being tracked.
 *
 * ─── NO LOCKED-LAYER GUARD ──────────────────────────────────────────────────
 * A water change is not object-scoped — it belongs to no layer — so the
 * locked-layer policy does not apply (same reasoning as `DoseNutrient` /
 * livestock / equipment). It runs regardless of any layer's `locked` flag.
 */

import type { Scene, WaterChemistry } from './types';

// ─── Cycle-stage classification (mirrors water-sim's `cycleProgress`) ──────

/**
 * Ammonia/nitrite (mg/L-N) at or below this read as "safe / processed".
 * MIRRORS `SAFE_NITROGEN_MG_L` in `@aquascape/domain/water-sim` (`cycle.ts`).
 */
const SAFE_NITROGEN_MG_L = 0.25;
/**
 * Combined colony capacity below this reads as a brand-new, uncycled tank.
 * MIRRORS `UNCYCLED_COLONY_FLOOR` in `water-sim` (`cycle.ts`).
 */
const UNCYCLED_COLONY_FLOOR = 0.05;

function safeNum(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Classify a chemistry snapshot's cycling stage. A faithful re-implementation of
 * `@aquascape/domain/water-sim`'s `cycleProgress` — re-declared here (rather than
 * importing the lib) to keep `scene-model` dependency-light, exactly as it
 * re-declares `ResolvedNutrient` rather than depending on `domain/catalog`. The
 * thresholds + branch order are kept in lock-step with water-sim; the
 * `cycle-parity` test pins that they agree, and a CLAUDE.md/caveat note flags the
 * two as a mirror pair to keep aligned. The `chemistry` block is field-for-field
 * a water-sim `WaterState`, so the same predicate applies unchanged.
 */
function classifyCycle(chemistry: WaterChemistry['chemistry']): WaterChemistry['cycle'] {
  const ammonia = safeNum(chemistry.ammonia);
  const nitrite = safeNum(chemistry.nitrite);
  const aob = safeNum(chemistry.aobColony);
  const nob = safeNum(chemistry.nobColony);
  const colonies = aob + nob;

  // Cycled: both nitrogen species processed down to safe AND both colonies
  // have actually established.
  if (
    ammonia <= SAFE_NITROGEN_MG_L &&
    nitrite <= SAFE_NITROGEN_MG_L &&
    aob > UNCYCLED_COLONY_FLOOR &&
    nob > UNCYCLED_COLONY_FLOOR
  ) {
    return 'cycled';
  }
  // Uncycled: no meaningful bacteria yet AND nothing elevated to process.
  if (
    colonies <= UNCYCLED_COLONY_FLOOR &&
    ammonia <= SAFE_NITROGEN_MG_L &&
    nitrite <= SAFE_NITROGEN_MG_L
  ) {
    return 'uncycled';
  }
  // Everything in between is mid-cycle.
  return 'cycling';
}

// ─── Replacement-water params ─────────────────────────────────────────────

/**
 * The dissolved parameters of the replacement water mixed in during a change.
 * Every field is optional; an omitted dissolved compound defaults to clean
 * source water (`0` mg/L ammonia / nitrite / nitrate — clean tap or RO). The
 * bulk parameters (`ph` / `gh` / `kh`) only shift the tank toward them when the
 * caller supplies them; an omitted bulk parameter leaves that axis unchanged
 * (we never invent the replacement's pH/hardness).
 *
 * Plain serializable data — the field of the {@link WaterChangeCommand} record.
 */
export interface ReplacementWater {
  /** Replacement total-ammonia-as-N, mg/L. Default 0 (clean source). */
  ammonia?: number;
  /** Replacement nitrite-as-N, mg/L. Default 0 (clean source). */
  nitrite?: number;
  /** Replacement nitrate-as-N, mg/L. Default 0 (clean source). */
  nitrate?: number;
  /** Replacement pH. Omit to leave the tank's pH unchanged. */
  ph?: number;
  /** Replacement general hardness (dGH). Omit to leave gh unchanged. */
  gh?: number;
  /** Replacement carbonate hardness (dKH). Omit to leave kh unchanged. */
  kh?: number;
}

// ─── Command shape ────────────────────────────────────────────────────────

/**
 * Dilute the tank's water-column chemistry by swapping out `fractionReplaced`
 * of the volume for {@link ReplacementWater}.
 *
 * APPLY
 *  - `fractionReplaced` must be a finite number in `(0, 1]`; otherwise rejects
 *    `'invalid'`.
 *  - `Tank.waterChemistry` absent → rejects `'invalid'` (nothing to dilute).
 *  - Dissolved compounds blend `new = current·(1−f) + replacement·f`; `ph`
 *    shifts toward `replacement.ph` by the same blend when provided. The colony
 *    state + cycling clock are LEFT UNTOUCHED (see module JSDoc). The
 *    denormalized `cycle` stage is recomputed from the new chemistry.
 *
 * INVERT
 *  - Captures the entire pre-apply `Tank.waterChemistry` into
 *    `inverse.previousChemistry`; the inverse command's `apply` restores it
 *    verbatim. (Dilution is lossy — the prior nitrate can't be recovered from
 *    the diluted value + the fraction without the capture.)
 */
export interface WaterChangeCommand {
  kind: 'WaterChange';
  /** Proportion of the tank water swapped, in `(0, 1]`. */
  fractionReplaced: number;
  /** Replacement-water params; omitted ⇒ clean source water. */
  replacement?: ReplacementWater;
  /**
   * Pre-apply chemistry captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command from the UI / siphon tool. When present,
   * `apply` restores it verbatim (this is the undo pathway).
   */
  inverse?: { previousChemistry: WaterChemistry };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Blend a single dissolved-compound concentration:
 * `new = current·(1 − f) + replacement·f`. `f` is assumed validated in `(0, 1]`.
 */
function blend(current: number, replacement: number, f: number): number {
  return current * (1 - f) + replacement * f;
}

// ─── Pure dilution helper (the single source of dilution truth) ───────────

/**
 * Dilute a {@link WaterChemistry} snapshot by a water change of fraction `f`,
 * mixing in `replacement` water. Returns a NEW snapshot (the input is never
 * mutated) — framework-free + pure.
 *
 * **This is the single source of dilution truth.** Both the {@link waterChange}
 * Command (here) and the runtime `WaterChemistryService` (F13.5b — which dilutes
 * its live `WaterState`) import this so the model and the live tick agree by
 * construction.
 *
 * DILUTION MATH
 *  - Dissolved compounds (`ammonia` / `nitrite` / `nitrate`) blend toward the
 *    replacement's value: `new = current·(1−f) + replacement·f`. An omitted
 *    replacement compound is clean source water (`0`), so e.g. a 50 % change
 *    against clean water halves nitrate.
 *  - `ph` shifts toward `replacement.ph` by the same blend WHEN PROVIDED;
 *    omitted ⇒ pH unchanged (we never invent the replacement's pH).
 *
 * COLONY UNTOUCHED (honest biology)
 *  - `aobColony`, `nobColony`, `ageWeeks`, and `engineVersion` are copied
 *    through verbatim. Nitrifiers live on surfaces, not in the water column;
 *    diluting the water does not reduce the colony or reset the cycling clock.
 *
 * CYCLE RECOMPUTE
 *  - The denormalized `cycle` stage is re-derived from the new chemistry via
 *    {@link classifyCycle} (a faithful mirror of `water-sim`'s `cycleProgress`;
 *    the `chemistry` block is field-for-field a `WaterState`). Because the
 *    colony state is preserved, a cycled tank stays
 *    cycled across a water change — the dilution only lowers the dissolved
 *    nitrogen, which can only ever move the classification toward "safer".
 *
 * The `algae` block (independent accumulated coverage) is carried through
 * unchanged — a water change does not scrub algae off surfaces either.
 *
 * GH/KH NOTE
 *  - `replacement.gh` / `.kh` are accepted for the runtime service's benefit
 *    (it tracks hardness), but the persisted `WaterChemistry.chemistry` block
 *    mirrors `WaterState`, which has no gh/kh fields — so those axes are not
 *    written here. They are honoured by callers that carry a richer live state.
 *
 * @param chemistry        the snapshot to dilute.
 * @param fractionReplaced proportion swapped, in `(0, 1]` (NOT re-validated —
 *                         the command validates before calling; direct callers
 *                         must pass a sane fraction).
 * @param replacement      replacement-water params; omitted ⇒ clean source.
 */
export function applyWaterChange(
  chemistry: WaterChemistry,
  fractionReplaced: number,
  replacement: ReplacementWater = {},
): WaterChemistry {
  const f = fractionReplaced;
  const prev = chemistry.chemistry;

  const nextChemistry: WaterChemistry['chemistry'] = {
    // Dissolved compounds dilute toward replacement (default clean = 0).
    ammonia: blend(prev.ammonia, replacement.ammonia ?? 0, f),
    nitrite: blend(prev.nitrite, replacement.nitrite ?? 0, f),
    nitrate: blend(prev.nitrate, replacement.nitrate ?? 0, f),
    // pH shifts toward replacement only when provided; else unchanged.
    ph: replacement.ph !== undefined ? blend(prev.ph, replacement.ph, f) : prev.ph,
    // COLONY + CLOCK UNTOUCHED — nitrifiers live on surfaces, not in water.
    aobColony: prev.aobColony,
    nobColony: prev.nobColony,
    ageWeeks: prev.ageWeeks,
    engineVersion: prev.engineVersion,
  };

  // Recompute the denormalized cycle stage from the new chemistry (a mirror of
  // water-sim's `cycleProgress` — see {@link classifyCycle}).
  const cycle = classifyCycle(nextChemistry);

  const next: WaterChemistry = {
    chemistry: nextChemistry,
    cycle,
    // Algae coverage is independent accumulated surface state — unchanged by a
    // water change. Carry the (optional) block through, cloned for isolation.
    ...(chemistry.algae !== undefined ? { algae: clone(chemistry.algae) } : {}),
  };
  return next;
}

// ─── Apply ────────────────────────────────────────────────────────────────

/**
 * Apply a water-change command. Mirrors the `CommandResult` shape used by
 * `commands.applyCommand` so the main dispatcher can delegate without adapting
 * types. Validation runs on every apply (including the inverse/restore pathway)
 * so latent bugs surface at the boundary.
 */
export function applyWaterChangeCommand(
  scene: Scene,
  command: WaterChangeCommand,
):
  | { ok: true; scene: Scene }
  | { ok: false; reason: 'invalid' | 'not-found' | 'locked'; message: string } {
  // Absent-chemistry edge case: nothing to dilute → reject cleanly.
  if (scene.tank.waterChemistry === undefined) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'WaterChange: tank has no recorded water chemistry to dilute',
    };
  }

  // Undo pathway: restore the captured pre-apply chemistry verbatim.
  if (command.inverse !== undefined) {
    return {
      ok: true,
      scene: {
        ...scene,
        tank: {
          ...scene.tank,
          waterChemistry: clone(command.inverse.previousChemistry),
        },
      },
    };
  }

  // Forward pathway: validate the fraction, then dilute.
  if (
    !Number.isFinite(command.fractionReplaced) ||
    command.fractionReplaced <= 0 ||
    command.fractionReplaced > 1
  ) {
    return {
      ok: false,
      reason: 'invalid',
      message: `WaterChange: fractionReplaced must be a finite number in (0, 1]; got ${String(
        command.fractionReplaced,
      )}`,
    };
  }

  const next = applyWaterChange(
    scene.tank.waterChemistry,
    command.fractionReplaced,
    command.replacement,
  );

  return {
    ok: true,
    scene: { ...scene, tank: { ...scene.tank, waterChemistry: next } },
  };
}

// ─── Invert ───────────────────────────────────────────────────────────────

/**
 * Build the inverse of a water-change command. Captures the EXACT pre-apply
 * `Tank.waterChemistry` so undo restores it verbatim (dilution is lossy). When
 * the forward command would have rejected (no chemistry), the inverse is a
 * `'Noop'` — "apply nothing then invert nothing" preserves state.
 */
export function invertWaterChangeCommand(
  scene: Scene,
  command: WaterChangeCommand,
): WaterChangeCommand | { kind: 'Noop' } {
  const previousChemistry = scene.tank.waterChemistry;
  if (previousChemistry === undefined) {
    // Apply would have rejected; a replay-safe inverse is a Noop.
    return { kind: 'Noop' };
  }
  return {
    kind: 'WaterChange',
    // These fields are meaningless once `inverse` is present (apply restores
    // verbatim), but we keep them populated so the record stays well-formed +
    // serializable.
    fractionReplaced: command.fractionReplaced,
    ...(command.replacement !== undefined ? { replacement: clone(command.replacement) } : {}),
    inverse: { previousChemistry: clone(previousChemistry) },
  };
}

// ─── Builder factory ──────────────────────────────────────────────────────

/**
 * Build a {@link WaterChangeCommand}.
 *
 * @param fractionReplaced proportion of tank water swapped, in `(0, 1]`.
 * @param replacement      optional replacement-water params; omitted ⇒ clean
 *                         source water (0 ammonia/nitrite/nitrate; pH unchanged).
 *
 * The `inverse` envelope is omitted; {@link invertWaterChangeCommand} (via the
 * main `invertCommand`) populates it when undo is built.
 */
export function waterChange(
  fractionReplaced: number,
  replacement?: ReplacementWater,
): WaterChangeCommand {
  return {
    kind: 'WaterChange',
    fractionReplaced,
    ...(replacement !== undefined ? { replacement: { ...replacement } } : {}),
  };
}
