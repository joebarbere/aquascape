/**
 * FearSystem (Stage 11 F11.3).
 *
 * Lima & Dill (1990) risk-allocation: every fish carries an integrated
 * `risk` scalar. The baseline anxiety from `FearParams.riskBaseline` is
 * added each tick; injected startles (predator visibility, neighbour
 * propagation, sudden light change) accumulate into the same scalar; and
 * `risk` decays exponentially between ticks so old impulses don't echo
 * forever (half-life ≈ 1.4 s at `decayRate = 0.5`).
 *
 * Once `risk > FearParams.threshold` the BehaviorMode flips from FORAGE
 * to REFUGE. The system picks the nearest registered hardscape with
 * `coverScore > 0` whose category matches the species `coverPreference`
 * (or any cover if preference is `'any'` / nothing matches), stores the
 * eid in `FearState.refugeEid`, and writes a force toward that hardscape.
 *
 * Priority arbitration is enforced here by an *early return*: once we
 * write the refuge force, subsequent systems (Nip, Territory, Schooling)
 * see `BehaviorMode === REFUGE` and skip their main effect via their own
 * mode-guards. DepthSystem still runs (it's pure physics — even fleeing
 * fish respect depth bands).
 *
 * Emergence delay: while `risk > threshold`, the timer is held at
 * `params.emergenceDelay`. Once risk drops below threshold, the timer
 * counts down; when it reaches 0 the fish flips back to FORAGE and
 * `refugeEid` resets to 0.
 */
import { defineQuery } from 'bitecs';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  FearState,
  Force,
  Hardscape,
  NO_ENTITY_REF,
  Position,
} from './components';
import type { LivestockWorld } from './world';

const fearQuery = defineQuery([Position, BehaviorParamsRef, FearState, BehaviorMode, Force]);
const hardscapeQuery = defineQuery([Hardscape, Position]);

/**
 * Per-second risk decay rate. Half-life = ln(2) / 0.5 ≈ 1.39 s. Tuned so a
 * one-off startle dissipates over a couple of seconds but a sustained
 * source (high baseline, repeated startles) holds the fish in REFUGE.
 */
const RISK_DECAY_RATE = 0.5;

/**
 * Force magnitude scalar applied to the refuge-attraction direction. The
 * unit-direction is multiplied by this to produce a per-tick force.
 * Picked to be on the same order of magnitude as schooling /
 * depth-restore forces so the steering integrator clamps it sensibly.
 */
const REFUGE_FORCE_MAGNITUDE = 250;

/**
 * Map a species `coverPreference` enum to a hardscape category id.
 * Returns -1 for `'any'` (no category filter). The mapping mirrors
 * `HARDSCAPE_CATEGORY` in `components.ts`: WOOD=0, ROCK=1, PLANT=2.
 * 'caves' maps to ROCK — caves are stone formations in the catalog's
 * current category set; F11.3+ may add a dedicated `cave` category if
 * needed.
 */
function preferredCategory(pref: 'plants' | 'caves' | 'wood' | 'any'): number {
  if (pref === 'plants') return 2;
  if (pref === 'caves') return 1;
  if (pref === 'wood') return 0;
  return -1;
}

export function fearSystem(world: LivestockWorld, dt: number): void {
  const store = world.paramStore;
  const startles = world.__internals.pendingStartles;
  const ecs = world.ecs;

  // Pre-compute the decay factor once per tick — `Math.exp` is cheap
  // but hoisting it out of the inner loop costs nothing.
  const decayFactor = Math.exp(-RISK_DECAY_RATE * dt);

  // bitECS query iteration walks entities in eid order — stable across
  // ticks within one world. We snapshot the hardscape list once per tick;
  // it doesn't change mid-tick.
  const hardscapeEids = hardscapeQuery(ecs);

  for (const eid of fearQuery(ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    // Defensive guard — fear params are required, but a fish with
    // NO_BEHAVIOR_HANDLE (F11.1 static-wiggle path) has no resolved
    // behaviour at all. Skip so we don't touch its mode or force.
    if (behavior === null) continue;
    const params = behavior.fear;

    // 1. Decay prior risk + add this tick's baseline contribution + any
    //    pending startle impulse. The startle map is drained on read so
    //    a single impulse only counts once.
    let risk = (FearState.risk[eid] as number) * decayFactor + params.riskBaseline * dt;
    const startle = startles.get(eid);
    if (startle !== undefined && startle > 0) {
      risk += startle;
      startles.delete(eid);
    }
    FearState.risk[eid] = risk;

    const mode = BehaviorMode.mode[eid] as number;

    // 2. Mode flip — FORAGE → REFUGE when risk crosses threshold.
    if (risk > params.threshold && mode === BEHAVIOR_MODE.FORAGE) {
      BehaviorMode.mode[eid] = BEHAVIOR_MODE.REFUGE;
      FearState.emergenceTimer[eid] = params.emergenceDelay;
      // Pick the nearest matching refuge. We make two passes: first
      // honouring `coverPreference`, then (if nothing matched) falling
      // back to nearest cover regardless of category. Spec calls for the
      // fallback so a fish in a tank without its preferred cover still
      // hides somewhere instead of standing still.
      const preferred = preferredCategory(params.coverPreference);
      const sx = Position.x[eid] as number;
      const sy = Position.y[eid] as number;
      const sz = Position.z[eid] as number;
      FearState.refugeEid[eid] = pickRefuge(hardscapeEids, sx, sy, sz, preferred);
    }

    // 3. Emergence — while risk is above threshold, hold the timer;
    //    once it drops below, count down to FORAGE.
    if (BehaviorMode.mode[eid] === BEHAVIOR_MODE.REFUGE) {
      if (risk > params.threshold) {
        FearState.emergenceTimer[eid] = params.emergenceDelay;
      } else {
        const remaining = (FearState.emergenceTimer[eid] as number) - dt;
        if (remaining <= 0) {
          BehaviorMode.mode[eid] = BEHAVIOR_MODE.FORAGE;
          FearState.emergenceTimer[eid] = 0;
          FearState.refugeEid[eid] = NO_ENTITY_REF;
        } else {
          FearState.emergenceTimer[eid] = remaining;
        }
      }
    }

    // 4. If we're still in REFUGE, write the refuge-attraction force.
    //    This *overrides* any prior force contributions — schooling /
    //    nipping / territory all skip REFUGE-mode entities downstream,
    //    so we don't need to clear Force here; the integrator drains it
    //    cleanly at the end of the tick.
    if (BehaviorMode.mode[eid] === BEHAVIOR_MODE.REFUGE) {
      const refugeEid = FearState.refugeEid[eid] as number;
      if (refugeEid !== NO_ENTITY_REF) {
        const sx = Position.x[eid] as number;
        const sy = Position.y[eid] as number;
        const sz = Position.z[eid] as number;
        const tx = (Position.x[refugeEid] as number) - sx;
        const ty = (Position.y[refugeEid] as number) - sy;
        const tz = (Position.z[refugeEid] as number) - sz;
        const len = Math.hypot(tx, ty, tz);
        if (len > 1e-4) {
          const k = REFUGE_FORCE_MAGNITUDE / len;
          Force.x[eid] = (Force.x[eid] as number) + tx * k;
          Force.y[eid] = (Force.y[eid] as number) + ty * k;
          Force.z[eid] = (Force.z[eid] as number) + tz * k;
        }
      }
    }
  }

  // Drop any startle impulses targeting entities that were despawned
  // or never received a FearState component (defensive cleanup so the
  // map can't grow unbounded if a test injects to a non-fear entity).
  // The fear loop above already deletes startles it consumes; this
  // cleanup catches the orphan case.
  if (startles.size > 0) {
    for (const key of startles.keys()) {
      // FearState typed-array slabs return 0 for indices that were
      // never assigned, so we can't trivially distinguish "received
      // impulse but never spawned" vs. "live entity with zero risk".
      // Conservative: just drop everything that survived this tick —
      // the contract is "queue is per-tick", so leftovers shouldn't
      // persist into the next step.
      startles.delete(key);
    }
  }
}

/**
 * Pick the nearest hardscape entity to `(sx, sy, sz)` that matches the
 * given category (or any cover if `preferredCat < 0`). Two-pass: first
 * try preference + `coverScore > 0`, then fall back to any cover with
 * `coverScore > 0`. Returns `NO_ENTITY_REF` when no cover exists.
 *
 * Reads `Hardscape.coverScore` / `Hardscape.category` directly off the
 * SoA slabs — eid 0 is a legitimate hardscape entity in bitECS, so we
 * can't use 0 as a sentinel anywhere in the refuge / anchor pipeline.
 */
function pickRefuge(
  hardscapeEids: ArrayLike<number> & Iterable<number>,
  sx: number,
  sy: number,
  sz: number,
  preferredCat: number,
): number {
  let bestEid = NO_ENTITY_REF;
  let bestDistSq = Infinity;
  for (const eid of hardscapeEids) {
    if ((Hardscape.coverScore[eid] as number) <= 0) continue;
    if (preferredCat >= 0 && (Hardscape.category[eid] as number) !== preferredCat) continue;
    const dx = (Position.x[eid] as number) - sx;
    const dy = (Position.y[eid] as number) - sy;
    const dz = (Position.z[eid] as number) - sz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestEid = eid;
    }
  }
  if (bestEid !== NO_ENTITY_REF) return bestEid;
  // Fallback — preference failed, accept any cover.
  if (preferredCat < 0) return NO_ENTITY_REF;
  for (const eid of hardscapeEids) {
    if ((Hardscape.coverScore[eid] as number) <= 0) continue;
    const dx = (Position.x[eid] as number) - sx;
    const dy = (Position.y[eid] as number) - sy;
    const dz = (Position.z[eid] as number) - sz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestEid = eid;
    }
  }
  return bestEid;
}
