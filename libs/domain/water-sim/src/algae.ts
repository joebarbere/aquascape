/**
 * Algae growth increment model. Plan Stage 13 F13.1 (full simulation lands in
 * F13.6, feeding the ECS `Hardscape.algaeScore`).
 *
 * Algae growth is driven by the same nutrient + light + flow imbalance that
 * real planted-tank algae respond to. Different types favour different
 * conditions — this is honest hobby knowledge (e.g. green-spot algae loves
 * strong light + low phosphate; diatoms bloom in new, low-light/silicate tanks;
 * black-beard algae thrives in unstable CO2 / high flow; hair algae rides
 * excess nutrients under bright light). The exact coefficients are labelled
 * approximations tuned to give each type a recognisable niche — they are not
 * measured biological growth rates.
 *
 * `algaeGrowth` returns a per-`dt` growth INCREMENT (a dimensionless scalar the
 * caller accumulates into a [0,1]-ish coverage/score). It can be negative-free:
 * growth is never below 0 here; grazing/removal is the caller's concern.
 */

export type AlgaeType = 'green-spot' | 'hair' | 'black-beard' | 'diatom';

interface AlgaeProfile {
  /** Base growth coefficient per day at favourable conditions. */
  base: number;
  /** Nitrate (mg/L) at which the nutrient driver is half-saturated. */
  nitrateHalf: number;
  /** Preferred daily photoperiod (hours) — growth peaks near this. */
  lightOptimumHours: number;
  /** How sharply growth falls off away from the light optimum (hours σ). */
  lightToleranceHours: number;
  /**
   * Flow response in [-1, 1]: +ve = likes flow (BBA), -ve = suppressed by flow
   * (diatoms/film), 0 = indifferent. `flow` input is a normalised 0..1 scalar.
   */
  flowAffinity: number;
}

/**
 * Per-type niches (labelled approximations of hobby consensus):
 *  - green-spot: bright-light lover, moderate nutrients.
 *  - hair: rides high nutrients under long, bright photoperiods.
 *  - black-beard: thrives with strong flow + unstable conditions, lower light ok.
 *  - diatom: new-tank bloom — low light, suppressed by flow, modest nutrients.
 */
const PROFILES: Record<AlgaeType, AlgaeProfile> = {
  'green-spot': {
    base: 0.18,
    nitrateHalf: 20,
    lightOptimumHours: 10,
    lightToleranceHours: 4,
    flowAffinity: 0.1,
  },
  hair: {
    base: 0.26,
    nitrateHalf: 15,
    lightOptimumHours: 11,
    lightToleranceHours: 4,
    flowAffinity: 0.2,
  },
  'black-beard': {
    base: 0.2,
    nitrateHalf: 10,
    lightOptimumHours: 8,
    lightToleranceHours: 6,
    flowAffinity: 0.8,
  },
  diatom: {
    base: 0.22,
    nitrateHalf: 5,
    lightOptimumHours: 6,
    lightToleranceHours: 5,
    flowAffinity: -0.6,
  },
};

/**
 * Growth increment for one algae type over `dt` days.
 *
 * @param type     algae type.
 * @param nitrate  nitrate concentration, mg/L (the nutrient driver).
 * @param lightHours daily photoperiod in hours (0..24).
 * @param flow     normalised flow scalar 0..1 (0 = still, 1 = strong current).
 * @param dt       elapsed time in days (≥ 0).
 * @returns a non-negative growth increment (dimensionless).
 */
export function algaeGrowth(
  type: AlgaeType,
  nitrate: number,
  lightHours: number,
  flow: number,
  dt: number,
): number {
  const profile = PROFILES[type];
  if (!profile) return 0;

  const dtDays = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (dtDays === 0) return 0;

  // Nutrient driver: Monod saturation on nitrate (no nitrate ⇒ ~no growth).
  const n = Number.isFinite(nitrate) && nitrate > 0 ? nitrate : 0;
  const nutrient = n / (n + profile.nitrateHalf);

  // Light driver: Gaussian around the type's optimum photoperiod; longer or
  // shorter days both reduce growth. No light ⇒ folds toward 0 via the tail.
  const hours = clamp(Number.isFinite(lightHours) ? lightHours : 0, 0, 24);
  const dl = (hours - profile.lightOptimumHours) / profile.lightToleranceHours;
  const light = Math.exp(-0.5 * dl * dl);

  // Flow driver: maps the type's affinity onto a [~0.4, ~1.6] multiplier.
  const f = clamp(Number.isFinite(flow) ? flow : 0, 0, 1);
  const flowDriver = clamp(1 + profile.flowAffinity * (f - 0.5) * 2, 0.2, 1.8);

  return Math.max(0, profile.base * nutrient * light * flowDriver * dtDays);
}

/** Exposed for tests / callers that want to enumerate the supported types. */
export const ALGAE_TYPES: readonly AlgaeType[] = ['green-spot', 'hair', 'black-beard', 'diatom'];

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
