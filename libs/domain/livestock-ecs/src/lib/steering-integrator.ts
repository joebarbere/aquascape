/**
 * SteeringIntegrator (Stage 11 F11.2).
 *
 * Drains the per-entity `Force` accumulator into `Velocity`, enforces the
 * three physical limits Reynolds 1987 §4 calls out (max speed, max turn
 * rate), wall-projects against the tank AABB, and finally rotates the
 * entity's Orientation toward the new heading so the carangiform shader
 * (which expects local +X = forward) keeps the body aligned with motion.
 *
 *   1. Velocity += Force * dt
 *   2. Clamp |Velocity| to params.vMax. Apply a small "stall nudge" toward
 *      the current heading if Velocity falls below an epsilon fraction of
 *      vPref so the fish doesn't freeze and never re-acquire a heading.
 *   3. Wall projection: if (Position + Velocity * dt) would exit the AABB,
 *      zero the offending axis component of Velocity (a perfect slide
 *      along the glass). F11.5's hardscape SDF replaces this with a
 *      proper deflection.
 *   4. Rotate Orientation toward `velocity-aligned heading` by at most
 *      `turnMax * dt` radians (slerp, capped). Carangiform fish point
 *      along local +X — the rotation we want is the quaternion that
 *      takes +X to (normalised) velocity.
 *   5. Reset Force to (0,0,0) for the next tick.
 */
import { defineQuery } from 'bitecs';
import { BehaviorParamsRef, Force, Orientation, Position, Velocity } from './components';
import type { LivestockWorld } from './world';

const integratorQuery = defineQuery([Position, Velocity, Force, Orientation]);

/** |Velocity| below `STALL_FRACTION * vPref` triggers the stall nudge. */
const STALL_FRACTION = 0.01;

export function steeringIntegrator(world: LivestockWorld, dt: number): void {
  const aabb = world.tankAabb;
  const store = world.paramStore;

  for (const eid of integratorQuery(world.ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    // Static-wiggle path: entities without a registered behaviour stay
    // exactly where F11.1 left them. SteeringIntegrator skips the entire
    // chain — no force clamp, no stall nudge, no wall projection. This
    // preserves the "Velocity=0 stays 0" contract that the kinematic
    // spec was written against.
    if (behavior === null) {
      // Still reset Force in case some earlier system wrote into it
      // anyway (defensive — no current system does for null-behaviour
      // entities, but it costs three stores and keeps the contract
      // tidy).
      Force.x[eid] = 0;
      Force.y[eid] = 0;
      Force.z[eid] = 0;
      continue;
    }
    const vMax = behavior.schooling.vMax;
    const turnMax = behavior.schooling.turnMax;
    const vPref = behavior.schooling.vPref;

    // 1. Integrate force into velocity.
    let vx = (Velocity.x[eid] as number) + (Force.x[eid] as number) * dt;
    let vy = (Velocity.y[eid] as number) + (Force.y[eid] as number) * dt;
    let vz = (Velocity.z[eid] as number) + (Force.z[eid] as number) * dt;

    // 2. Clamp |velocity| to vMax + stall nudge.
    let speed = Math.hypot(vx, vy, vz);
    if (speed > vMax) {
      const k = vMax / speed;
      vx *= k;
      vy *= k;
      vz *= k;
      speed = vMax;
    } else if (speed < STALL_FRACTION * vPref) {
      // Stall nudge — kick the fish forward along its current orientation
      // so it keeps moving. Forward axis is local +X (carangiform
      // convention; see livestock-renderer-3d's shader). The kick magnitude
      // is `vPref * dt` so over ~1/dt = 30 ticks the fish accelerates to
      // cruise. We don't need to be precise here — Schooling/Depth will
      // dominate as soon as the fish has a real heading.
      const qx = Orientation.x[eid] as number;
      const qy = Orientation.y[eid] as number;
      const qz = Orientation.z[eid] as number;
      const qw = Orientation.w[eid] as number;
      const fx = 1 + 2 * (-qy * qy - qz * qz);
      const fy = 2 * (qz * qw + qx * qy);
      const fz = 2 * (qx * qz - qy * qw);
      vx += fx * vPref * dt;
      vy += fy * vPref * dt;
      vz += fz * vPref * dt;
      speed = Math.hypot(vx, vy, vz);
    }

    // 3. Wall projection against the tank AABB. Look ahead one step; if
    //    the projected position would exit a face, zero that axis. This
    //    keeps Velocity aligned with the wall plane (perfect slide).
    const px = Position.x[eid] as number;
    const py = Position.y[eid] as number;
    const pz = Position.z[eid] as number;
    const nextX = px + vx * dt;
    const nextY = py + vy * dt;
    const nextZ = pz + vz * dt;
    if (nextX < aabb.minX && vx < 0) vx = 0;
    if (nextX > aabb.maxX && vx > 0) vx = 0;
    if (nextY < aabb.minY && vy < 0) vy = 0;
    if (nextY > aabb.maxY && vy > 0) vy = 0;
    if (nextZ < aabb.minZ && vz < 0) vz = 0;
    if (nextZ > aabb.maxZ && vz > 0) vz = 0;
    // Recompute speed if a projection landed.
    speed = Math.hypot(vx, vy, vz);

    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    Velocity.z[eid] = vz;

    // 4. Orientation update — rotate toward velocity-aligned heading at
    //    most `turnMax * dt` radians. Skip when velocity is essentially
    //    zero (no defined heading to face).
    if (speed > 1e-4) {
      rotateOrientationToward(eid, vx / speed, vy / speed, vz / speed, turnMax * dt);
    }

    // 5. Reset Force for the next tick.
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
  }
}

/**
 * Rotate `Orientation[eid]` toward the unit vector `(tx,ty,tz)`, by at
 * most `maxAngle` radians. Computes the shortest-arc rotation between the
 * current local-+X axis and the target heading, then clamps the rotation
 * angle and composes it onto the existing orientation.
 *
 * We don't slerp two quaternions; instead we build the *delta* quaternion
 * (axis-angle) and post-multiply. This is exactly equivalent to slerp
 * between identity and the delta, but avoids the trig of decomposing the
 * full orientation pair.
 */
function rotateOrientationToward(
  eid: number,
  tx: number,
  ty: number,
  tz: number,
  maxAngle: number,
): void {
  const qx = Orientation.x[eid] as number;
  const qy = Orientation.y[eid] as number;
  const qz = Orientation.z[eid] as number;
  const qw = Orientation.w[eid] as number;

  // Current forward axis = rotateByQuat([1,0,0], q).
  const fx = 1 + 2 * (-qy * qy - qz * qz);
  const fy = 2 * (qz * qw + qx * qy);
  const fz = 2 * (qx * qz - qy * qw);

  // Angle between current forward and target heading.
  let dot = fx * tx + fy * ty + fz * tz;
  if (dot > 1) dot = 1;
  if (dot < -1) dot = -1;
  const angle = Math.acos(dot);
  // Already aligned — nothing to do (also avoids axis-degenerate sin=0).
  if (angle < 1e-5) return;

  // Rotation axis = cross(forward, target). Length = sin(angle).
  let ax = fy * tz - fz * ty;
  let ay = fz * tx - fx * tz;
  let az = fx * ty - fy * tx;
  let alen = Math.hypot(ax, ay, az);
  if (alen < 1e-6) {
    // Forward and target are anti-parallel — pick any orthogonal axis.
    // Use world Y as the default rotation axis (yaw flip). This is the
    // standard ambiguous-180° fallback in robotics + game-engine code.
    ax = 0;
    ay = 1;
    az = 0;
    alen = 1;
  }
  ax /= alen;
  ay /= alen;
  az /= alen;

  // Clamp the rotation angle.
  const step = angle > maxAngle ? maxAngle : angle;

  // Delta quaternion = (axis * sin(step/2), cos(step/2)).
  const half = step * 0.5;
  const s = Math.sin(half);
  const c = Math.cos(half);
  const dx = ax * s;
  const dy = ay * s;
  const dz = az * s;
  const dw = c;

  // Compose: q' = delta * q (rotate the body so its local +X tracks the
  // delta-rotated forward axis).
  const rx = dw * qx + dx * qw + dy * qz - dz * qy;
  const ry = dw * qy - dx * qz + dy * qw + dz * qx;
  const rz = dw * qz + dx * qy - dy * qx + dz * qw;
  const rw = dw * qw - dx * qx - dy * qy - dz * qz;

  // Normalise — accumulating per-tick composition can drift the quat
  // off the unit hyper-sphere over thousands of ticks.
  const norm = Math.hypot(rx, ry, rz, rw);
  if (norm > 0) {
    Orientation.x[eid] = rx / norm;
    Orientation.y[eid] = ry / norm;
    Orientation.z[eid] = rz / norm;
    Orientation.w[eid] = rw / norm;
  }
}
