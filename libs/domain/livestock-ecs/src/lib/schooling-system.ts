/**
 * SchoolingSystem (Stage 11 F11.2).
 *
 * Couzin et al. 2002 three-zone model — Zones of Repulsion (ZOR),
 * Orientation (ZOO), Attraction (ZOA) — composed with Reynolds 1987's
 * three weighted steering forces (separation, alignment, cohesion). A
 * deterministic noise term provides the symmetry-breaking the polarised
 * vs. torus-mill vs. swarm phase transition depends on (Camazine 2001).
 *
 * For each entity carrying `BehaviorParamsRef` (resolved species behaviour):
 *
 *   1. Query the SpatialGrid for neighbours within `ZOA`.
 *   2. For each neighbour, compute the offset vector toNeighbour.
 *   3. Reject neighbours inside the fish's blind cone behind it — heading
 *      taken from Velocity (or, if Velocity ≈ 0, the orientation's local
 *      +X axis; carangiform fish point along +X, see livestock-renderer-3d's
 *      shader source).
 *   4. Partition visible neighbours by distance:
 *        d < ZOR        → Reynolds separation (1/d² weighted, away)
 *        ZOR ≤ d < ZOO  → Reynolds alignment   (avg neighbour velocity)
 *        ZOO ≤ d < ZOA  → Reynolds cohesion    (toward centroid)
 *   5. Multiply each accumulator by its `wSep / wAli / wCoh` weight and
 *      add the noise term (xz-plane only — Y is owned by DepthSystem).
 *   6. Sum into the entity's `Force` accumulator. SteeringIntegrator
 *      drains Force into Velocity at the end of the tick.
 *
 * Allocation discipline: every loop runs on `let` numeric scalars, no
 * temporary `{x,y,z}` objects. The query result is a Uint32Array view we
 * iterate through with a for-of (bitECS query reuses the underlying
 * buffer across ticks).
 */
import { defineQuery } from 'bitecs';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  Force,
  Orientation,
  Position,
  Velocity,
} from './components';
import { tickPrng } from './prng';
import type { LivestockWorld } from './world';

const schoolQuery = defineQuery([Position, Velocity, BehaviorParamsRef, Force]);

/**
 * Below this speed magnitude (mm/s) we treat Velocity as "stalled" and
 * fall back to the orientation's local +X axis for heading. Far below the
 * cruise speed of any species but above subnormal float dust.
 */
const HEADING_STALL_EPS = 1e-3;

export function schoolingSystem(world: LivestockWorld, _dt: number): void {
  const grid = world.spatialGrid;
  const store = world.paramStore;

  for (const eid of schoolQuery(world.ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null) continue;
    // F11.3 priority arbitration — REFUGE fish are focused on their
    // refuge target (FearSystem owns Force); PURSUE fish are chasing
    // (Nipping / Territorial own Force). Either way, schooling
    // pressure would dilute the higher-priority steering goal, so we
    // skip. The BehaviorMode component is always present (every spawn
    // attaches it), so the lookup is unconditional.
    if ((BehaviorMode.mode[eid] as number) !== BEHAVIOR_MODE.FORAGE) continue;
    const params = behavior.schooling;

    const sx = Position.x[eid] as number;
    const sy = Position.y[eid] as number;
    const sz = Position.z[eid] as number;
    const vx = Velocity.x[eid] as number;
    const vy = Velocity.y[eid] as number;
    const vz = Velocity.z[eid] as number;

    // Heading unit vector. Prefer Velocity; fall back to orientation's
    // local +X axis when Velocity is below the stall epsilon. The blind-
    // cone test below depends on this being unit-length.
    const speed = Math.hypot(vx, vy, vz);
    let hx = 0;
    let hy = 0;
    let hz = 0;
    if (speed > HEADING_STALL_EPS) {
      hx = vx / speed;
      hy = vy / speed;
      hz = vz / speed;
    } else {
      // rotateByQuat([1,0,0], q) — Rodrigues form matching the shader's
      // rotateByQuat helper. Identity quaternion (0,0,0,1) returns (1,0,0).
      const qx = Orientation.x[eid] as number;
      const qy = Orientation.y[eid] as number;
      const qz = Orientation.z[eid] as number;
      const qw = Orientation.w[eid] as number;
      // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)  where v = (1,0,0)
      // cross(q.xyz, [1,0,0]) = (0, qz, -qy)
      // q.w * v = (qw, 0, 0)
      // sum = (qw, qz, -qy)
      // cross(q.xyz, (qw, qz, -qy)) = (qy*-qy - qz*qz, qz*qw - qx*-qy, qx*qz - qy*qw)
      //                              = (-qy² - qz², qz*qw + qx*qy, qx*qz - qy*qw)
      const txw = -qy * qy - qz * qz;
      const tyw = qz * qw + qx * qy;
      const tzw = qx * qz - qy * qw;
      hx = 1 + 2 * txw;
      hy = 2 * tyw;
      hz = 2 * tzw;
    }

    // Pre-compute the blind-cone gate. A neighbour at offset `t` (unit)
    // is visible when `dot(heading, t) > cosBlindHalf`, where
    // cosBlindHalf = cos((π - blindAngle) / 2). blindAngle is the *total*
    // arc the cone subtends behind the fish; the half-angle from the
    // forward axis below which a neighbour is "in front" is
    // (π - blindAngle) / 2.
    const cosBlindHalf = Math.cos((Math.PI - params.blindAngle) * 0.5);

    // Force accumulators (separation / alignment / cohesion).
    let fSepX = 0;
    let fSepY = 0;
    let fSepZ = 0;
    let fAliX = 0;
    let fAliY = 0;
    let fAliZ = 0;
    let fCohX = 0;
    let fCohY = 0;
    let fCohZ = 0;
    let aliCount = 0;
    let cohCount = 0;

    const candidates = grid.query(sx, sy, sz, params.ZOA);
    const ZOR2 = params.ZOR * params.ZOR;
    const ZOO2 = params.ZOO * params.ZOO;
    const ZOA2 = params.ZOA * params.ZOA;

    for (const nid of candidates) {
      if (nid === eid) continue;
      const nx = Position.x[nid] as number;
      const ny = Position.y[nid] as number;
      const nz = Position.z[nid] as number;
      const tx = nx - sx;
      const ty = ny - sy;
      const tz = nz - sz;
      const d2 = tx * tx + ty * ty + tz * tz;
      if (d2 < 1e-8 || d2 > ZOA2) continue;

      // Blind-cone gate. Comparing `dot(heading, tNormalised)` to
      // `cosBlindHalf` would need a sqrt for the normalisation — instead
      // we compare `dot(heading, t) > cosBlindHalf * |t|`. heading is
      // already unit-length so this is correct without normalising t.
      const dot = hx * tx + hy * ty + hz * tz;
      // |t| = sqrt(d2). Use d2 directly: condition becomes
      // dot² > (cosBlindHalf² * d2) when both sides are positive; if
      // cosBlindHalf is negative (blindAngle > π) the wide-cone case
      // always passes. We branch on sign rather than square both sides
      // to keep the "neighbour behind us" rejection correct.
      if (cosBlindHalf > 0 && dot < cosBlindHalf * Math.sqrt(d2)) continue;
      if (cosBlindHalf <= 0 && dot < cosBlindHalf * Math.sqrt(d2)) continue;

      if (d2 < ZOR2) {
        // Separation: away from neighbour, magnitude ∝ 1 / d². Reynolds
        // 1987: stronger as the neighbour is closer. Normalise the
        // direction (divide by |t|) then weight by 1/d → combined ÷ d²
        // applied to the un-normalised offset.
        const inv = 1 / d2;
        fSepX -= tx * inv;
        fSepY -= ty * inv;
        fSepZ -= tz * inv;
      } else if (d2 < ZOO2) {
        // Alignment: pull toward the average neighbour heading. Accumulate
        // neighbour velocities; divide by count after the loop.
        fAliX += Velocity.x[nid] as number;
        fAliY += Velocity.y[nid] as number;
        fAliZ += Velocity.z[nid] as number;
        aliCount += 1;
      } else {
        // Cohesion: toward centroid. Accumulate neighbour positions
        // (relative to self for a free centroid-self subtraction).
        fCohX += tx;
        fCohY += ty;
        fCohZ += tz;
        cohCount += 1;
      }
    }

    // Average alignment + subtract self velocity → desired-velocity
    // delta. Reynolds 1987 §3.2.
    if (aliCount > 0) {
      fAliX = fAliX / aliCount - vx;
      fAliY = fAliY / aliCount - vy;
      fAliZ = fAliZ / aliCount - vz;
    }
    // Average cohesion → vector from self to centroid.
    if (cohCount > 0) {
      fCohX /= cohCount;
      fCohY /= cohCount;
      fCohZ /= cohCount;
    }

    // Deterministic xz-plane noise. tickPrng is seeded by (worldSeed,
    // tickCounter, spawnIndex, axis) — using `spawnIndex` (stable across
    // two cold worlds with the same SpawnOpts sequence) rather than the
    // raw bitECS eid (module-global; not stable). DepthSystem owns Y; we
    // don't touch fY here.
    const noiseScale = params.noise * params.vPref;
    const idx = BehaviorParamsRef.spawnIndex[eid] as number;
    const nxNoise = (tickPrng(world, idx, 0) - 0.5) * 2 * noiseScale;
    const nzNoise = (tickPrng(world, idx, 1) - 0.5) * 2 * noiseScale;

    // Sum weighted contributions into the Force accumulator. F11.5's
    // FlowFieldSystem (and F11.3's Fear/Nip/Territory) will pile on top
    // before SteeringIntegrator drains and clamps.
    Force.x[eid] =
      (Force.x[eid] as number) +
      fSepX * params.wSep +
      fAliX * params.wAli +
      fCohX * params.wCoh +
      nxNoise;
    Force.y[eid] = (Force.y[eid] as number) + fSepY * params.wSep + fAliY * params.wAli + fCohY * params.wCoh;
    Force.z[eid] =
      (Force.z[eid] as number) +
      fSepZ * params.wSep +
      fAliZ * params.wAli +
      fCohZ * params.wCoh +
      nzNoise;
  }
}
