/**
 * Bubble particle spawn + lifetime systems (Stage 11 F11.5 Wave 5).
 *
 * Particle-only simplification of the plan's `BubbleStableFluids2D` advect/
 * diffuse/project model — bubbles spawn at the air-stone position with a
 * small deterministic horizontal jitter (via `tickPrng`), rise at a fixed
 * +Y velocity, and despawn at the waterline (or when their per-particle
 * lifetime expires, whichever fires first). The `BubbleStableFluids2D` lib
 * code in `domain/fluid-sim` stays available for a later fidelity pass.
 *
 * Slot order in `world.step()` (per `docs/caveats/livestock-ecs.md`):
 *
 *     … → AnimationSystem → FoodSpriteLifetimeSystem
 *       → bubbleSourceSpawnSystem → bubbleLifetimeSystem
 *
 * Spawning runs **before** lifetime so a freshly spawned bubble doesn't
 * eat a tick of altitude before the renderer ever sees it; lifetime runs
 * immediately after so an already-rising bubble that crosses the waterline
 * this tick is gone before `snapshot()` runs.
 *
 * DETERMINISM
 * -----------
 * Every random draw (spawn jitter X/Z, optional future per-bubble noise)
 * routes through `tickPrng(world, BUBBLE_KEY, sourceIdx, axis, spawnSeq)`.
 * No `Math.random()`. No `Date.now()`. Two worlds with the same seed +
 * the same `registerBubbleSources` call sequence produce byte-identical
 * bubble position arrays at every tick.
 *
 * NO ALLOCATION PER TICK
 * ----------------------
 * The spawn/despawn loops mutate the bubble entity slabs directly via
 * bitECS' `addEntity` / `removeEntity` (which reuse a per-world free-id
 * pool). The per-source `spawnAccumulator` typed array is allocated once
 * in `registerBubbleSources` and rewritten in place.
 *
 * GLOBAL CAP
 * ----------
 * The total bubble population is capped at `BUBBLE_GLOBAL_CAP_COUNT`
 * (200). When over the cap, `bubbleSourceSpawnSystem` drains the spawn
 * debt without creating an entity — keeps the renderer at a bounded
 * billboard count regardless of how absurd the `airRateMl` is.
 */
import { addComponent, addEntity, defineQuery, removeEntity } from 'bitecs';

import {
  BUBBLE_FLUID_DRIFT_MM_PER_S,
  BUBBLE_FLUID_Z_FRACTION,
  sampleBubbleFluid,
} from './bubble-fluid';
import { BubbleParticle, Position } from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

/**
 * Fold of the literal string `'bubble-source'` (FNV-1a). Used as the
 * first key into `tickPrng` so the bubble stream sits well clear of the
 * per-entity small-integer keys other systems use.
 */
const BUBBLE_KEY = (() => {
  let h = 0x811c9dc5;
  const s = 'bubble-source';
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return h | 0;
})();

/** Default rise speed (mm/sec). Gentle column — slow enough to read on screen. */
export const BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S = 150;

/** Default lifetime cap (s). A 400 mm tank at 150 mm/s rises in ~2.7 s — give a few seconds of headroom. */
export const BUBBLE_DEFAULT_LIFETIME_SEC = 6;

/** Inset below `tankAabb.maxY` that counts as "popped at the surface" (mm). */
export const BUBBLE_WATERLINE_INSET_MM = 10;

/** Horizontal jitter envelope (mm). Bubbles drift ± this amount on X+Z at spawn. */
export const BUBBLE_HORIZONTAL_JITTER_MM = 8;

/**
 * Helical wobble — the FALLBACK lateral drift, used only when no fluid slice
 * is available for a bubble's source (e.g. unit tests that call
 * `bubbleLifetimeSystem` directly without ever registering sources through
 * the world, which builds the slices). A rising air-stone bubble doesn't track
 * a straight line — it spirals as it sheds vortices. The helix models that with
 * a deterministic drift driven by the bubble's HEIGHT (not wall-clock):
 * `x/z += A·{sin,cos}(k·y + phase)·dt`, phase per-bubble from `spawnSeq`.
 * Height-driven keeps it pure + replay-stable (no time accumulator).
 *
 * The "bubble fluid fidelity pass" promoted the previously-unwired Stam
 * `BubbleStableFluids2D` slice (`domain/fluid-sim`) to the PRIMARY drift: each
 * registered source gets a per-source slice (`bubble-fluid.ts`) whose advected
 * velocity field carries real asymmetric vortices + cross-plume interaction.
 * When that field is live (the normal `world.step()` path), the helix is
 * bypassed; the constants below remain as the slice-less fallback.
 */
export const BUBBLE_WOBBLE_VEL_MM_PER_S = 28;
export const BUBBLE_WOBBLE_WAVENUMBER = 0.045;
/** Golden-ratio-ish phase stride so adjacent spawnSeqs don't wobble in lockstep. */
const BUBBLE_WOBBLE_PHASE_STRIDE = 2.399963;

/**
 * Reusable scratch for the per-bubble fluid sample. Module-scoped + mutated in
 * place so `bubbleLifetimeSystem` does zero allocation per bubble per tick
 * (the F11.6 perf budget forbids hot-path allocation). The system is never
 * re-entrant (single-threaded sim tick), so a shared scratch is safe.
 */
const fluidSampleScratch = { u: 0, v: 0 };

/**
 * Vertical modulation cap. The slice's vertical velocity nudges a bubble's
 * rise so plumes accelerate/stall realistically, but we clamp the effect so a
 * bubble can never stall completely or rocket — net motion stays clearly
 * upward. Fraction of `velocityY` the fluid may add/subtract.
 */
const BUBBLE_FLUID_RISE_MOD_FRACTION = 0.35;

/**
 * Conversion factor from `airRateMl` (mL/min) to spawn rate (particles/sec).
 *
 * Calibrated so an 800 mL/min air stone (`equipment.filter.aquaneat-triple-sponge`)
 * spawns ~`800/60 * BUBBLE_SCALE` ≈ 40 bubbles/sec (with `BUBBLE_SCALE = 3`),
 * which at the default 6 s lifetime + global cap of 200 settles into a
 * steady-state column of ~120 visible bubbles. Picking the constant here
 * (not on the catalog row) keeps the catalog row a pure data descriptor
 * — the visual scaling is a renderer/sim policy, not a manufacturer spec.
 */
export const BUBBLE_SCALE = 3;

/** Hard ceiling on the total bubble population across all sources. */
export const BUBBLE_GLOBAL_CAP_COUNT = 200;

const bubbleQuery = defineQuery([BubbleParticle, Position]);

/**
 * Spawn-rate accumulator system. Walks every registered bubble source,
 * adds its per-tick spawn debt to the source's running `spawnAccumulator`,
 * and emits one BubbleParticle entity per integer unit of accumulated debt
 * (clamped by the global cap).
 *
 * Spawn position = source position + small X/Z jitter via `tickPrng`. The
 * jitter is keyed by `(sourceIdx, spawnSequence)` so two bubbles from the
 * same source on the same tick land at different offsets.
 */
export function bubbleSourceSpawnSystem(world: LivestockWorld, dt: number): void {
  const sources = world.__bubbleSources;
  if (sources.count === 0) return;

  const ecs = world.ecs;
  // Live-bubble count gates the cap check. We compute it once per tick
  // (not once per source) — bitECS' query result is a flat array; len is
  // O(1) after the per-tick query rebuild.
  let liveCount = bubbleQuery(ecs).length;

  for (let s = 0; s < sources.count; s++) {
    const rate = sources.rateParticlesPerSec[s] as number;
    if (rate <= 0) continue;
    // Accumulate this source's spawn debt.
    let debt = (sources.spawnAccumulator[s] as number) + rate * dt;
    while (debt >= 1) {
      debt -= 1;
      if (liveCount >= BUBBLE_GLOBAL_CAP_COUNT) {
        // Over cap — drain the rest of the debt for this source so we
        // don't accumulate an unbounded backlog (otherwise the moment
        // we drop below the cap, every source dumps its history in one
        // tick).
        debt = 0;
        break;
      }
      const seq = sources.spawnSequence[s] as number;
      sources.spawnSequence[s] = (seq + 1) >>> 0;

      // Two horizontal-jitter draws — axis 0 = X, axis 2 = Z. Result is
      // a uniform [0, 1) value that we re-centre to [-1, 1) and scale.
      const rx = tickPrng(world, BUBBLE_KEY, s, 0, seq);
      const rz = tickPrng(world, BUBBLE_KEY, s, 2, seq);
      const jitterX = (rx * 2 - 1) * BUBBLE_HORIZONTAL_JITTER_MM;
      const jitterZ = (rz * 2 - 1) * BUBBLE_HORIZONTAL_JITTER_MM;

      const px = (sources.posX[s] as number) + jitterX;
      const py = sources.posY[s] as number;
      const pz = (sources.posZ[s] as number) + jitterZ;

      const eid = addEntity(ecs);
      addComponent(ecs, Position, eid);
      Position.x[eid] = px;
      Position.y[eid] = py;
      Position.z[eid] = pz;
      addComponent(ecs, BubbleParticle, eid);
      BubbleParticle.velocityY[eid] = BUBBLE_DEFAULT_VELOCITY_Y_MM_PER_S;
      BubbleParticle.lifetimeSec[eid] = BUBBLE_DEFAULT_LIFETIME_SEC;
      // sourceEid is the source index — not a bitECS entity id. We re-use
      // the slab name from the spec for callers' test convenience.
      BubbleParticle.sourceEid[eid] = s >>> 0;
      // spawnSeq pairs with sourceEid as the snapshot's cross-world stable
      // sort key — see the BubbleParticle JSDoc + snapshot() in world.ts.
      BubbleParticle.spawnSeq[eid] = seq >>> 0;
      liveCount += 1;
    }
    sources.spawnAccumulator[s] = debt;
  }
}

/**
 * Per-tick integrator for live BubbleParticle entities. Advances each
 * bubble's `Position.y` by `velocityY * dt`, decrements `lifetimeSec`,
 * and despawns the entity if either the waterline OR the lifetime cap
 * triggers.
 *
 * The waterline check uses `tankAabb.maxY - BUBBLE_WATERLINE_INSET_MM`
 * so bubbles "pop" a few mm below the surface — visually nicer than
 * clipping the waterline plane, and gives the renderer room to fade the
 * billboard out at the surface without a per-frame distance test.
 */
export function bubbleLifetimeSystem(world: LivestockWorld, dt: number): void {
  const ecs = world.ecs;
  const waterY = world.tankAabb.maxY - BUBBLE_WATERLINE_INSET_MM;
  // Whether the fluid coupling is live. When the world built slices (the
  // normal world.step() path), bubbles advect on the real velocity field;
  // when a test drives this system directly without registered sources the
  // slice set is empty and bubbles fall back to the height-driven helix.
  const fluidActive = world.__bubbleFluid.slices.length > 0;
  for (const eid of bubbleQuery(ecs)) {
    const px = Position.x[eid] as number;
    const py = Position.y[eid] as number;
    const pz = Position.z[eid] as number;
    const vy = BubbleParticle.velocityY[eid] as number;

    // Vertical rise. With the fluid active, the slice's vertical velocity at
    // the bubble's position lightly modulates the buoyant rise (clamped so it
    // can't stall or rocket). Without it, the rise is the fixed buoyancy.
    let riseY = vy;
    if (fluidActive) {
      sampleBubbleFluid(world, px, py, fluidSampleScratch);
      const mod = fluidSampleScratch.v * BUBBLE_FLUID_DRIFT_MM_PER_S;
      const cap = vy * BUBBLE_FLUID_RISE_MOD_FRACTION;
      riseY = vy + (mod < -cap ? -cap : mod > cap ? cap : mod);
    }
    const nextY = py + riseY * dt;
    const nextLife = (BubbleParticle.lifetimeSec[eid] as number) - dt;
    if (nextY > waterY || nextLife <= 0) {
      removeEntity(ecs, eid);
      continue;
    }
    Position.y[eid] = nextY;
    BubbleParticle.lifetimeSec[eid] = nextLife;

    if (fluidActive) {
      // Lateral advection by the summed slice field. The slice resolves the
      // X (lateral) component directly; Z gets a phase-shifted fraction of the
      // same magnitude so a 2D slice still reads as a 3D, non-planar plume.
      // `fluidSampleScratch.u` was filled by the rise sample above (same
      // position) — reuse it, no second solve.
      const driftX = fluidSampleScratch.u * BUBBLE_FLUID_DRIFT_MM_PER_S;
      const phase = (BubbleParticle.spawnSeq[eid] as number) * BUBBLE_WOBBLE_PHASE_STRIDE;
      Position.x[eid] = px + driftX * dt;
      Position.z[eid] =
        pz + driftX * BUBBLE_FLUID_Z_FRACTION * Math.cos(phase) * dt;
    } else {
      // Fallback helix — deterministic spiral drift driven by height. Phase
      // is per-bubble from spawnSeq; X uses sin, Z uses cos so the path is a
      // circular helix rather than a planar zig-zag.
      const phase = (BubbleParticle.spawnSeq[eid] as number) * BUBBLE_WOBBLE_PHASE_STRIDE;
      const angle = BUBBLE_WOBBLE_WAVENUMBER * nextY + phase;
      Position.x[eid] = px + BUBBLE_WOBBLE_VEL_MM_PER_S * Math.sin(angle) * dt;
      Position.z[eid] = pz + BUBBLE_WOBBLE_VEL_MM_PER_S * Math.cos(angle) * dt;
    }
  }
}
