/**
 * F13.3 preview-time / tank-param adapter tests. Covers the editor driver's
 * determinism (same seed + week ⇒ same state), the persisted-snapshot lift,
 * backward-scrub clamping, and the water-volume derivation.
 */

import type { Scene, Tank, WaterChemistry } from '@aquascape/domain/scene-model';

import {
  ENGINE_VERSION,
  freshWaterState,
  simulateChemistry,
  type WaterState,
} from './chemistry';
import { cycleProgress } from './cycle';
import {
  DEFAULT_KH_DKH,
  DEFAULT_TEMPERATURE_C,
  evaluateChemistryAtWeek,
  evaluateSceneChemistryAtWeek,
  initialWaterState,
  waterParamsFromTank,
} from './preview';

function tank(overrides: Partial<Tank> = {}): Tank {
  return {
    width: 600,
    height: 400,
    depth: 400,
    style: { frame: 'rimless', background: { kind: 'none' } },
    ...overrides,
  } as Tank;
}

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    tank: tank(),
    substrate: { regions: [] },
    layers: [],
    seed: 12345,
    ...overrides,
  } as Scene;
}

describe('waterParamsFromTank', () => {
  it('derives water volume at the effective fill line (default fill)', () => {
    // 600 × 400 × (400 − 25 default gap) mm³ → litres.
    const p = waterParamsFromTank(tank());
    expect(p.volumeLitres).toBeCloseTo((600 * 400 * 375) / 1_000_000, 6);
    expect(p.kh).toBe(DEFAULT_KH_DKH);
    expect(p.temperatureC).toBe(DEFAULT_TEMPERATURE_C);
  });

  it('honours an explicit waterLevelMm', () => {
    const p = waterParamsFromTank(tank({ waterLevelMm: 200 }));
    expect(p.volumeLitres).toBeCloseTo((600 * 400 * 200) / 1_000_000, 6);
  });

  it('floors volume at 1 litre for a degenerate tank', () => {
    const p = waterParamsFromTank(tank({ width: 1, height: 2, depth: 1 }));
    expect(p.volumeLitres).toBeGreaterThanOrEqual(1);
  });
});

describe('initialWaterState', () => {
  it('returns a fresh uncycled state when no snapshot is persisted', () => {
    expect(initialWaterState(undefined)).toEqual(freshWaterState());
  });

  it('lifts a persisted snapshot field-for-field', () => {
    const snap: WaterChemistry = {
      chemistry: {
        ammonia: 1.2,
        nitrite: 0.4,
        nitrate: 12,
        ph: 7.1,
        aobColony: 3,
        nobColony: 2,
        ageWeeks: 4,
        engineVersion: ENGINE_VERSION,
      },
      cycle: 'cycling',
    };
    const s = initialWaterState(snap);
    expect(s.ammonia).toBe(1.2);
    expect(s.nitrate).toBe(12);
    expect(s.aobColony).toBe(3);
    expect(s.ageWeeks).toBe(4);
    expect(s.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe('evaluateChemistryAtWeek', () => {
  const params = waterParamsFromTank(tank());
  const initial = freshWaterState();

  it('is deterministic — same seed + week ⇒ identical state', () => {
    const a = evaluateChemistryAtWeek(params, initial, 6, 5, 999);
    const b = evaluateChemistryAtWeek(params, initial, 6, 5, 999);
    expect(a).toEqual(b);
  });

  it('agrees with a direct simulateChemistry call over the elapsed span', () => {
    const viaPreview = evaluateChemistryAtWeek(params, initial, 6, 5, 999);
    const direct = simulateChemistry(params, initial, 6, 5, 999);
    expect(viaPreview).toEqual(direct);
  });

  it('clamps a backward scrub below the persisted age to the initial state', () => {
    const aged: WaterState = { ...freshWaterState(), ageWeeks: 8 };
    const result = evaluateChemistryAtWeek(params, aged, 3, 5, 1);
    expect(result.ageWeeks).toBe(8);
    expect(result.engineVersion).toBe(ENGINE_VERSION);
  });

  it('treats a non-finite target week as 0 (identity from initial)', () => {
    const aged: WaterState = { ...freshWaterState(), ageWeeks: 2, nitrate: 5 };
    const result = evaluateChemistryAtWeek(params, aged, Number.NaN, 5, 1);
    expect(result.ageWeeks).toBe(2);
    expect(result.nitrate).toBe(5);
  });

  it('treats a non-finite initial age as 0 when computing elapsed', () => {
    const bad: WaterState = { ...freshWaterState(), ageWeeks: Number.NaN };
    const result = evaluateChemistryAtWeek(params, bad, 2, 5, 1);
    // Elapsed = 2 − 0 = 2 → advances; ageWeeks lands at ~2 (initial NaN → 0).
    expect(result.ageWeeks).toBeCloseTo(2, 4);
  });

  it('drives the cycle forward: uncycled at first, cycled later, nitrate accumulating', () => {
    // A continuously-stocked tank (constant source) establishes its filter
    // and is NOT a dosed fishless cycle — it cycles quickly (see the
    // water-sim caveat). Assert the SHAPE the editor surfaces: early in the
    // run it reads not-yet-cycled, later it reads cycled, and nitrate climbs
    // monotonically (the husbandry signal the model never removes).
    const early = evaluateChemistryAtWeek(params, initial, 0.25, 5, 42);
    const late = evaluateChemistryAtWeek(params, initial, 8, 5, 42);
    expect(cycleProgress(early)).not.toBe('cycled');
    expect(cycleProgress(late)).toBe('cycled');
    // Nitrate accumulates over the run (the husbandry signal).
    expect(late.nitrate).toBeGreaterThan(early.nitrate);
  });
});

describe('evaluateSceneChemistryAtWeek', () => {
  it('derives params + initial from the scene', () => {
    const s = scene();
    const viaScene = evaluateSceneChemistryAtWeek(s, 4, 5);
    const explicit = evaluateChemistryAtWeek(
      waterParamsFromTank(s.tank),
      initialWaterState(s.tank.waterChemistry),
      4,
      5,
      s.seed,
    );
    expect(viaScene).toEqual(explicit);
  });

  it('resumes from a persisted snapshot when present', () => {
    const snap: WaterChemistry = {
      chemistry: {
        ammonia: 0,
        nitrite: 0,
        nitrate: 30,
        ph: 7,
        aobColony: 5,
        nobColony: 5,
        ageWeeks: 6,
        engineVersion: ENGINE_VERSION,
      },
      cycle: 'cycled',
    };
    const s = scene({ tank: tank({ waterChemistry: snap }) });
    // Scrub to week 10 → advances 4 weeks from the persisted age-6 state.
    const result = evaluateSceneChemistryAtWeek(s, 10, 5);
    expect(result.ageWeeks).toBeCloseTo(10, 4);
    // Nitrate keeps climbing from the persisted 30 (no water change here).
    expect(result.nitrate).toBeGreaterThanOrEqual(30);
  });
});
