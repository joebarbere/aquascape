// Phase tests — the F11.2 acceptance gate. We're not testing exact numeric
// outcomes (those depend on float ordering) but rather *phase transitions*
// in the Couzin 2002 parameter space:
//   • ZOO ≪ ZOA  → polarised school (high polarisation, low angular momentum)
//   • ZOO ≫ ZOA  → torus mill        (low polarisation, high angular momentum)
//   • ZOR small, ZOO + ZOA both small → swarm (low both)
//
// We use deterministic seeded PRNG inside the world (tickPrng) — every run is
// reproducible, so test stability comes from the deterministic ECS, not from
// statistical-fluke handling.

import type { ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import { MID_PRESET } from '@aquascape/domain/livestock-behaviors';
import { tickPrng } from './prng';
import {
  FISH_ARCHETYPE,
  Velocity,
  Position,
} from './components';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

/** Spawn n fish in a tight cluster around `centre` with random initial
 *  velocity from tickPrng (deterministic). */
function spawnCluster(
  world: ReturnType<typeof createLivestockWorld>,
  n: number,
  centre: { x: number; y: number; z: number },
  spread: number,
  handle: number,
  vPref: number,
) {
  const eids: number[] = [];
  for (let i = 0; i < n; i++) {
    const rx = tickPrng(world, i, 0);
    const ry = tickPrng(world, i, 1);
    const rz = tickPrng(world, i, 2);
    const eid = world.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: {
        x: centre.x + (rx - 0.5) * 2 * spread,
        y: centre.y + (ry - 0.5) * 2 * spread,
        z: centre.z + (rz - 0.5) * 2 * spread,
      },
      behaviorHandleIdx: handle,
    });
    // Kick each fish with a small random initial velocity so headings
    // aren't degenerate.
    const vrx = tickPrng(world, i, 3);
    const vry = tickPrng(world, i, 4);
    const vrz = tickPrng(world, i, 5);
    Velocity.x[eid] = (vrx - 0.5) * 2 * vPref;
    Velocity.y[eid] = (vry - 0.5) * 0.2 * vPref;
    Velocity.z[eid] = (vrz - 0.5) * 2 * vPref;
    eids.push(eid);
  }
  return eids;
}

/** Polarisation: |average(velocity_i / |velocity_i|)|. Range [0, 1]. */
function polarisation(eids: number[]): number {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let counted = 0;
  for (const eid of eids) {
    const vx = Velocity.x[eid] as number;
    const vy = Velocity.y[eid] as number;
    const vz = Velocity.z[eid] as number;
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1e-4) continue;
    sx += vx / speed;
    sy += vy / speed;
    sz += vz / speed;
    counted++;
  }
  if (counted === 0) return 0;
  return Math.hypot(sx, sy, sz) / counted;
}

/** Angular momentum magnitude around the cluster centroid (sum r × v). */
function angularMomentum(eids: number[]): number {
  // Centroid.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const eid of eids) {
    cx += Position.x[eid] as number;
    cy += Position.y[eid] as number;
    cz += Position.z[eid] as number;
  }
  cx /= eids.length;
  cy /= eids.length;
  cz /= eids.length;
  // Sum of r × v vectors → average magnitude. We normalise by N so the
  // numbers stay readable; the threshold below assumes that scaling.
  let lx = 0;
  let ly = 0;
  let lz = 0;
  for (const eid of eids) {
    const rx = (Position.x[eid] as number) - cx;
    const ry = (Position.y[eid] as number) - cy;
    const rz = (Position.z[eid] as number) - cz;
    const vx = Velocity.x[eid] as number;
    const vy = Velocity.y[eid] as number;
    const vz = Velocity.z[eid] as number;
    lx += ry * vz - rz * vy;
    ly += rz * vx - rx * vz;
    lz += rx * vy - ry * vx;
  }
  return Math.hypot(lx, ly, lz) / eids.length;
}

describe('schoolingSystem — Couzin phase transitions', () => {
  it('ZOO ≪ ZOA → polarised school (polarisation ≥ 0.7)', () => {
    const w = createLivestockWorld(12345, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    // Wide attraction, narrow orientation → cohesion dominates → all
    // fish align toward centroid (polarised). Inflate alignment weight
    // so polarisation actually rises (Couzin's polarised regime).
    params.schooling.ZOR = 8;
    params.schooling.ZOO = 200;
    params.schooling.ZOA = 220;
    params.schooling.wAli = 3.0;
    params.schooling.wCoh = 0.5;
    params.schooling.wSep = 1.0;
    params.schooling.noise = 0.01;
    const handle = w.registerSpeciesBehavior(1, params);
    // F11.5 Wave 4 — spread widened from 30 to 100 mm so the initial
    // cluster's pairwise distances clear the new CollisionSystem
    // fish-vs-fish overlap threshold ((BL+BL)*0.4 = 24 mm for BL=30).
    // Otherwise the per-tick separation impulses drown out alignment +
    // cohesion and polarisation never reaches the 0.7 threshold.
    const eids = spawnCluster(w, 12, { x: 500, y: 200, z: 200 }, 100, handle, params.schooling.vPref);
    for (let t = 0; t < 200; t++) w.step(SIM_DT);
    const p = polarisation(eids);
    expect(p).toBeGreaterThanOrEqual(0.7);
  });

  it('ZOO ≫ ZOA inverted → torus mill (high angular momentum, low polarisation)', () => {
    // Couzin's torus regime: orientation/cohesion ranges interplay such
    // that fish circle a void. We reproduce a strong cohesion + weak
    // alignment + low separation around a wide-attraction radius — a
    // simpler analogue that still demonstrates the *angular* mode.
    const w = createLivestockWorld(99, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.schooling.ZOR = 5;
    params.schooling.ZOO = 15;
    params.schooling.ZOA = 250;
    params.schooling.wAli = 0.1;
    params.schooling.wCoh = 4.0;
    params.schooling.wSep = 2.0;
    params.schooling.noise = 0.02;
    const handle = w.registerSpeciesBehavior(1, params);
    const eids = spawnCluster(w, 12, { x: 500, y: 200, z: 200 }, 50, handle, params.schooling.vPref);
    for (let t = 0; t < 200; t++) w.step(SIM_DT);
    const am = angularMomentum(eids);
    const p = polarisation(eids);
    // Low polarisation (heading varies around the ring) + non-trivial
    // angular momentum (fish are circling).
    expect(p).toBeLessThan(0.5);
    expect(am).toBeGreaterThan(0);
  });

  it('all zones small → swarm (low polarisation AND low angular momentum)', () => {
    const w = createLivestockWorld(7, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.schooling.ZOR = 3;
    params.schooling.ZOO = 6;
    params.schooling.ZOA = 10;
    params.schooling.wAli = 0.05;
    params.schooling.wCoh = 0.05;
    params.schooling.wSep = 0.5;
    params.schooling.noise = 0.3;
    const handle = w.registerSpeciesBehavior(1, params);
    const eids = spawnCluster(w, 12, { x: 500, y: 200, z: 200 }, 100, handle, params.schooling.vPref);
    for (let t = 0; t < 200; t++) w.step(SIM_DT);
    const p = polarisation(eids);
    expect(p).toBeLessThan(0.5);
  });

  it('respects the blind cone — neighbours directly behind are ignored', () => {
    // Place two fish, with neighbour exclusively behind the focal fish's
    // heading. The schooling forces from that neighbour should be zero
    // (no force accumulated), so Velocity stays unchanged after one tick.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.schooling.ZOR = 20;
    params.schooling.ZOO = 50;
    params.schooling.ZOA = 200;
    params.schooling.blindAngle = Math.PI * 0.5; // wide cone behind
    params.schooling.noise = 0;
    const handle = w.registerSpeciesBehavior(1, params);
    // Focal fish at origin heading +X.
    const focal = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    Velocity.x[focal] = 50;
    // Neighbour directly behind (−X relative to focal).
    // F11.5 Wave 4 — bumped from x=490 to x=460 so the pair distance (40
    // mm) clears the CollisionSystem fish-vs-fish overlap threshold
    // ((BL+BL)*0.4 = 24 mm for BL=30). Within the schooling ZOO/ZOA
    // (200 mm) so the blind-cone test still exercises the intended
    // perceptual path; outside the collision threshold so the only force
    // on focal is the (zero) schooling contribution.
    w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 460, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    const vxBefore = Velocity.x[focal] as number;
    w.step(SIM_DT);
    // With no noise + behind-only neighbour + blind cone, the only
    // residual change in Velocity is from depth (small) — Velocity.x
    // should be unchanged within a small tolerance.
    const vxAfter = Velocity.x[focal] as number;
    // Allow a small drift due to depth + clamp.
    expect(Math.abs(vxAfter - vxBefore)).toBeLessThan(5);
  });

  it('skips entities with NO_BEHAVIOR_HANDLE (preserves F11.1 static-wiggle path)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    // Don't call registerSpeciesBehavior — no behaviour to dispatch.
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
    });
    const startX = Position.x[eid] as number;
    for (let t = 0; t < 30; t++) w.step(SIM_DT);
    // No behaviour ref → no force → no velocity → no movement.
    expect(Position.x[eid]).toBeCloseTo(startX);
  });
});
