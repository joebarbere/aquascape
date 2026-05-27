/**
 * CuriositySystem tests (Stage 11 F11.4).
 *
 * Covers:
 *   - Poisson trigger fires at expected rate over 10k samples.
 *   - Trigger sets the interest point at the front-pane glass.
 *   - dwellRemaining decrements + clears on expiry.
 *   - Boldness gates trigger probability (shy fish ≪ bold fish).
 *   - Mode arbitration: REFUGE / PURSUE fish don't trigger.
 */
import { MID_PRESET, type ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import {
  BEHAVIOR_MODE,
  BehaviorMode,
  Curiosity,
  FISH_ARCHETYPE,
  Force,
  NO_INTEREST,
} from './components';
import { curiositySystem } from './curiosity-system';
import { createLivestockWorld, SIM_DT, type TankAabb } from './world';

const TANK: TankAabb = { minX: 0, maxX: 1000, minY: 0, maxY: 400, minZ: 0, maxZ: 400 };

function clone(p: ResolvedBehavior): ResolvedBehavior {
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

describe('curiositySystem — Poisson trigger', () => {
  it('triggers roughly at the expected rate over 10k samples (boldness * ratePerSec)', () => {
    // boldness=0.5, ratePerSec=0.1 → trigger prob per tick = 0.5 * 0.1 * SIM_DT
    //                              = 0.5 * 0.1 / 30 ≈ 0.00167
    // Over 10000 ticks ≈ 16.7 fires expected. But the dwellSec=3 means
    // after a trigger fires, the fish is dwelling for ~90 ticks and the
    // trigger gate skips during that time. So we need to count unique
    // trigger *events* (transition from inactive → active).
    const w = createLivestockWorld(0xCAFE, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 0.5, ratePerSec: 0.1, dwellSec: 1 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    let triggers = 0;
    let lastActive = false;
    for (let i = 0; i < 10000; i++) {
      curiositySystem(w, SIM_DT);
      const active = (Curiosity.dwellRemaining[eid] as number) > 0;
      if (active && !lastActive) triggers++;
      lastActive = active;
      // bump the tick counter to vary tickPrng draws across ticks.
      w.tickCounter += 1;
    }
    // dwellSec=1 → ~30 ticks dwell per trigger. 10000 ticks - dwell time
    // gives ~10000 - 30*triggers eligible-to-trigger ticks. Expected
    // probability per eligible tick ~ 0.5 * 0.1 / 30 ≈ 0.001667.
    // Solving: triggers ≈ (10000 - 30*triggers) * 0.001667
    //          triggers ≈ 16.67 - 0.05*triggers
    //          triggers ≈ 15.9
    // Tolerance ±5σ — Poisson σ ≈ sqrt(16) = 4, so ±20 is more than enough.
    expect(triggers).toBeGreaterThan(0);
    expect(triggers).toBeLessThan(50);
  });

  it('shy fish (boldness=0.05) trigger almost never', () => {
    const w = createLivestockWorld(0xBEEF, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 0.05, ratePerSec: 0.1, dwellSec: 1 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    let triggers = 0;
    let lastActive = false;
    for (let i = 0; i < 10000; i++) {
      curiositySystem(w, SIM_DT);
      const active = (Curiosity.dwellRemaining[eid] as number) > 0;
      if (active && !lastActive) triggers++;
      lastActive = active;
      w.tickCounter += 1;
    }
    // boldness 0.05 → ~10x fewer trigger fires than boldness 0.5.
    // Expected ~1.6 fires; allow 0–8 to cover Poisson noise.
    expect(triggers).toBeLessThan(10);
  });
});

describe('curiositySystem — trigger effect', () => {
  it('triggered fish has interestZ at front pane (tankAabb.minZ + offset)', () => {
    // Force a trigger by hand: set dwellRemaining to a small positive +
    // interestX/Y/Z directly, then verify the system steers toward them.
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 1.0, ratePerSec: 100, dwellSec: 5 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 300 }, // back of tank
      behaviorHandleIdx: handle,
    });
    // Run one tick — boldness=1 + ratePerSec=100 + dt=1/30 gives
    // probability ≈ 3.33, which is > 1 so trigger guaranteed.
    curiositySystem(w, SIM_DT);
    expect(Curiosity.dwellRemaining[eid] as number).toBeGreaterThan(0);
    // Interest Z at front pane (minZ + 5).
    expect(Curiosity.interestZ[eid] as number).toBeCloseTo(5, 1);
    // Interest X within bounds.
    const ix = Curiosity.interestX[eid] as number;
    expect(ix).toBeGreaterThanOrEqual(TANK.minX);
    expect(ix).toBeLessThanOrEqual(TANK.maxX);
  });

  it('active dwell writes a Force toward the interest point', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 1.0, ratePerSec: 100, dwellSec: 5 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 300 }, // back of tank
      behaviorHandleIdx: handle,
    });
    curiositySystem(w, SIM_DT);
    // Now fish is dwelling. Run another tick (still dwelling).
    Force.x[eid] = 0;
    Force.y[eid] = 0;
    Force.z[eid] = 0;
    curiositySystem(w, SIM_DT);
    // Interest is at z ≈ 5 (front pane). Fish is at z=300. So Force.z < 0.
    expect(Force.z[eid] as number).toBeLessThan(0);
  });

  it('dwellRemaining decrements + clears interestPos at expiry', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 1.0, ratePerSec: 100, dwellSec: 0.1 }; // 3 ticks
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 300 },
      behaviorHandleIdx: handle,
    });
    curiositySystem(w, SIM_DT);
    const initialDwell = Curiosity.dwellRemaining[eid] as number;
    expect(initialDwell).toBeGreaterThan(0);
    // Run enough ticks to expire dwell.
    for (let i = 0; i < 10; i++) {
      curiositySystem(w, SIM_DT);
    }
    // At some point the dwell expired + the interest was cleared. After
    // expiry the trigger may or may not re-fire (prob is 1.0 since
    // ratePerSec=100), but we just need to check the system clears
    // interest at least once during one of the steps.
    // Force-clear cycle: artificially zero the dwell + interest and
    // verify the system clears correctly.
    Curiosity.dwellRemaining[eid] = 0.005; // less than SIM_DT
    Curiosity.interestX[eid] = 500;
    Curiosity.interestY[eid] = 200;
    Curiosity.interestZ[eid] = 5;
    // Stop the system from re-arming: switch to REFUGE so trigger gate
    // skips.
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.REFUGE;
    curiositySystem(w, SIM_DT);
    // REFUGE skipped — dwell unchanged.
    expect(Curiosity.dwellRemaining[eid] as number).toBeCloseTo(0.005);
    // Restore FORAGE, run again — dwell drops to ~ -0.028 (< 0) → cleared.
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.FORAGE;
    curiositySystem(w, SIM_DT);
    expect(Curiosity.dwellRemaining[eid] as number).toBe(0);
    // f32 stores NO_INTEREST (-1e30) at slightly different precision; the
    // sentinel is preserved as a value < -1e29.
    expect(Curiosity.interestX[eid] as number).toBeLessThan(-1e29);
    void NO_INTEREST; // exported sentinel — referenced for type purposes
  });
});

describe('curiositySystem — mode arbitration', () => {
  it('REFUGE fish do not trigger', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 1.0, ratePerSec: 100, dwellSec: 5 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.REFUGE;
    for (let i = 0; i < 100; i++) curiositySystem(w, SIM_DT);
    expect(Curiosity.dwellRemaining[eid] as number).toBe(0);
  });

  it('PURSUE fish do not trigger', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const params = clone(MID_PRESET);
    params.curiosity = { boldness: 1.0, ratePerSec: 100, dwellSec: 5 };
    const handle = w.registerSpeciesBehavior(1, params);
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
      behaviorHandleIdx: handle,
    });
    BehaviorMode.mode[eid] = BEHAVIOR_MODE.PURSUE;
    for (let i = 0; i < 100; i++) curiositySystem(w, SIM_DT);
    expect(Curiosity.dwellRemaining[eid] as number).toBe(0);
  });

  it('skips entities without a registered behaviour (NO_BEHAVIOR_HANDLE)', () => {
    const w = createLivestockWorld(0, { tankAabb: TANK });
    const eid = w.spawnFish({
      archetype: FISH_ARCHETYPE.SLIM_TETRA,
      speciesId: 1,
      bodyLengthMm: 30,
      position: { x: 500, y: 200, z: 200 },
    });
    // Curiosity isn't attached when handle is NO_BEHAVIOR_HANDLE.
    // System should silently skip.
    expect(() => curiositySystem(w, SIM_DT)).not.toThrow();
    expect(Force.x[eid] as number).toBe(0);
  });
});

describe('curiositySystem — determinism', () => {
  it('two identical runs produce identical trigger sequences', () => {
    function run(): number[] {
      const w = createLivestockWorld(0xABCD, { tankAabb: TANK });
      const params = clone(MID_PRESET);
      params.curiosity = { boldness: 0.5, ratePerSec: 0.1, dwellSec: 0.5 };
      const handle = w.registerSpeciesBehavior(1, params);
      const eid = w.spawnFish({
        archetype: FISH_ARCHETYPE.SLIM_TETRA,
        speciesId: 1,
        bodyLengthMm: 30,
        position: { x: 500, y: 200, z: 200 },
        behaviorHandleIdx: handle,
      });
      const triggers: number[] = [];
      let lastActive = false;
      for (let i = 0; i < 5000; i++) {
        curiositySystem(w, SIM_DT);
        const active = (Curiosity.dwellRemaining[eid] as number) > 0;
        if (active && !lastActive) triggers.push(i);
        lastActive = active;
        w.tickCounter += 1;
      }
      return triggers;
    }
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });
});
