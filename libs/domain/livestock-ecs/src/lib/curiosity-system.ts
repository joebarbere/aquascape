/**
 * CuriositySystem (Stage 11 F11.4).
 *
 * Réale et al. 2007 boldness axis — bold fish (gouramis, danios) drift
 * over to the front pane and "investigate" the viewer; shy fish (kuhli
 * loaches, shrimp) almost never trigger.
 *
 * Per tick, for each fish carrying `Curiosity` (every fish — the
 * component is attached on spawn whenever a behaviour handle is
 * registered):
 *
 *   1. Skip if BehaviorMode !== FORAGE. (REFUGE / PURSUE wins.)
 *   2. If `dwellRemaining > 0`: a previous trigger is active. Write a
 *      weak Force toward `(interestX, interestY, interestZ)`. Decrement
 *      `dwellRemaining` by dt. When it hits 0, clear the interest point
 *      via the `NO_INTEREST` sentinel.
 *   3. Else: Poisson trigger. Draw `tickPrng(world, 'curiosity', spawnIndex)`;
 *      if `< boldness * ratePerSec * dt`, the trigger fires: set the
 *      interest point to the front pane (z = tankAabb.minZ + 5mm) at the
 *      fish's current Y + a small deterministic X jitter (so multiple
 *      bold fish don't all converge on the same x coord); set
 *      `dwellRemaining = dwellSec`.
 *
 * Boldness directly gates the trigger probability — shy species (boldness
 * ≈ 0.05) trigger about 1/10th as often as bold species (boldness ≈ 0.7)
 * given the same `ratePerSec`. The PRNG key uses `spawnIndex` (stable
 * across cold worlds, per the determinism contract) rather than the raw
 * bitECS eid.
 */
import { defineQuery } from 'bitecs';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  Curiosity,
  Force,
  NO_INTEREST,
  Position,
} from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

const curiosityQuery = defineQuery([
  Position,
  BehaviorParamsRef,
  Curiosity,
  BehaviorMode,
  Force,
]);

/** Magnitude (per unit direction) of the curiosity attraction force. */
const CURIOSITY_FORCE_MAGNITUDE = 80;

/** Front pane offset — how far inside the glass the interest point sits. */
const FRONT_PANE_OFFSET_MM = 5;

/**
 * Deterministic per-eid X jitter range when triggering a glass interest
 * point — fish at the same Y don't all converge on the exact same X.
 */
const TRIGGER_X_JITTER_MM = 120;

/**
 * Tag (numeric) for the curiosity Poisson stream. Distinct from any
 * other tickPrng key so streams don't alias across systems.
 */
const PRNG_KEY_CURIOSITY = 0xC0; // "C0" for Curiosity stream

export function curiositySystem(world: LivestockWorld, dt: number): void {
  const store = world.paramStore;
  const ecs = world.ecs;
  const aabb = world.tankAabb;

  for (const eid of curiosityQuery(ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null) continue;
    const params = behavior.curiosity;

    // Mode gate — REFUGE / PURSUE wins.
    if ((BehaviorMode.mode[eid] as number) !== BEHAVIOR_MODE.FORAGE) continue;

    const dwell = Curiosity.dwellRemaining[eid] as number;
    if (dwell > 0) {
      // Active interest — steer toward the point. Use the existing
      // interest coords as written at trigger time.
      const ix = Curiosity.interestX[eid] as number;
      const iy = Curiosity.interestY[eid] as number;
      const iz = Curiosity.interestZ[eid] as number;
      const sx = Position.x[eid] as number;
      const sy = Position.y[eid] as number;
      const sz = Position.z[eid] as number;
      const tx = ix - sx;
      const ty = iy - sy;
      const tz = iz - sz;
      const len = Math.hypot(tx, ty, tz);
      if (len > 1e-4) {
        const k = CURIOSITY_FORCE_MAGNITUDE / len;
        Force.x[eid] = (Force.x[eid] as number) + tx * k;
        Force.y[eid] = (Force.y[eid] as number) + ty * k;
        Force.z[eid] = (Force.z[eid] as number) + tz * k;
      }
      const next = dwell - dt;
      if (next <= 0) {
        Curiosity.dwellRemaining[eid] = 0;
        Curiosity.interestX[eid] = NO_INTEREST;
        Curiosity.interestY[eid] = NO_INTEREST;
        Curiosity.interestZ[eid] = NO_INTEREST;
      } else {
        Curiosity.dwellRemaining[eid] = next;
      }
      continue;
    }

    // Inactive — Poisson trigger. The probability per tick is
    // `boldness * ratePerSec * dt`. Use spawnIndex (stable across cold
    // worlds) as the per-entity tickPrng key.
    const spawnIdx = BehaviorParamsRef.spawnIndex[eid] as number;
    const prob = params.boldness * params.ratePerSec * dt;
    const draw = tickPrng(world, PRNG_KEY_CURIOSITY, spawnIdx);
    if (draw < prob) {
      // Trigger — arm the interest point at the front pane glass.
      // Jitter X deterministically from a second draw so multiple bold
      // fish at the same Y don't collide on the same point.
      const xJitterDraw = tickPrng(world, PRNG_KEY_CURIOSITY, spawnIdx, 1);
      const xJitter = (xJitterDraw - 0.5) * 2 * TRIGGER_X_JITTER_MM;
      const sx = Position.x[eid] as number;
      const sy = Position.y[eid] as number;
      const targetX = sx + xJitter;
      const clampedX =
        targetX < aabb.minX ? aabb.minX : targetX > aabb.maxX ? aabb.maxX : targetX;
      Curiosity.interestX[eid] = clampedX;
      Curiosity.interestY[eid] = sy;
      Curiosity.interestZ[eid] = aabb.minZ + FRONT_PANE_OFFSET_MM;
      Curiosity.dwellRemaining[eid] = params.dwellSec;
    }
  }
}
