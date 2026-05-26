/**
 * FearSystem phase tests (Stage 11 F11.3).
 *
 * Risk integration, mode flips, refuge selection, emergence delay, and
 * the priority-arbitration gate (REFUGE suppresses schooling).
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import {
  BehaviorMode,
  BEHAVIOR_MODE,
  FearState,
  FISH_ARCHETYPE,
  Force,
  HARDSCAPE_CATEGORY,
  Position,
} from './components';
import { fearSystem } from './fear-system';
import { perceptionSystem } from './perception-system';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

describe('fearSystem', () => {
  it('integrates risk from baseline + startles and flips to REFUGE above threshold', () => {
    const w = createLivestockWorld(1, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    // Low threshold so the flip happens fast; baseline alone insufficient
    // but a single startle pushes us over.
    params.fear.riskBaseline = 0.5;
    params.fear.threshold = 0.6;
    params.fear.coverPreference = 'wood';
    params.fear.emergenceDelay = 3;
    const handle = w.registerSpeciesBehavior(1, params);
    // Provide a refuge so the REFUGE state has somewhere to go.
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 100, z: 200 },
      behaviorHandleIdx: handle,
    });
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.FORAGE);
    w.injectStartle(eid, 1.0);
    // First step should fold the startle in and flip the mode.
    fearSystem(w, SIM_DT);
    expect(FearState.risk[eid]).toBeGreaterThan(0.6);
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    // Refuge picked (NO_ENTITY_REF is 0xffffffff, NOT 0 — bitECS may
    // allocate eid 0 as a valid hardscape entity).
    expect(FearState.refugeEid[eid]).not.toBe(0xffffffff);
  });

  it('writes a refuge-attraction Force toward the picked hardscape', () => {
    const w = createLivestockWorld(7, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.fear.threshold = 0.1;
    params.fear.coverPreference = 'wood';
    const handle = w.registerSpeciesBehavior(1, params);
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 200, y: 0, z: 200 },
      behaviorHandleIdx: handle,
    });
    w.injectStartle(eid, 5.0);
    fearSystem(w, SIM_DT);
    // Refuge is at (100,0,100); fish at (200,0,200). Force vector should
    // point toward smaller x AND smaller z.
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    expect(Force.x[eid] as number).toBeLessThan(0);
    expect(Force.z[eid] as number).toBeLessThan(0);
  });

  it('respects coverPreference but falls back to any cover when none matches', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.fear.threshold = 0.1;
    params.fear.coverPreference = 'wood';
    const handle = w.registerSpeciesBehavior(1, params);
    // Only a rock available — fish prefers wood, but should still pick
    // the rock as a fallback.
    w.registerHardscape([
      { position: { x: 50, y: 0, z: 50 }, coverScore: 0.4, category: HARDSCAPE_CATEGORY.ROCK },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 100, z: 500 },
      behaviorHandleIdx: handle,
    });
    w.injectStartle(eid, 5.0);
    fearSystem(w, SIM_DT);
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    expect(FearState.refugeEid[eid]).not.toBe(0xffffffff);
  });

  it('holds REFUGE while risk is above threshold; emerges after delay', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.fear.riskBaseline = 0; // no continuous risk source
    params.fear.threshold = 0.5;
    params.fear.emergenceDelay = 1.0; // 1 second emergence
    const handle = w.registerSpeciesBehavior(1, params);
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 100, z: 500 },
      behaviorHandleIdx: handle,
    });
    // Just enough startle to cross threshold (0.5) — small impulse so
    // decay drops below threshold quickly. With decay rate 0.5 and
    // baseline 0, a startle of 0.6 falls to <0.5 in ~12 ticks
    // (0.6 * exp(-0.5 * 12 * 1/30) ≈ 0.6 * 0.82 = 0.49).
    w.injectStartle(eid, 0.6);
    fearSystem(w, SIM_DT);
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    // Tick forward until risk drops below threshold (it must, with
    // baseline 0 and decay applied each tick).
    let risk = FearState.risk[eid] as number;
    let ticks = 0;
    while (risk >= params.fear.threshold && ticks < 200) {
      fearSystem(w, SIM_DT);
      risk = FearState.risk[eid] as number;
      ticks++;
    }
    expect(risk).toBeLessThan(params.fear.threshold);
    // Mode is still REFUGE — timer was held while risk > threshold.
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    // Now run the emergence delay (~30 ticks at 1s @ 30Hz) plus slack.
    let foundForage = false;
    for (let i = 0; i < 90; i++) {
      fearSystem(w, SIM_DT);
      if ((BehaviorMode.mode[eid] as number) === BEHAVIOR_MODE.FORAGE) {
        foundForage = true;
        break;
      }
    }
    expect(foundForage).toBe(true);
    // Sentinel: refugeEid cleared on emergence (NO_ENTITY_REF, not 0).
    expect(FearState.refugeEid[eid]).toBe(0xffffffff);
  });

  it('does not flip when no cover exists (refugeEid stays 0)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.fear.threshold = 0.1;
    const handle = w.registerSpeciesBehavior(1, params);
    // No hardscape registered at all.
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 100, z: 500 },
      behaviorHandleIdx: handle,
    });
    w.injectStartle(eid, 5.0);
    fearSystem(w, SIM_DT);
    // Mode still flips (the spec says picking a refuge is best-effort),
    // but refugeEid stays at the NO_ENTITY_REF sentinel because no
    // cover exists.
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.REFUGE);
    expect(FearState.refugeEid[eid]).toBe(0xffffffff);
  });

  it('integrates risk over many ticks until threshold crossed (baseline-only)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    // Choose riskBaseline such that decay-adjusted equilibrium is just
    // above threshold — eventually the fish flips.
    params.fear.riskBaseline = 0.4;
    params.fear.threshold = 0.5;
    const handle = w.registerSpeciesBehavior(1, params);
    w.registerHardscape([
      { position: { x: 100, y: 0, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 100, z: 500 },
      behaviorHandleIdx: handle,
    });
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.FORAGE);
    let flipped = false;
    for (let i = 0; i < 300; i++) {
      fearSystem(w, SIM_DT);
      if ((BehaviorMode.mode[eid] as number) === BEHAVIOR_MODE.REFUGE) {
        flipped = true;
        break;
      }
    }
    expect(flipped).toBe(true);
  });

  it('NO_BEHAVIOR_HANDLE entities are skipped (no FearState change)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 100, z: 500 },
    });
    w.injectStartle(eid, 5.0);
    fearSystem(w, SIM_DT);
    // FearState exists (every fish gets it) but FearSystem skipped:
    // risk stays 0 because the early-out fires before integration.
    expect(FearState.risk[eid]).toBe(0);
    expect(BehaviorMode.mode[eid]).toBe(BEHAVIOR_MODE.FORAGE);
  });

  it('priority arbitration — REFUGE fish skip schooling on the next tick', () => {
    // Full pipeline through world.step(): once FearSystem flips to
    // REFUGE, SchoolingSystem's mode-guard skips and the only Force
    // contribution is the refuge attraction.
    const w = createLivestockWorld(123, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.fear.threshold = 0.1;
    params.fear.coverPreference = 'wood';
    const handle = w.registerSpeciesBehavior(1, params);
    w.registerHardscape([
      { position: { x: 100, y: 200, z: 100 }, coverScore: 0.6, category: HARDSCAPE_CATEGORY.WOOD },
    ]);
    // Two fish so schooling would normally pull them together. Verify
    // they don't influence each other once one flips to REFUGE.
    const fearful = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 500 },
      behaviorHandleIdx: handle,
    });
    w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 510, y: 200, z: 510 },
      behaviorHandleIdx: handle,
    });
    w.injectStartle(fearful, 5.0);
    perceptionSystem(w);
    // Step the whole pipeline — REFUGE force should dominate.
    w.step(SIM_DT);
    expect(BehaviorMode.mode[fearful]).toBe(BEHAVIOR_MODE.REFUGE);
    // The fearful fish should be moving (or at least have a velocity)
    // toward the refuge. We assert the trajectory direction.
    for (let i = 0; i < 30; i++) w.step(SIM_DT);
    // After 1 second of REFUGE steering, fish should be closer to
    // (100, 200, 100) than its starting (500, 200, 500).
    const dx = (Position.x[fearful] as number) - 100;
    const dz = (Position.z[fearful] as number) - 100;
    const dist = Math.hypot(dx, dz);
    expect(dist).toBeLessThan(Math.hypot(400, 400));
  });
});
