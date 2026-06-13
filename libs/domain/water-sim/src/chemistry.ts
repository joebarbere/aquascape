/**
 * Deterministic aquarium water-chemistry model — the nitrogen cycle, tank
 * cycling, and pH drift. Plan Stage 13 F13.1 / ADR-0006.
 *
 * ─── Design contract ───────────────────────────────────────────────────────
 * Pure + total + deterministic. No Angular/DOM/Electron, no `Date.now()`, no
 * `Math.random()`. Time is an INPUT (`elapsedWeeks`), never read from a clock.
 * Same `(params, state, elapsedWeeks, source, seed)` ⇒ byte-identical output.
 *
 * ─── The model (two-stage nitrification + growing colony capacity) ──────────
 * The biological filter is two bacterial guilds:
 *   1. Ammonia-oxidising bacteria (AOB, e.g. Nitrosomonas): NH3 → NO2.
 *   2. Nitrite-oxidising bacteria (NOB, e.g. Nitrobacter/Nitrospira): NO2 → NO3.
 * Each guild has a population (`aob`, `nob`) that GROWS toward a carrying
 * capacity set by its food supply (ammonia for AOB, nitrite for NOB) and decays
 * when starved. Because NOB only have food once AOB produce nitrite, the second
 * stage lags the first — this lag IS the classic fishless-cycle curve: ammonia
 * spikes and falls, then nitrite spikes and falls, then nitrate accumulates.
 *
 * Conversion is mass-conserving in the nitrogen channel: every mg/L of ammonia
 * (as N) oxidised becomes nitrite (as N), then nitrate (as N). We track the
 * three species in mg/L and the colony populations as dimensionless [0, ~∞)
 * "capacity to process X mg/L per day" scalars.
 *
 * Nitrate only leaves the system via a water change (a separate event, not
 * modelled here) — so nitrate monotonically accumulates between changes, which
 * is the husbandry point.
 *
 * ─── Sources & honesty ──────────────────────────────────────────────────────
 * The relationships are real and sourced; the absolute rate constants are
 * deliberately CALIBRATED approximations (labelled below) tuned so a typical
 * fishless cycle completes in ~4–6 weeks — the hobby-standard window — rather
 * than measured from a specific reactor study. They are NOT presented as
 * authoritative kinetic constants. See `docs/caveats/water-sim.md`.
 *   - Two-stage nitrification + the nitrite lag: Hovanec & DeLong 1996;
 *     Hagopian & Riley 1998 (review of nitrification in aquaria/aquaculture).
 *   - Fishless-cycle duration ~3–6 weeks: hobby consensus (e.g. the
 *     "add-ammonia" fishless-cycle method) — calibration target, not a citation
 *     of a rate constant.
 *   - NH3/NH4+ equilibrium pH/temperature dependence: Emerson et al. 1975,
 *     "Aqueous ammonia equilibrium calculations" (J. Fish. Res. Board Can.) —
 *     see ammonia.ts for the pKa relation.
 *
 * ─── Engine version ─────────────────────────────────────────────────────────
 * `ENGINE_VERSION` is bumped whenever the rate model changes outputs so saved
 * sims can replay with — or migrate from — their original model. A persisted
 * `WaterState` SHOULD record the engine version it was produced under (the
 * document field, F13.2, owns that); the model here is the source of truth for
 * the current version constant.
 */

import { signedJitter } from './prng';

/**
 * Rate-model engine version. **Bump this whenever a change to the constants or
 * equations below shifts the output of an existing `(state, inputs, seed)`.**
 * F13.2's document field stores this alongside the persisted snapshot so an old
 * save replays under its original model or migrates explicitly.
 */
export const ENGINE_VERSION = 1;

// ─── Calibrated rate constants (per day) ────────────────────────────────────
// These are labelled approximations, tuned to the hobby fishless-cycle window
// (~4–6 weeks to fully nitrified for a moderate ammonia source). They are NOT
// measured kinetic constants.

/** Bacterial colony growth rate per day when well-fed (logistic r). */
const COLONY_GROWTH_PER_DAY = 0.55;
/** Bacterial colony decay rate per day when starved (no substrate). */
const COLONY_DECAY_PER_DAY = 0.12;
/**
 * Max ammonia (mg/L-N) one unit of AOB capacity oxidises per day; same for one
 * unit of NOB on nitrite. Sets the ceiling processing speed of a mature filter.
 */
const PROCESS_PER_CAPACITY_PER_DAY = 1.6;
/**
 * Half-saturation (Monod) constant in mg/L-N: substrate level at which the
 * colony's food supply (and thus its carrying capacity) is half-maxed. Low so
 * even modest ammonia drives colony growth — matches how quickly a dosed
 * fishless cycle establishes. (Monod form: Hagopian & Riley 1998.)
 */
const HALF_SATURATION_N = 0.1;
/**
 * Carrying capacity (in capacity-units) per mg/L-N of available substrate at
 * saturation. Caps how big a colony a given bioload can sustain.
 */
const CAPACITY_PER_SATURATED_N = 4;

/** pH drift per day from nitrification acidifying the water (KH-buffered). */
const PH_ACID_DRIFT_PER_DAY = 0.04;
/** Daily relative jitter band on the source term (feeding/decay irregularity). */
const SOURCE_JITTER_FRACTION = 0.15;

/** Stable PRNG channels (per-purpose salts) so sub-streams never collide. */
const CHANNEL = {
  SOURCE: 0x5a17e0,
  AOB: 0x40b1,
  NOB: 0x40b2,
} as const;

/** Fixed-Euler sub-step in days. Small enough that the stiff colony/substrate
 * coupling stays stable; integer steps per day keep determinism clean. */
const STEP_DAYS = 0.25;
const DAYS_PER_WEEK = 7;

export interface WaterChemistryParams {
  /**
   * Tank water volume in litres. The bioload source is an absolute mass rate
   * (mg-N/day); volume converts it to a concentration rate (mg/L/day). Guarded
   * to a sane floor.
   */
  volumeLitres: number;
  /** Carbonate hardness (dKH). Higher KH buffers pH against nitrification acid. */
  kh: number;
  /** Water temperature in °C. Faster bacteria when warmer (labelled approx). */
  temperatureC: number;
}

export interface WaterState {
  /** Free + ionised ammonia as nitrogen, mg/L (test-kit "total ammonia"). */
  ammonia: number;
  /** Nitrite as nitrogen, mg/L. */
  nitrite: number;
  /** Nitrate as nitrogen, mg/L. Accumulates until a water change. */
  nitrate: number;
  /** Water pH. */
  ph: number;
  /** Ammonia-oxidiser colony capacity (dimensionless). 0 = brand-new tank. */
  aobColony: number;
  /** Nitrite-oxidiser colony capacity (dimensionless). 0 = brand-new tank. */
  nobColony: number;
  /** Total simulated weeks this state has been advanced — the cycling clock. */
  ageWeeks: number;
  /** Engine version that produced this state (replay/migration provenance). */
  engineVersion: number;
}

/**
 * A fresh, uncycled tank at typical tap-water values: no nitrogen species, no
 * bacterial colony, neutral-ish pH. Callers may override any field.
 */
export function freshWaterState(overrides: Partial<WaterState> = {}): WaterState {
  return {
    ammonia: 0,
    nitrite: 0,
    nitrate: 0,
    ph: 7.4,
    aobColony: 0,
    nobColony: 0,
    ageWeeks: 0,
    engineVersion: ENGINE_VERSION,
    ...overrides,
  };
}

/**
 * Advance the water chemistry forward by `elapsedWeeks`, returning a NEW state
 * (the input is never mutated).
 *
 * @param params  tank physical params (volume, KH, temperature).
 * @param state   current chemistry state.
 * @param elapsedWeeks  simulated weeks to advance (≥ 0). Time is an input.
 * @param sourceN  ammonia source as nitrogen MASS rate, mg-N/day, from bioload
 *                 (`domain/stocking`) plus an optional Stage-14 feeding-waste
 *                 hook. Caller-supplied; the model does not recompute bioload.
 * @param seed     document seed; all jitter derives from it via stable channels.
 */
export function simulateChemistry(
  params: WaterChemistryParams,
  state: WaterState,
  elapsedWeeks: number,
  sourceN: number,
  seed: number,
): WaterState {
  const weeks = Number.isFinite(elapsedWeeks) ? Math.max(0, elapsedWeeks) : 0;
  if (weeks === 0) {
    // No time passed → identity (but stamp engine version for provenance).
    return { ...state, engineVersion: ENGINE_VERSION };
  }

  const volume = Number.isFinite(params.volumeLitres) ? Math.max(1, params.volumeLitres) : 1;
  const kh = Number.isFinite(params.kh) ? Math.max(0, params.kh) : 4;
  const tempC = Number.isFinite(params.temperatureC) ? params.temperatureC : 25;
  const src = Number.isFinite(sourceN) ? Math.max(0, sourceN) : 0;

  // Temperature factor: nitrifiers roughly double their rate per ~10 °C over a
  // moderate band, dropping off in the cold. Labelled approximation — a Q10≈2
  // van 't Hoff scaling clamped to a plausible aquarium range (Hagopian &
  // Riley 1998 note strong temperature dependence; the exact curve is ours).
  const tempFactor = clamp(Math.pow(2, (tempC - 25) / 10), 0.25, 2.5);

  // mg/L per (mg-N/day) — convert the absolute source mass rate to a
  // concentration rate for this tank volume.
  const sourcePerDayConc = src / volume;

  // Total integer sub-steps across the requested span. We step the global
  // simulation clock (`ageWeeks`) so successive calls jitter on distinct steps.
  const totalDays = weeks * DAYS_PER_WEEK;
  const nSteps = Math.max(1, Math.round(totalDays / STEP_DAYS));
  const dtDays = totalDays / nSteps;

  let ammonia = nonNeg(state.ammonia);
  let nitrite = nonNeg(state.nitrite);
  let nitrate = nonNeg(state.nitrate);
  let ph = Number.isFinite(state.ph) ? state.ph : 7.4;
  let aob = nonNeg(state.aobColony);
  let nob = nonNeg(state.nobColony);

  // Stable step offset so the jitter stream is continuous across calls.
  const baseStep = Math.round(nonNeg(state.ageWeeks) * DAYS_PER_WEEK / STEP_DAYS);

  for (let i = 0; i < nSteps; i++) {
    const step = baseStep + i;

    // ── Source term: ammonia in, with deterministic daily-irregularity jitter.
    const sJ = 1 + SOURCE_JITTER_FRACTION * signedJitter(seed, CHANNEL.SOURCE, step);
    ammonia += sourcePerDayConc * Math.max(0, sJ) * dtDays;

    // ── Colony dynamics (logistic toward a substrate-set carrying capacity).
    // Carrying capacity follows Monod saturation on the available substrate.
    const aobCap = CAPACITY_PER_SATURATED_N * monod(ammonia);
    const nobCap = CAPACITY_PER_SATURATED_N * monod(nitrite);

    aob = stepColony(aob, aobCap, dtDays, seed, CHANNEL.AOB, step);
    nob = stepColony(nob, nobCap, dtDays, seed, CHANNEL.NOB, step);

    // ── Two-stage conversion, Monod-limited by substrate, capped by what's
    // actually present this step (mass-conserving, never goes negative).
    const aobRate = PROCESS_PER_CAPACITY_PER_DAY * aob * tempFactor * monod(ammonia);
    const oxidisedNH3 = Math.min(ammonia, aobRate * dtDays);
    ammonia -= oxidisedNH3;
    nitrite += oxidisedNH3; // NH3-N → NO2-N (mass-conserving)

    const nobRate = PROCESS_PER_CAPACITY_PER_DAY * nob * tempFactor * monod(nitrite);
    const oxidisedNO2 = Math.min(nitrite, nobRate * dtDays);
    nitrite -= oxidisedNO2;
    nitrate += oxidisedNO2; // NO2-N → NO3-N (mass-conserving)

    // ── pH drift: nitrification consumes alkalinity → acidifies. KH buffers it;
    // higher KH ⇒ slower drift. Proportional to nitrification activity so a
    // dormant tank doesn't drift. (Direction & KH-buffering are real chemistry;
    // the coefficient is a labelled approximation.)
    const nitrified = oxidisedNH3 + oxidisedNO2;
    const buffer = 1 / (1 + kh); // KH=0 → full drift; large KH → ~0 drift
    ph -= PH_ACID_DRIFT_PER_DAY * nitrified * buffer * dtDays;
    ph = clamp(ph, 5.5, 8.6);
  }

  return {
    ammonia: round4(ammonia),
    nitrite: round4(nitrite),
    nitrate: round4(nitrate),
    ph: round4(ph),
    aobColony: round4(aob),
    nobColony: round4(nob),
    ageWeeks: round4(nonNeg(state.ageWeeks) + weeks),
    engineVersion: ENGINE_VERSION,
  };
}

/** One logistic colony step toward `capacity`, with growth/decay + tiny jitter. */
function stepColony(
  pop: number,
  capacity: number,
  dtDays: number,
  seed: number,
  channel: number,
  step: number,
): number {
  let next: number;
  if (capacity > pop) {
    // Logistic growth toward capacity. The (1 - pop/cap) factor slows the
    // approach so colonies establish on a lag, not instantly.
    const r = COLONY_GROWTH_PER_DAY * (1 - pop / Math.max(capacity, 1e-9));
    // Small deterministic jitter so colony establishment isn't perfectly smooth
    // (mirrors growth-sim's per-instance jitter idea).
    const jitter = 1 + 0.05 * signedJitter(seed, channel, step);
    next = pop + (r * pop + COLONY_GROWTH_PER_DAY * 0.01) * jitter * dtDays;
    // The +0.01 seed term lets a zero colony bootstrap from ambient bacteria.
  } else {
    // Starved: decay toward the (lower) capacity.
    next = pop - COLONY_DECAY_PER_DAY * (pop - capacity) * dtDays;
  }
  return nonNeg(next);
}

/** Monod saturation in [0, 1) for a substrate concentration (mg/L-N). */
function monod(substrate: number): number {
  const s = nonNeg(substrate);
  return s / (s + HALF_SATURATION_N);
}

function nonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Round to 4 dp to keep persisted/compared state byte-stable across engines. */
function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e4) / 1e4;
}
