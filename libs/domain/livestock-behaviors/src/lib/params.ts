// Behaviour-parameter types — single source of truth for F11.2 + F11.3.
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
 * Territoriality parameters — Brown 1964 + Adams 2001 fatigue model, with the
 * Maynard Smith & Parker 1976 bourgeois rule shaping who wins the contest at
 * higher levels. Only a handful of species (cichlids, bettas) defend a
 * territory; the rest carry `territory: null` on `ResolvedBehavior`.
 */
export interface TerritoryParams {
  /** Inner defense radius — mm. Inside this, non-conspecifics get chased. */
  coreRadius: number;
  /**
   * Outer display radius — mm. Between core and display, owner posts only
   * (no chase). Outside, the owner ignores the intruder.
   */
  displayRadius: number;
  /** Chase-force magnitude when defending — mm/sec² equivalent. Higher = more aggressive pursuit. */
  aggression: number;
  /**
   * Per-second decay rate of accumulated fatigue. Fatigue scales chase
   * magnitude downward over 5–15s of sustained defense (Brown 1964 + Adams
   * 2001).
   */
  fatigueRate: number;
}

/**
 * Fin-nipping parameters — Keenleyside 1955 conspecific-group threshold,
 * Magurran 1990 group-size effect on aggression directed at heterospecifics.
 * Only nippers (tiger barb, rosy barb) carry non-null `nipping`.
 */
export interface NippingParams {
  /**
   * Minimum conspecific count visible nearby to suppress nipping behaviour.
   * Below this, the fish nips. (Tiger barbs school threshold ≈ 8 — they nip
   * when fewer than 8 cohort are visible.)
   */
  groupThreshold: number;
  /**
   * Minimum fraction of body length the target's longest fin must reach to be
   * a candidate. (Bettas have caudal fin ≈ 0.7 BL → easy target; tetras
   * ≈ 0.15 BL → ignored.)
   */
  finFraction: number;
  /** Per-second Poisson rate at which an eligible nip attempt fires when conditions hold. */
  rate: number;
}

/**
 * Anti-predator / fear parameters — Lima & Dill 1990 risk-allocation model.
 * Every fish carries fear params (no null option) — the values just differ by
 * species temperament and depth band.
 */
export interface FearParams {
  /** Baseline anxiety — added to every tick's risk integration. Higher = always-jumpy species. */
  riskBaseline: number;
  /** Risk level above which the FORAGE → REFUGE mode flip fires. */
  threshold: number;
  /**
   * Which hardscape coverScore source the species prefers when seeking a
   * refuge. `'any'` = no preference (nearest cover wins).
   */
  coverPreference: 'plants' | 'caves' | 'wood' | 'any';
  /**
   * Seconds to wait in REFUGE mode after risk drops below threshold, before
   * flipping back to FORAGE. (Lima & Dill 1990 — emergence delay is
   * species-typical, ~3–15s.)
   */
  emergenceDelay: number;
}

/**
 * The fully resolved behaviour bundle returned by `resolveBehavior`.
 *
 * `territory` + `nipping` are explicitly nullable: most species don't defend
 * a territory or nip, so the corresponding systems early-out on `null`.
 * `fear` is required — every fish reacts to predator-cursor and startle
 * events; the params vary by species but the field is never absent.
 */
export interface ResolvedBehavior {
  schooling: SchoolingParams;
  depth: DepthParams;
  animation: AnimationParams;
  /** Optional — most fish don't defend a territory. Null = non-territorial. */
  territory: TerritoryParams | null;
  /** Optional — most fish don't nip. Null = non-nipper. */
  nipping: NippingParams | null;
  /** Required — every fish has fear; the params just differ. */
  fear: FearParams;
}

/** Coarse classification used by `depthBandForSpecies` + the preset switch. */
export type DepthBand = 'top' | 'mid' | 'bottom';
