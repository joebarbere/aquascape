/**
 * NippingSystem (Stage 11 F11.3).
 *
 * Keenleyside (1955) + Magurran (1990) — tiger barbs nip when their
 * conspecific group is too small. Above `groupThreshold` visible
 * conspecifics the urge is suppressed (school-satisfied behaviour); below
 * it the fish targets a vulnerable heterospecific and darts.
 *
 * Per tick, for each fish carrying `NippingDrive`:
 *   1. Skip if `BehaviorMode !== FORAGE` (REFUGE / PURSUE win).
 *   2. Tick the per-entity cooldown down. Skip if still > 0.
 *   3. Query the spatial grid within `NIP_NEIGHBOUR_RADIUS_MM`.
 *   4. Count same-species neighbours. If `conspecifics >= groupThreshold`,
 *      skip (group satisfies the urge).
 *   5. Otherwise pick the first heterospecific that satisfies the
 *      vulnerability rule (long fins → slow swimmer). Write a force
 *      toward it, flip to PURSUE, set cooldown.
 *
 * The PURSUE flag only lasts one tick; on the next tick the cooldown
 * gate skips us and BehaviorMode is reset to FORAGE so Schooling /
 * Territory can resume.
 *
 * Vulnerability proxy: rather than plumb fin geometry through the
 * components, we treat archetype `DEEP_BODIED` (gourami / angelfish /
 * discus / bettas, per fish-anatomy) as the long-fin class. Tiger barbs'
 * canonical victims (bettas + angelfish) are exactly that archetype.
 * Combined with the "slow swimmer" check (`|Velocity_victim| < self.vMax
 * * 0.5`) this matches the species-level intent without a new component.
 */
import { defineQuery, hasComponent } from 'bitecs';
import {
  Archetype,
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  FISH_ARCHETYPE,
  Force,
  Hardscape,
  NippingDrive,
  Position,
  SpeciesId,
  Velocity,
} from './components';
import type { LivestockWorld } from './world';

const nipperQuery = defineQuery([
  Position,
  Velocity,
  BehaviorParamsRef,
  NippingDrive,
  BehaviorMode,
  SpeciesId,
  Force,
]);

/** Radius (mm) within which a nipper looks for conspecifics + victims. */
const NIP_NEIGHBOUR_RADIUS_MM = 150;

/** Cooldown after each nip attempt — prevents back-to-back darts. */
const NIP_COOLDOWN_SEC = 2.0;

/**
 * Force magnitude (per unit) for the dart. The unit direction toward the
 * victim is multiplied by this scalar. Picked to dominate the schooling
 * force during the PURSUE tick — SteeringIntegrator still clamps to vMax.
 */
const NIP_FORCE_BASE = 400;

export function nippingSystem(world: LivestockWorld, dt: number): void {
  const store = world.paramStore;
  const grid = world.spatialGrid;

  for (const eid of nipperQuery(world.ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null || behavior.nipping === null) continue;
    const params = behavior.nipping;

    const mode = BehaviorMode.mode[eid] as number;
    // PURSUE persists for exactly one tick — clear it back to FORAGE on
    // the next tick so other systems can resume. The cooldown gate
    // below prevents a second dart inside the cooldown window even
    // after the mode resets.
    if (mode === BEHAVIOR_MODE.PURSUE) {
      BehaviorMode.mode[eid] = BEHAVIOR_MODE.FORAGE;
    }
    if (mode !== BEHAVIOR_MODE.FORAGE) continue;

    // Cooldown drain. Below epsilon we treat it as 0 so the next tick
    // can fire a fresh attempt without floating-point noise.
    let cooldown = (NippingDrive.cooldownSec[eid] as number) - dt;
    if (cooldown < 0) cooldown = 0;
    NippingDrive.cooldownSec[eid] = cooldown;
    if (cooldown > 0) continue;

    const sx = Position.x[eid] as number;
    const sy = Position.y[eid] as number;
    const sz = Position.z[eid] as number;
    const selfSpecies = SpeciesId.id[eid] as number;
    const selfVMax = behavior.schooling.vMax;
    const slowThreshold = selfVMax * 0.5;

    const candidates = grid.query(sx, sy, sz, NIP_NEIGHBOUR_RADIUS_MM);
    const radiusSq = NIP_NEIGHBOUR_RADIUS_MM * NIP_NEIGHBOUR_RADIUS_MM;

    // First pass — count conspecifics in range. We do this as a
    // dedicated pass rather than fused with victim selection so the
    // group-threshold check is decisive: if the group satisfies the
    // urge, we skip without picking a victim regardless of who's
    // around.
    let conspecifics = 0;
    for (const nid of candidates) {
      if (nid === eid) continue;
      // Hardscape participates in the broad-phase grid (Position
      // alone) but isn't a fish; exclude.
      if (hasComponent(world.ecs, Hardscape, nid)) continue;
      if (!hasComponent(world.ecs, BehaviorParamsRef, nid)) continue;
      const dx = (Position.x[nid] as number) - sx;
      const dy = (Position.y[nid] as number) - sy;
      const dz = (Position.z[nid] as number) - sz;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      if ((SpeciesId.id[nid] as number) === selfSpecies) conspecifics++;
    }
    if (conspecifics >= params.groupThreshold) continue;

    // Second pass — pick a victim. First match wins (queries iterate
    // in eid order, so the choice is deterministic across runs with
    // the same spawn order). The vulnerability rule is a conjunction:
    // long-fin archetype + slow velocity. The `finFraction` param on
    // NippingParams currently parameterises the archetype check
    // implicitly via the DEEP_BODIED constant — finer-grained fin data
    // is reserved for F11.6 species tuning.
    let victimEid = -1;
    for (const nid of candidates) {
      if (nid === eid) continue;
      if (hasComponent(world.ecs, Hardscape, nid)) continue;
      if (!hasComponent(world.ecs, BehaviorParamsRef, nid)) continue;
      const dx = (Position.x[nid] as number) - sx;
      const dy = (Position.y[nid] as number) - sy;
      const dz = (Position.z[nid] as number) - sz;
      if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
      if ((SpeciesId.id[nid] as number) === selfSpecies) continue;
      // Vulnerability: archetype is long-finned (gourami / angelfish /
      // discus / betta — all DEEP_BODIED in fish-anatomy) AND fish is
      // moving slowly relative to the nipper's top speed.
      if ((Archetype.id[nid] as number) !== FISH_ARCHETYPE.DEEP_BODIED) continue;
      const vx = Velocity.x[nid] as number;
      const vy = Velocity.y[nid] as number;
      const vz = Velocity.z[nid] as number;
      if (Math.hypot(vx, vy, vz) >= slowThreshold) continue;
      victimEid = nid;
      break;
    }
    if (victimEid < 0) continue;

    // Write the chase force toward the victim. Magnitude is scaled by
    // `params.rate` — higher = more aggressive species. The
    // direction is normalised so distance doesn't bias the force.
    const tx = (Position.x[victimEid] as number) - sx;
    const ty = (Position.y[victimEid] as number) - sy;
    const tz = (Position.z[victimEid] as number) - sz;
    const len = Math.hypot(tx, ty, tz);
    if (len < 1e-4) continue;
    const k = (NIP_FORCE_BASE * params.rate) / len;
    Force.x[eid] = (Force.x[eid] as number) + tx * k;
    Force.y[eid] = (Force.y[eid] as number) + ty * k;
    Force.z[eid] = (Force.z[eid] as number) + tz * k;

    BehaviorMode.mode[eid] = BEHAVIOR_MODE.PURSUE;
    NippingDrive.cooldownSec[eid] = NIP_COOLDOWN_SEC;
  }
}
