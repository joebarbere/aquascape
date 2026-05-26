/**
 * TerritorialSystem (Stage 11 F11.3).
 *
 * Brown (1964) anchor-based territoriality + Adams (2001) fatigue model,
 * with the Maynard Smith & Parker (1976) bourgeois rule shaping who wins
 * the contest at the species-level. Each territorial fish (cichlids,
 * bettas) is anchored to a single hardscape eid at spawn time
 * (`world.spawnFish` calls `pickTerritoryAnchor` to pick the nearest
 * hardscape within `2 * coreRadius`). The system defends the anchor:
 *
 *   1. Skip if `BehaviorMode !== FORAGE` (REFUGE / PURSUE win).
 *   2. Skip if `anchorEid === 0` (no anchor in range at spawn).
 *   3. If distance from anchor > `displayRadius`, write a weak return
 *      force toward the anchor so the owner doesn't drift away forever.
 *      No contest with intruders at this range.
 *   4. Otherwise scan the spatial grid around the anchor within
 *      `coreRadius` for heterospecific intruders. Bourgeois rule: owner
 *      wins, chase the nearest intruder with a force scaled by
 *      `aggression * fatigueScale` where `fatigueScale = exp(-fatigue *
 *      0.3)`. Flip to PURSUE for one tick.
 *   5. Update fatigue: +`fatigueRate * dt` during a chase, -`0.5 * dt`
 *      when not chasing (recovery).
 *
 * Note: the intruder is NOT directly pushed by this system. We rely on
 * the chased fish's own schooling separation (or fear if the chase
 * crosses the intruder's startle threshold via an injected impulse, in
 * F11.4+) to displace it. Coupling systems by writing to other
 * entities' Force from inside this loop would tangle the ownership
 * model — keeping each system writing only to its own entities preserves
 * the priority arbitration contract.
 */
import { defineQuery, hasComponent } from 'bitecs';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  BehaviorParamsRef,
  Force,
  Hardscape,
  NO_ENTITY_REF,
  Position,
  SpeciesId,
  Territory,
} from './components';
import type { LivestockWorld } from './world';

const territorialQuery = defineQuery([
  Position,
  BehaviorParamsRef,
  Territory,
  BehaviorMode,
  SpeciesId,
  Force,
]);

/** Magnitude (per unit) of the weak return force outside displayRadius. */
const RETURN_FORCE_BASE = 80;

/** Fatigue decay constant — `fatigueScale = exp(-fatigue * FATIGUE_DECAY)`. */
const FATIGUE_DECAY = 0.3;

/** Recovery rate per second when not actively chasing. */
const FATIGUE_RECOVERY = 0.5;

export function territorialSystem(world: LivestockWorld, dt: number): void {
  const store = world.paramStore;
  const grid = world.spatialGrid;

  for (const eid of territorialQuery(world.ecs)) {
    const handle = BehaviorParamsRef.handleIdx[eid] as number;
    const behavior = store.get(handle);
    if (behavior === null || behavior.territory === null) continue;
    const params = behavior.territory;

    const anchorEid = Territory.anchorEid[eid] as number;
    if (anchorEid === NO_ENTITY_REF) continue;

    if ((BehaviorMode.mode[eid] as number) !== BEHAVIOR_MODE.FORAGE) continue;

    const sx = Position.x[eid] as number;
    const sy = Position.y[eid] as number;
    const sz = Position.z[eid] as number;
    const ax = Position.x[anchorEid] as number;
    const ay = Position.y[anchorEid] as number;
    const az = Position.z[anchorEid] as number;
    const dToAnchor = Math.hypot(ax - sx, ay - sy, az - sz);

    // Outside the display radius — weak return-to-anchor pull, no
    // escalation. Fatigue recovers because we're not chasing.
    if (dToAnchor > params.displayRadius) {
      const dx = ax - sx;
      const dy = ay - sy;
      const dz = az - sz;
      if (dToAnchor > 1e-4) {
        const k = RETURN_FORCE_BASE / dToAnchor;
        Force.x[eid] = (Force.x[eid] as number) + dx * k;
        Force.y[eid] = (Force.y[eid] as number) + dy * k;
        Force.z[eid] = (Force.z[eid] as number) + dz * k;
      }
      const recovered = (Territory.fatigue[eid] as number) - FATIGUE_RECOVERY * dt;
      Territory.fatigue[eid] = recovered < 0 ? 0 : recovered;
      continue;
    }

    // Inside the display radius — scan for intruders within coreRadius
    // of the anchor (not the owner). The owner can be anywhere inside
    // the displayRadius and still defend the core.
    const candidates = grid.query(ax, ay, az, params.coreRadius);
    const coreSq = params.coreRadius * params.coreRadius;
    const selfSpecies = SpeciesId.id[eid] as number;

    let nearestEid = NO_ENTITY_REF;
    let nearestDistSq = Infinity;
    for (const nid of candidates) {
      if (nid === eid) continue;
      // Hardscape entities live in the spatial grid alongside fish
      // (Position is the only required component). Filter them out
      // explicitly — `hasComponent` is the cheap check, and excluding
      // hardscape is the cleanest way to avoid treating a rock as an
      // intruder.
      if (hasComponent(world.ecs, Hardscape, nid)) continue;
      // Only fish carry BehaviorParamsRef; anything without it isn't a
      // real intruder candidate (a non-livestock decoration with
      // Position would be filtered above, but the guard is cheap).
      if (!hasComponent(world.ecs, BehaviorParamsRef, nid)) continue;
      const ix = Position.x[nid] as number;
      const iy = Position.y[nid] as number;
      const iz = Position.z[nid] as number;
      const dx = ix - ax;
      const dy = iy - ay;
      const dz = iz - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > coreSq) continue;
      const nSpecies = SpeciesId.id[nid] as number;
      if (nSpecies === selfSpecies) continue;
      if (d2 < nearestDistSq) {
        nearestDistSq = d2;
        nearestEid = nid;
      }
    }

    if (nearestEid === NO_ENTITY_REF) {
      // No intruder — fatigue recovers.
      const recovered = (Territory.fatigue[eid] as number) - FATIGUE_RECOVERY * dt;
      Territory.fatigue[eid] = recovered < 0 ? 0 : recovered;
      continue;
    }

    // Bourgeois rule (Maynard Smith & Parker 1976) — owner always wins.
    // Chase force toward the intruder, scaled by aggression and current
    // fatigue. Fatigue scaling implements the Adams 2001 / Brown 1964
    // observation that sustained aggression fades over 5–15 s of
    // contest.
    const fatigue = Territory.fatigue[eid] as number;
    const fatigueScale = Math.exp(-fatigue * FATIGUE_DECAY);
    const ix = Position.x[nearestEid] as number;
    const iy = Position.y[nearestEid] as number;
    const iz = Position.z[nearestEid] as number;
    const tx = ix - sx;
    const ty = iy - sy;
    const tz = iz - sz;
    const len = Math.hypot(tx, ty, tz);
    if (len > 1e-4) {
      const k = (params.aggression * fatigueScale) / len;
      Force.x[eid] = (Force.x[eid] as number) + tx * k;
      Force.y[eid] = (Force.y[eid] as number) + ty * k;
      Force.z[eid] = (Force.z[eid] as number) + tz * k;
    }

    BehaviorMode.mode[eid] = BEHAVIOR_MODE.PURSUE;
    // Build fatigue — we're actively chasing.
    Territory.fatigue[eid] = fatigue + params.fatigueRate * dt;
  }
}
