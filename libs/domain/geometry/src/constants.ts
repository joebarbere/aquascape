/**
 * Float tolerance used across this lib.
 *
 * All "is this number equal to that one" comparisons in geometry code go
 * through {@link approxEquals} (or compare `Math.abs(a - b) < EPSILON`
 * directly). Scaled or accumulated math (matrix composition, transform
 * inversion) may use a larger fuzz factor explicitly; do NOT raise this
 * constant globally.
 *
 * Chosen value: 1e-6. Comfortable for mm-scale aquascape geometry where
 * the largest reasonable coordinate is a few thousand mm and the smallest
 * meaningful distance is well above 1e-3 mm.
 */
export const EPSILON = 1e-6;

/** Golden ratio φ = (1 + √5) / 2 ≈ 1.61803398875. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Approximate equality for floats. Returns true if |a - b| < eps.
 * Defaults to {@link EPSILON}.
 */
export function approxEquals(a: number, b: number, eps: number = EPSILON): boolean {
  return Math.abs(a - b) < eps;
}
