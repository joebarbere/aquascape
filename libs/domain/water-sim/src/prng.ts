/**
 * Deterministic seeded PRNG + hashing, shared with the `domain/growth-sim`
 * pattern (same Wang-style mix + Mulberry32 generator). Kept in `water-sim`
 * rather than imported so the two libs can evolve their seeding independently;
 * the algorithms are identical so cross-lib reasoning stays simple.
 *
 * All integer ops so results are byte-identical across JS engines / platforms.
 */

/**
 * 32-bit integer mix (Wang hash style). Splits one `(seed, salt)` pair into a
 * deterministic, well-distributed 32-bit unsigned value usable as a PRNG seed.
 */
export function hashSeed(seed: number, salt: number): number {
  let h = (seed | 0) ^ Math.imul(salt | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** Mulberry32: 32-bit PRNG returning [0, 1). Tiny + deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One deterministic sample in [-1, 1] for a `(seed, channel, step)` triple.
 *
 * This is the single jitter primitive the chemistry model uses: the colony
 * lag, the daily-noise on the source term, and the algae jitter all derive
 * their wobble from a stable sub-seed of the document `seed` so the same
 * `(state, inputs, seed)` always evolves identically.
 *
 * `channel` is a stable per-purpose salt (see CHANNEL.* in chemistry.ts);
 * `step` is the integer simulation step index so successive steps differ.
 */
export function signedJitter(seed: number, channel: number, step: number): number {
  const sub = hashSeed(hashSeed(seed, channel), step | 0);
  return mulberry32(sub)() * 2 - 1;
}
