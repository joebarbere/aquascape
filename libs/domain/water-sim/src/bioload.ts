/**
 * Bioload → ammonia source term (Stage 13 F13.3).
 *
 * The single pure helper both F13.3 driver paths use to turn a scene's
 * STOCKING into the `sourceN` argument `simulateChemistry` expects (ammonia as
 * a nitrogen MASS rate, mg-N/day). Keeping it here — in `domain/water-sim` —
 * means the editor preview-time path and the live `WaterChemistryService` agree
 * on the bioload model by construction (they call the same function), rather
 * than re-deriving it in two places that could drift.
 *
 * ─── Agreement with the live ECS waste producer ─────────────────────────────
 * The live simulation reads its source term from `world.getWasteSourceN()`
 * (Stage 14 F14.4), whose per-fish baseline is a FLAT
 * `FISH_BASELINE_WASTE_N_MG_PER_DAY = 0.6` mg-N/day per fish (it does not weight
 * by bioload class — the ECS doesn't carry the catalog `bioloadClass`). This
 * helper anchors a `medium`-class fish to exactly that baseline so the two
 * agree for the common community-tank case; `low`/`high` classes scale around
 * it (×0.5 / ×2.0, the `domain/stocking` bioload weights) so the editor
 * estimate is a touch more nuanced than the flat live baseline. The constant is
 * MIRRORED from `livestock-ecs`'s `FISH_BASELINE_WASTE_N_MG_PER_DAY` — keep the
 * two in lock-step (a `water-sim` dep on `livestock-ecs`/bitECS just to import
 * a number isn't worth it). See `docs/caveats/water-sim.md`.
 *
 * Pure + deterministic + framework-free: no Angular/DOM, no clock, no random.
 */

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';

/**
 * Steady per-fish ammonia excretion, nitrogen mass per day (mg-N/day), for a
 * `medium`-bioload-class fish. **MIRRORS `FISH_BASELINE_WASTE_N_MG_PER_DAY` in
 * `@aquascape/domain/livestock-ecs`'s `waste-accumulator.ts`** — the live tick's
 * per-fish baseline. Keep them equal so the editor preview cycle and the live
 * simulation cycle land in the same ballpark for a medium-class tank.
 */
export const FISH_BASELINE_WASTE_N_MG_PER_DAY = 0.6;

/**
 * Per-bioload-class multiplier on the per-fish baseline. Mirrors the weights
 * `domain/stocking`'s bioload rule uses (low ×0.5, medium ×1.0, high ×2.0) so
 * the chemistry source and the stocking warning tell a consistent story.
 */
const BIOLOAD_CLASS_MULTIPLIER: Record<'low' | 'medium' | 'high', number> = {
  low: 0.5,
  medium: 1.0,
  high: 2.0,
};

/** Default multiplier when a catalog row omits `bioloadClass` (treat as medium). */
const DEFAULT_CLASS_MULTIPLIER = 1.0;

/**
 * Compute the ammonia source term (mg-N/day) for a scene's livestock, for use
 * as `simulateChemistry`'s `sourceN`. Pure + total + deterministic.
 *
 * Per entry: `quantity × baseline × classMultiplier`. Sums in `scene.livestock`
 * document order; missing / non-livestock catalog refs contribute the flat
 * baseline (no class info ⇒ treat as medium). An empty / absent livestock list
 * yields 0 (an unstocked tank has no bioload source — it never cycles, matching
 * the model's `sourceN = 0` behaviour).
 *
 * This is the editor preview-time source term. The live `WaterChemistryService`
 * uses `world.getWasteSourceN()` instead (which folds in uneaten-food decay on
 * top of the same per-fish baseline) — see the F13.3 notes.
 */
export function bioloadSourceN(scene: Scene, catalog: Catalog): number {
  const livestock = scene.livestock ?? [];
  if (livestock.length === 0) return 0;

  let total = 0;
  for (const entry of livestock) {
    const quantity = Number.isFinite(entry.quantity) ? Math.max(0, entry.quantity) : 0;
    if (quantity === 0) continue;

    const row = catalog.get(entry.ref);
    const cls =
      row !== null && row.kind === 'livestock'
        ? (row.bioloadClass as 'low' | 'medium' | 'high' | undefined)
        : undefined;
    const mult =
      cls !== undefined ? BIOLOAD_CLASS_MULTIPLIER[cls] ?? DEFAULT_CLASS_MULTIPLIER : DEFAULT_CLASS_MULTIPLIER;

    total += quantity * FISH_BASELINE_WASTE_N_MG_PER_DAY * mult;
  }
  return total;
}
