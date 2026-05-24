/**
 * Growth curve: an age-in-weeks → scale-relative-to-mature mapping for a plant.
 *
 * Shape: a logistic-style approach to maturity. At age 0 the scale is
 * `sizeAtZero`; at age `weeksToMature` the scale is `GROWTH_CURVE_TARGET` of
 * the way from `sizeAtZero` to 1; beyond that it asymptotes to 1 (clamped so
 * a 50-week-old hairgrass doesn't render at 1.001 × catalog size).
 *
 * Why logistic rather than linear: a linear curve would imply a discontinuity
 * at `weeksToMature` (suddenly stops growing), and would draw a 1-week-old
 * carpet at sizeAtZero + 1/W of the gap — visually identical to a 0-week
 * carpet. The exponential approach gives the early weeks visible movement,
 * which is the whole point of the time slider.
 *
 * Vigor is the per-object size multiplier (trimmed < 1, overgrown > 1) and is
 * applied AFTER clamping — so a `vigor: 1.2` plant can render at 1.2× the
 * catalog mature size by design.
 */

/**
 * Fraction of the way from `sizeAtZero` to 1.0 that the curve reaches at age
 * `weeksToMature`. 0.99 was picked so a "mature" plant looks visually
 * indistinguishable from full size (1% short) without the curve ever exactly
 * touching 1 in finite time.
 */
export const GROWTH_CURVE_TARGET = 0.99;

const DECAY = -Math.log(1 - GROWTH_CURVE_TARGET); // ≈ 4.605

export interface GrowthParams {
  /** Catalog: weeks to mature size for an average specimen at vigor = 1. */
  weeksToMature: number;
  /** Catalog: scale (in [0, 1]) at age 0. Carpets ~0.3, rosettes ~0.5. */
  sizeAtZero: number;
}

export interface PlantGrowthState {
  /** Scene-stored age in weeks. May be 0. */
  ageWeeks: number;
  /** Per-object vigor multiplier; 1 = average. */
  vigor: number;
}

/**
 * Compute a plant's current scale relative to its catalog mature size.
 *
 * `previewAgeWeeks`, when provided, overrides `state.ageWeeks` — used by the
 * time-slider preview so we can re-render at "what would this look like at
 * week 12?" without mutating the document.
 *
 * Returns a non-negative number. Typical range is `[sizeAtZero * vigor, vigor]`
 * but `vigor` may exceed 1; the caller decides whether to clamp visually.
 */
export function plantScale(
  params: GrowthParams,
  state: PlantGrowthState,
  previewAgeWeeks?: number,
): number {
  const ageWeeks = previewAgeWeeks ?? state.ageWeeks;
  // Negative ages don't make physical sense; treat as week 0.
  const age = Math.max(0, ageWeeks);
  // weeksToMature is schema-guarded > 0, but defend against bad runtime data.
  const W = params.weeksToMature > 0 ? params.weeksToMature : 1;
  const s0 = clamp01(params.sizeAtZero);

  // Logistic approach: progress = 1 - exp(-DECAY * (age / W)), clamped to 1
  // so the curve flattens at maturity (no infinite growth from the model).
  const progress = Math.min(1, 1 - Math.exp((-DECAY * age) / W));
  const baseScale = s0 + (1 - s0) * progress;

  return baseScale * state.vigor;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
