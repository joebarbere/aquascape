/**
 * CollisionSystem (Stage 11 F11.5 Wave 4).
 *
 * Two sub-passes, both running after SteeringIntegrator and before
 * KinematicSystem — i.e. AFTER the desired velocity has been clamped +
 * heading-rotated by the integrator, but BEFORE Kinematic integrates it
 * into Position. Adjusting velocity here keeps the integrator's `vMax` cap
 * authoritative for the *intent* while we override for *physical reality*.
 *
 * Slot order (see `docs/caveats/livestock-ecs.md` system-ordering table):
 *
 *   … SteeringIntegrator → **CollisionSystem** → KinematicSystem …
 *
 * RUNS FOR ALL MODES
 * ------------------
 * Collision is always-on physics — REFUGE / PURSUE fish still bounce off
 * rocks and don't pass through each other. No `BehaviorMode` gate.
 *
 * SUB-PASS 3a — HARDSCAPE SDF
 * ---------------------------
 * For each entity with `Position` + `Velocity` + `BodyLength`:
 *
 *   d = sampleSdf(sdfData, position)
 *   if d < BL * 0.5:        // fish body intersecting hardscape
 *     n = sampleSdfGradient(sdfData, position)
 *     // 1. Repulsive impulse — pushes fish outward proportional to
 *     //    penetration depth so a deeply-embedded fish unsticks faster.
 *     velocity += n * max(0, BL*0.5 - d) * SDF_REPULSION_STRENGTH
 *     // 2. Tangent deflection — project velocity onto the plane
 *     //    perpendicular to the gradient, but ONLY when the velocity
 *     //    component along the gradient is *into* the surface
 *     //    (dot(v, n) < 0). Leaves outbound velocity alone so the
 *     //    repulsion pushes free without us cancelling it on the same
 *     //    tick.
 *
 * `n` from `sampleSdfGradient` is unit-ish — central-differences on a
 * trilinear approximation drifts a few percent off unit magnitude, which
 * is fine for the deflection use-case (we re-normalise the projection by
 * the gradient's actual magnitude via the standard `v - dot(v,n)*n`
 * formula, which is robust to non-unit n as long as it's close).
 *
 * If `world.getHardscapeSdf()` is null, the entire sub-pass is skipped.
 *
 * SUB-PASS 3b — FISH-VS-FISH
 * --------------------------
 * Re-uses the `SpatialGrid` already rebuilt by PerceptionSystem this tick
 * (see system-ordering table — perception → … → collision means we get a
 * fresh grid for free). For each entity, query neighbours within `BL * 2`,
 * then for each unique pair (eid_a < eid_b to skip duplicates):
 *
 *   d = |pos_a - pos_b|
 *   overlap = (BL_a + BL_b) * 0.4 - d
 *   if overlap > 0:
 *     dir = normalize(pos_a - pos_b)
 *     velocity_a += dir * overlap * FISH_SEPARATION_STRENGTH
 *     velocity_b -= dir * overlap * FISH_SEPARATION_STRENGTH
 *
 * Equal-and-opposite impulses preserve total momentum (good practice;
 * makes determinism debugging easier — a symmetric pair stays symmetric).
 * The `0.4` half-length-fraction is the same overlap criterion the
 * SchoolingSystem's separation force uses, just enforced as a hard impulse
 * here instead of an additive smooth force.
 *
 * DETERMINISM
 * -----------
 * Both passes iterate in bitECS eid order; pair lookups use `eid_a <
 * eid_b` to dedupe. `sampleSdf` / `sampleSdfGradient` are pure trilinear
 * lookups — no PRNG, no Date.now. Same baked SDF + same fish positions →
 * byte-identical velocity adjustments.
 */
import { defineQuery, hasComponent } from 'bitecs';
import { sampleSdf, sampleSdfGradient } from '@aquascape/domain/fluid-sim';
import { BodyLength, FoodSprite, Hardscape, Position, Velocity } from './components';
import type { LivestockWorld } from './world';

/**
 * Multiplier on the per-tick repulsive impulse magnitude. With penetration
 * depth in mm and SteeringIntegrator's `vMax` typically ~200 mm/s, a
 * strength of 50 means a 10 mm penetration gives a 500 mm/s impulse —
 * comfortably above any plausible cruise speed, so a deeply-embedded fish
 * unsticks in 1–2 ticks rather than oscillating.
 */
const SDF_REPULSION_STRENGTH = 50;

/**
 * Multiplier on the per-tick fish-vs-fish separation impulse magnitude.
 * Lower than SDF — fish don't need to *unstick* from each other, just
 * gently nudge apart. 8 means a 10 mm overlap gives an 80 mm/s impulse,
 * enough to separate two fish over a handful of ticks without making them
 * jitter on first contact.
 */
const FISH_SEPARATION_STRENGTH = 8;

/**
 * Half-body-length fraction used as the fish-vs-fish "core radius" — two
 * fish are considered overlapping when their centers are closer than
 * `(BL_a + BL_b) * COLLISION_RADIUS_FRACTION`. 0.4 matches the
 * SchoolingSystem separation threshold so the two enforcement mechanisms
 * stay coherent.
 */
const COLLISION_RADIUS_FRACTION = 0.4;

/**
 * Multiplier on body length for the spatial-grid neighbour query radius.
 * Querying within `BL * 2` gives plenty of headroom over the `BL * 0.4 +
 * BL * 0.4 = BL * 0.8` overlap threshold while still being a tight enough
 * query to keep the broad phase cheap. Using `BL` from the centre entity
 * is sufficient because the grid is broad-phase only — we re-check exact
 * distance in the fine phase below.
 */
const NEIGHBOUR_QUERY_BL_MULT = 2;

const sdfQuery = defineQuery([Position, Velocity, BodyLength]);
const fishFishQuery = defineQuery([Position, Velocity, BodyLength]);

export function collisionSystem(world: LivestockWorld): void {
  const ecs = world.ecs;

  // ─── 3a. Hardscape SDF deflection + repulsion ────────────────────────────
  const sdfData = world.getHardscapeSdf();
  if (sdfData !== null) {
    const probe = { x: 0, y: 0, z: 0 };
    for (const eid of sdfQuery(ecs)) {
      // Hardscape entities also carry Position + BodyLength would not
      // normally apply (Hardscape is a tag, not a fish) — but we skip
      // anything tagged Hardscape just in case a future component combo
      // would slip a hardscape into this query. FoodSprite likewise has
      // no Velocity component (it's not in the query at all), but we
      // belt-and-braces filter on hasComponent so any future sprite
      // additions don't accidentally get pushed by collision.
      if (hasComponent(ecs, Hardscape, eid)) continue;
      if (hasComponent(ecs, FoodSprite, eid)) continue;
      probe.x = Position.x[eid] as number;
      probe.y = Position.y[eid] as number;
      probe.z = Position.z[eid] as number;
      const d = sampleSdf(sdfData, probe);
      const bl = BodyLength.mm[eid] as number;
      const halfBl = bl * 0.5;
      if (d >= halfBl) continue; // free water — no contact
      const n = sampleSdfGradient(sdfData, probe);
      // Gradient might be (0,0,0) when out-of-grid; sampleSdfGradient
      // returns zero in that case. Skip — without a gradient we have no
      // defensible push direction.
      const nLen = Math.hypot(n.x, n.y, n.z);
      if (nLen < 1e-6) continue;
      const nx = n.x / nLen;
      const ny = n.y / nLen;
      const nz = n.z / nLen;

      // 1. Repulsive impulse — magnitude proportional to penetration depth.
      //    `max(0, halfBl - d)` is guaranteed positive here (we already
      //    early-returned on d >= halfBl) but the clamp documents intent.
      const penetration = halfBl - d > 0 ? halfBl - d : 0;
      const repulse = penetration * SDF_REPULSION_STRENGTH;
      let vx = (Velocity.x[eid] as number) + nx * repulse;
      let vy = (Velocity.y[eid] as number) + ny * repulse;
      let vz = (Velocity.z[eid] as number) + nz * repulse;

      // 2. Tangent deflection — only project when velocity is heading
      //    INTO the surface (dot(v, n) < 0 with n pointing outward).
      //    `v -= dot(v, n) * n` zeros the inward component while leaving
      //    the tangential motion alone — fish slides along the rock face
      //    rather than bouncing.
      const dot = vx * nx + vy * ny + vz * nz;
      if (dot < 0) {
        vx -= dot * nx;
        vy -= dot * ny;
        vz -= dot * nz;
      }
      Velocity.x[eid] = vx;
      Velocity.y[eid] = vy;
      Velocity.z[eid] = vz;
    }
  }

  // ─── 3b. Fish-vs-fish soft separation ────────────────────────────────────
  // Use the SpatialGrid PerceptionSystem just rebuilt. Walk entities in
  // bitECS eid order; for each, query neighbours and apply separation to
  // each unique pair exactly once (eid_a < eid_b).
  const grid = world.spatialGrid;
  for (const eid of fishFishQuery(ecs)) {
    if (hasComponent(ecs, Hardscape, eid)) continue;
    if (hasComponent(ecs, FoodSprite, eid)) continue;
    const ax = Position.x[eid] as number;
    const ay = Position.y[eid] as number;
    const az = Position.z[eid] as number;
    const blA = BodyLength.mm[eid] as number;
    const queryRadius = blA * NEIGHBOUR_QUERY_BL_MULT;
    const neighbours = grid.query(ax, ay, az, queryRadius);
    for (const other of neighbours) {
      // Skip self and skip the duplicate half of every pair. The
      // strict-less-than dedupe keeps the impulse single-application.
      if (other <= eid) continue;
      if (hasComponent(ecs, Hardscape, other)) continue;
      if (hasComponent(ecs, FoodSprite, other)) continue;
      if (!hasComponent(ecs, BodyLength, other)) continue;
      if (!hasComponent(ecs, Velocity, other)) continue;
      const bx = Position.x[other] as number;
      const by = Position.y[other] as number;
      const bz = Position.z[other] as number;
      const blB = BodyLength.mm[other] as number;
      const dxAB = ax - bx;
      const dyAB = ay - by;
      const dzAB = az - bz;
      const dist = Math.hypot(dxAB, dyAB, dzAB);
      const coreRadius = (blA + blB) * COLLISION_RADIUS_FRACTION;
      const overlap = coreRadius - dist;
      if (overlap <= 0) continue;
      // Degenerate co-located pair: pick an arbitrary fixed axis (+X) so
      // two fish at exactly the same position still separate
      // deterministically. The choice of +X is arbitrary but stable —
      // determinism wins over physical accuracy here, and a co-located
      // pair is already a degenerate spawn.
      let dirX: number;
      let dirY: number;
      let dirZ: number;
      if (dist < 1e-6) {
        dirX = 1;
        dirY = 0;
        dirZ = 0;
      } else {
        dirX = dxAB / dist;
        dirY = dyAB / dist;
        dirZ = dzAB / dist;
      }
      const impulse = overlap * FISH_SEPARATION_STRENGTH;
      Velocity.x[eid] = (Velocity.x[eid] as number) + dirX * impulse;
      Velocity.y[eid] = (Velocity.y[eid] as number) + dirY * impulse;
      Velocity.z[eid] = (Velocity.z[eid] as number) + dirZ * impulse;
      Velocity.x[other] = (Velocity.x[other] as number) - dirX * impulse;
      Velocity.y[other] = (Velocity.y[other] as number) - dirY * impulse;
      Velocity.z[other] = (Velocity.z[other] as number) - dirZ * impulse;
    }
  }
}
