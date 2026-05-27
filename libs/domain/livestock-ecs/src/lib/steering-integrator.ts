/**
 * SteeringIntegrator (Stage 11 F11.2; pose-axis + pitch-clamp fix landed
 * with the F11.7 livestock-movement triage).
 *
 * Drains the per-entity `Force` accumulator into `Velocity`, enforces the
 * three physical limits Reynolds 1987 §4 calls out (max speed, max turn
 * rate), wall-projects against the tank AABB inset by half a body length,
 * and finally rotates the entity's Orientation toward the new heading so
 * the carangiform shader keeps the body aligned with motion.
 *
 *   1. Velocity += Force * dt
 *   2. Clamp |Velocity| to params.vMax. Apply a small "stall nudge" toward
 *      the current heading if Velocity falls below an epsilon fraction of
 *      vPref so the fish doesn't freeze and never re-acquire a heading.
 *   3. Wall projection: if (Position + Velocity * dt) would exit the AABB
 *      inset by `halfBody`, zero the offending axis component of Velocity
 *      (a perfect slide along the glass). The inset accounts for the
 *      rendered mesh extending `bodyLength` along the swim axis from the
 *      per-instance Position (which the renderer treats as the NOSE — see
 *      `body-builder.ts`).
 *   4. Project the heading onto the XZ plane, capped at ±MAX_PITCH so the
 *      fish doesn't end up nose-up or upside-down even when DepthSystem
 *      applies a strong vertical return-force.
 *   5. Rotate Orientation toward the clamped heading by at most
 *      `turnMax * dt` radians.
 *   6. Reset Force to (0,0,0) for the next tick.
 *
 * Carangiform pose convention (load-bearing — see body-builder.ts):
 *   - Fish geometry is built with the **nose at local X=0** and the **tail
 *     tip at local X=1**.
 *   - The per-instance position is therefore the NOSE position; the body
 *     extends `bodyLength` along the geometry's local +X axis.
 *   - The fish swims **toward its nose**, i.e. along the world-space
 *     direction `rotateByQuat([-1, 0, 0], q)` — the local -X axis after
 *     the entity's quaternion rotation.
 *   - The integrator's heading update aligns that local -X axis with the
 *     velocity direction (clamped to the XZ plane). NOTE: the original
 *     F11.2 implementation aligned local +X with velocity, which made
 *     fish swim tail-first (visible as "swimming in reverse") and stick
 *     their bodies through walls and the water surface.
 */
import { defineQuery } from 'bitecs';
import {
  BehaviorParamsRef,
  BodyLength,
  Force,
  Orientation,
  Position,
  Velocity,
} from './components';
import type { LivestockWorld } from './world';

const integratorQuery = defineQuery([Position, Velocity, Force, Orientation, BodyLength]);

/** |Velocity| below `STALL_FRACTION * vPref` triggers the stall nudge. */
const STALL_FRACTION = 0.01;

/**
 * Max signed-sin of the pitch (Y component) on the heading vector used
 * for orientation updates. sin(25°) ≈ 0.422. Above this the heading is
 * projected back onto a cone around the XZ plane. Real fish can pitch
 * more than this for short bursts (cory mouths-at-substrate, hatchetfish
 * jumps), but 25° is a comfortable visual cap that prevents straight-up /
 * straight-down orientations even when DepthSystem applies a strong
 * vertical return-force.
 */
const MAX_PITCH_SIN = 0.422;

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
      // so it keeps moving. Forward axis is local -X (the nose direction;
      // see the pose-convention block in this file's header). The kick
      // magnitude is `vPref * dt` so over ~1/dt = 30 ticks the fish
      // accelerates to cruise. We don't need to be precise here —
      // Schooling/Depth will dominate as soon as the fish has a real
      // heading.
      const qx = Orientation.x[eid] as number;
      const qy = Orientation.y[eid] as number;
      const qz = Orientation.z[eid] as number;
      const qw = Orientation.w[eid] as number;
      // rotateByQuat([-1, 0, 0], q) — local -X (the nose) in world space.
      const fx = -(1 + 2 * (-qy * qy - qz * qz));
      const fy = -(2 * (qz * qw + qx * qy));
      const fz = -(2 * (qx * qz - qy * qw));
      vx += fx * vPref * dt;
      vy += fy * vPref * dt;
      vz += fz * vPref * dt;
      speed = Math.hypot(vx, vy, vz);
    }

    // 3. Wall projection against the tank AABB, inset by half a body
    //    length on every face. The inset accounts for the rendered mesh
    //    extending `bodyLength` along the swim axis from the per-instance
    //    Position (which is the NOSE, per `body-builder.ts`'s pose
    //    convention). Half-body is a deliberately conservative middle
    //    ground — symmetric on every face means we don't need to know
    //    which direction the body extends per axis, and the visual
    //    "fish poking through the glass" goes away even when DepthSystem
    //    applies a strong vertical force on a fish near the surface.
    const halfBody = (BodyLength.mm[eid] as number) * 0.5;
    const px = Position.x[eid] as number;
    const py = Position.y[eid] as number;
    const pz = Position.z[eid] as number;
    const nextX = px + vx * dt;
    const nextY = py + vy * dt;
    const nextZ = pz + vz * dt;
    if (nextX < aabb.minX + halfBody && vx < 0) vx = 0;
    if (nextX > aabb.maxX - halfBody && vx > 0) vx = 0;
    if (nextY < aabb.minY + halfBody && vy < 0) vy = 0;
    if (nextY > aabb.maxY - halfBody && vy > 0) vy = 0;
    if (nextZ < aabb.minZ + halfBody && vz < 0) vz = 0;
    if (nextZ > aabb.maxZ - halfBody && vz > 0) vz = 0;
    // Recompute speed if a projection landed.
    speed = Math.hypot(vx, vy, vz);

    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    Velocity.z[eid] = vz;

    // 4. Orientation update — rotate toward velocity-aligned heading at
    //    most `turnMax * dt` radians. Skip when velocity is essentially
    //    zero (no defined heading to face). The heading is clamped to a
    //    cone around the XZ plane (|sin(pitch)| ≤ MAX_PITCH_SIN ≈ sin 25°)
    //    so a DepthSystem-dominated vertical velocity doesn't pitch the
    //    body straight up or down — fish stay mostly horizontal even
    //    while moving vertically. See the F11.7 triage note for context.
    if (speed > 1e-4) {
      let tx = vx / speed;
      let ty = vy / speed;
      let tz = vz / speed;
      const xzLen = Math.hypot(tx, tz);
      let headingDefined = true;
      if (Math.abs(ty) > MAX_PITCH_SIN) {
        if (xzLen > 1e-6) {
          const clampedTy = ty > 0 ? MAX_PITCH_SIN : -MAX_PITCH_SIN;
          // Preserve unit length: |xz|² + clampedTy² = 1.
          const xzScale = Math.sqrt(1 - clampedTy * clampedTy) / xzLen;
          tx *= xzScale;
          tz *= xzScale;
          ty = clampedTy;
        } else {
          // Velocity is purely vertical and there's no horizontal
          // component to project onto. Skip the orientation update
          // entirely — the existing heading is the least-wrong fallback.
          // The stall nudge will re-acquire a horizontal heading on the
          // next tick that velocity drops below STALL_FRACTION * vPref.
          // Crucially we DO NOT `continue` here — the Force-reset block
          // below must still run, otherwise per-tick forces leak into
          // the next tick.
          headingDefined = false;
        }
      }
      if (headingDefined) {
        rotateOrientationToward(eid, tx, ty, tz, turnMax * dt);
      }
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
 * current local-**-X** axis (the nose direction; see the pose-convention
 * block at the top of this file) and the target heading, then clamps the
 * rotation angle and composes it onto the existing orientation.
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

  // Current forward axis = rotateByQuat([-1, 0, 0], q) — the nose direction
  // after the entity's quaternion rotation. The integrator drives this
  // axis toward the target heading (clamped to a small pitch cone by the
  // caller), so the fish noses point in the direction of motion.
  const fx = -(1 + 2 * (-qy * qy - qz * qz));
  const fy = -(2 * (qz * qw + qx * qy));
  const fz = -(2 * (qx * qz - qy * qw));

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
