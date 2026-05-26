// Behaviour-parameter types — single source of truth for F11.2.
//
// The catalog imports these structurally; we do NOT import the catalog (the
// dependency edge runs catalog → behaviors). Keep these as data-only interfaces
// so JSON serialisation is lossless and consumers can spread / merge freely.

/**
 * Couzin et al. (2002) three-zone schooling model parameters + Reynolds (1987)
 * weighted-steering weights. Distances in millimetres; speeds in mm/sec.
 */
export interface SchoolingParams {
  /** Zone of repulsion radius — mm. Below this, neighbours push us away. */
  ZOR: number;
  /** Zone of orientation radius — mm. Between ZOR and ZOO, we align headings. */
  ZOO: number;
  /** Zone of attraction radius — mm. Between ZOO and ZOA, we steer toward the centroid. */
  ZOA: number;
  /** Blind cone behind the fish (radians, total angle subtended). */
  blindAngle: number;
  /** Preferred cruise speed — mm/sec. */
  vPref: number;
  /** Hard cap on instantaneous speed — mm/sec. */
  vMax: number;
  /** Maximum heading change — rad/sec. */
  turnMax: number;
  /** Reynolds separation weight. */
  wSep: number;
  /** Reynolds alignment weight. */
  wAli: number;
  /** Reynolds cohesion weight. */
  wCoh: number;
  /** Per-tick Gaussian-equivalent noise magnitude — fraction of vPref. */
  noise: number;
}

/**
 * Vertical-stratification parameters — a soft restoring well centred on a
 * preferred fraction of tank height.
 */
export interface DepthParams {
  /** Preferred Y as a fraction of tank height (0 = substrate, 1 = waterline). */
  preferredY: number;
  /** Band half-width as a fraction of tank height. Inside this, only noise applies. */
  bandWidth: number;
  /** Restoring force magnitude when outside the band — mm/sec² equivalent. */
  returnForce: number;
}

/**
 * Carangiform tail-beat animation parameters — drives the vertex-shader
 * displacement in renderer-3d.
 */
export interface AnimationParams {
  /** Tail-beat frequency — Hz. */
  tailBeatFreq: number;
  /** Amplitude at the head end (fraction of body length). */
  ampHead: number;
  /** Amplitude at the tail tip (fraction of body length). */
  ampTail: number;
  /** Spine envelope exponent in `amp(s) = ampHead + (ampTail−ampHead) * pow(s, env)`. */
  envelopeExp: number;
}

/**
 * The fully resolved behaviour bundle returned by `resolveBehavior`.
 */
export interface ResolvedBehavior {
  schooling: SchoolingParams;
  depth: DepthParams;
  animation: AnimationParams;
}

/** Coarse classification used by `depthBandForSpecies` + the preset switch. */
export type DepthBand = 'top' | 'mid' | 'bottom';
