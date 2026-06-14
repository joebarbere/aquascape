/**
 * VitalitySystem (Stage 14 F14.2).
 *
 * Integrates one health scalar per fish (`HealthDrive.health ∈ [0, 1]`) off
 * two stressors and one recovery channel, all per fixed sim tick:
 *
 *   1. STARVATION — `FeedingDrive.hunger` is already integrated by
 *      `feedingSystem` (which runs just before us). When hunger sits ABOVE
 *      `STARVE_HUNGER_THRESHOLD` the fish loses health at
 *      `STARVE_HEALTH_DECAY_PER_SEC`, scaled by how far past the threshold it
 *      is (so a barely-hungry fish decays slowly, a famished one fast).
 *
 *   2. WATER QUALITY — the world's injected `waterQuality` scalars (ammonia +
 *      nitrite, mg/L) drive health decay above a safe floor. Ammonia is the
 *      more acutely toxic of the two, so it carries the larger coefficient.
 *      The input DEFAULTS to clean (0/0) on every world, so a tank with no
 *      chemistry wired behaves benignly.
 *
 *   3. RECOVERY — when the fish is NOT starving AND the water is clean (both
 *      stressors below their floors) health recovers slowly toward 1 at
 *      `HEALTH_RECOVERY_PER_SEC`. Recovery is deliberately an order of
 *      magnitude slower than decay (real fish recover from stress over days,
 *      crash in hours).
 *
 * A tiny deterministic per-fish jitter (`tickPrng` keyed by the STABLE
 * `BehaviorParamsRef.spawnIndex`, never the bitECS eid, never `Math.random` /
 * wall-clock) breaks the otherwise-identical decay of a uniform school so the
 * HUD shows a spread of health rather than every fish moving in lockstep. The
 * jitter is a small ± multiplier on the *stress* term only (it never injects
 * health), keeping it sub-dominant to the modelled decay.
 *
 * DETERMINISM (load-bearing): every input (hunger, water quality, dt) is a
 * deterministic scalar; the only entropy is the spawnIndex-keyed jitter. Two
 * cold worlds built from the same seed + the same spawn sequence + the SAME
 * injected water-quality input therefore integrate health identically — the
 * 1000-tick byte-identical replay holds. A world that never calls
 * `setWaterQuality` keeps the default clean (0/0) input, so its replay is
 * reproducible run-to-run (the jitter is the only seed-dependent term).
 *
 * Runs AFTER `feedingSystem` (so it reads the freshly-integrated hunger) and
 * is mode-agnostic — a fleeing (REFUGE) fish still starves + suffers bad water.
 */
import { defineQuery } from 'bitecs';
import {
  BehaviorParamsRef,
  FeedingDrive,
  HealthDrive,
} from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

const vitalityQuery = defineQuery([HealthDrive, FeedingDrive, BehaviorParamsRef]);

/**
 * `tickPrng` partition key for the vitality jitter. An FNV-1a fold of the
 * literal `'vitality'` so the stream sits clear of the per-entity behaviour
 * keys (small integers) and the food / bubble keys. Module-scope constant —
 * two worlds at the same tick draw the same stream layout.
 */
export const VITALITY_KEY = (() => {
  let h = 0x811c9dc5;
  const s = 'vitality';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

// ─── Starvation ───────────────────────────────────────────────────────────

/**
 * Hunger level (same `[0, ∞)` scale `FeedingDrive.hunger` integrates on)
 * above which a fish is "starving" and starts losing health. A well-fed
 * fish resets hunger to 0 on eating, so this only trips after a sustained
 * gap with no food. The presets' `hungerRatePerSec` (≈ 1/120) mean a fish
 * crosses 1.0 after ~2 minutes sim-time without food — so this threshold
 * is set above the typical feeding `threshold` (~0.3–0.4) but reachable.
 */
export const STARVE_HUNGER_THRESHOLD = 1.0;

/**
 * Health lost per second at the moment hunger is exactly one unit past the
 * starvation threshold. Scaled linearly by `(hunger - threshold)`. At
 * 0.004/s a fish one unit over threshold drops from full to critical in
 * ~250 s (~4 min) sim-time — visible on the time-slider scale without being
 * instantly lethal.
 */
export const STARVE_HEALTH_DECAY_PER_SEC = 0.004;

// ─── Water quality ──────────────────────────────────────────────────────────

/**
 * Ammonia concentration (mg/L) below which water counts as "clean" for the
 * recovery gate + the decay floor. Mirrors the hobby-standard 0.25 mg/L
 * "safe" test-kit floor used by `domain/water-sim`'s `SAFE_NITROGEN_MG_L`.
 */
export const WATER_SAFE_AMMONIA_MG_L = 0.25;
/** Nitrite safe floor (mg/L). Same hobby 0.25 mg/L band. */
export const WATER_SAFE_NITRITE_MG_L = 0.25;

/**
 * Health lost per second per mg/L of ammonia ABOVE the safe floor. Ammonia
 * (NH3) is acutely toxic — gill damage within hours at a few mg/L — so it
 * carries the larger coefficient. At 0.01/(s·mg/L) a tank sitting 1 mg/L over
 * the floor crashes a fish from full to critical in ~100 s sim-time.
 */
export const AMMONIA_HEALTH_DECAY_PER_MG_PER_SEC = 0.01;
/**
 * Health lost per second per mg/L of nitrite above the safe floor. Nitrite
 * (brown-blood disease) is serious but slower-acting than ammonia, so it's
 * weighted lower.
 */
export const NITRITE_HEALTH_DECAY_PER_MG_PER_SEC = 0.005;

// ─── Recovery ───────────────────────────────────────────────────────────────

/**
 * Health regained per second when the fish is well-fed (hunger below the
 * starvation threshold) AND the water is clean (both species below their
 * safe floor). At 0.0008/s a stressed-but-recovering fish climbs from
 * critical back to full in ~20 min sim-time — deliberately ~5× slower than
 * the starvation decay (fish crash fast, heal slow).
 */
export const HEALTH_RECOVERY_PER_SEC = 0.0008;

/**
 * Peak ± fraction of the per-tick STRESS magnitude the spawnIndex jitter can
 * add/subtract. Small (10 %) so the modelled decay stays dominant; it only
 * exists to spread an otherwise-identical school's health on the HUD. Pure
 * multiplier on the stress term — never injects health on its own.
 */
export const VITALITY_JITTER_FRACTION = 0.1;

/**
 * Run the VitalitySystem once per sim tick. Slotted AFTER `feedingSystem` so
 * `FeedingDrive.hunger` is current. Mode-agnostic — every fish with a
 * registered behaviour (and therefore `HealthDrive`) is processed.
 */
export function vitalitySystem(world: LivestockWorld, dt: number): void {
  const ecs = world.ecs;
  const ammonia = world.waterQuality.ammonia;
  const nitrite = world.waterQuality.nitrite;

  // Water-quality stress is shared across every fish — compute it once.
  const ammoniaExcess = ammonia > WATER_SAFE_AMMONIA_MG_L ? ammonia - WATER_SAFE_AMMONIA_MG_L : 0;
  const nitriteExcess = nitrite > WATER_SAFE_NITRITE_MG_L ? nitrite - WATER_SAFE_NITRITE_MG_L : 0;
  const waterDecayPerSec =
    ammoniaExcess * AMMONIA_HEALTH_DECAY_PER_MG_PER_SEC +
    nitriteExcess * NITRITE_HEALTH_DECAY_PER_MG_PER_SEC;
  const waterClean = ammoniaExcess === 0 && nitriteExcess === 0;

  for (const eid of vitalityQuery(ecs)) {
    const hunger = FeedingDrive.hunger[eid] as number;
    const starving = hunger > STARVE_HUNGER_THRESHOLD;
    const starveDecayPerSec = starving
      ? (hunger - STARVE_HUNGER_THRESHOLD) * STARVE_HEALTH_DECAY_PER_SEC
      : 0;

    // Total per-second stress (both channels add). Apply a small deterministic
    // ± jitter keyed by the STABLE spawnIndex so a uniform school spreads on
    // the HUD. The jitter rides only the stress term — recovery is unjittered.
    let stressPerSec = starveDecayPerSec + waterDecayPerSec;
    if (stressPerSec > 0) {
      const idx = BehaviorParamsRef.spawnIndex[eid] as number;
      const j = (tickPrng(world, VITALITY_KEY, idx) * 2 - 1) * VITALITY_JITTER_FRACTION;
      stressPerSec *= 1 + j;
      if (stressPerSec < 0) stressPerSec = 0;
    }

    let health = HealthDrive.health[eid] as number;
    if (stressPerSec > 0) {
      health -= stressPerSec * dt;
    } else if (!starving && waterClean) {
      // No stress this tick AND both stressors below their floors → recover.
      health += HEALTH_RECOVERY_PER_SEC * dt;
    }

    // Clamp to [0, 1].
    if (health < 0) health = 0;
    else if (health > 1) health = 1;
    HealthDrive.health[eid] = health;
  }
}
