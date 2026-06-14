import {
  DEFAULT_PREDATOR_PARAMS,
  detectCatches,
  evaluatePredatorOutcome,
  predatorTimeRemainingSec,
  type PredatorRuleParams,
  type PreyCandidate,
} from './predator-rules';

const PARAMS: PredatorRuleParams = { catchRadiusMm: 100, targetCatches: 3, timeLimitSec: 30 };

describe('detectCatches', () => {
  const player = { x: 0, y: 0, z: 0 };

  it('catches prey inside the radius (boundary inclusive)', () => {
    const prey: PreyCandidate[] = [
      { id: 1, x: 50, y: 0, z: 0 }, // dist 50  → caught
      { id: 2, x: 100, y: 0, z: 0 }, // dist 100 → caught (boundary)
      { id: 3, x: 101, y: 0, z: 0 }, // dist 101 → missed
    ];
    expect(detectCatches(player, prey, 100)).toEqual([1, 2]);
  });

  it('returns ids in input order (deterministic given inputs)', () => {
    const prey: PreyCandidate[] = [
      { id: 7, x: 10, y: 0, z: 0 },
      { id: 4, x: 20, y: 0, z: 0 },
      { id: 9, x: 30, y: 0, z: 0 },
    ];
    expect(detectCatches(player, prey, 100)).toEqual([7, 4, 9]);
  });

  it('measures distance in 3D', () => {
    // (60,60,60) → |d| ≈ 103.9 > 100 → missed.
    const prey: PreyCandidate[] = [{ id: 1, x: 60, y: 60, z: 60 }];
    expect(detectCatches(player, prey, 100)).toEqual([]);
    // (50,50,50) → |d| ≈ 86.6 < 100 → caught.
    expect(detectCatches(player, [{ id: 2, x: 50, y: 50, z: 50 }], 100)).toEqual([2]);
  });

  it('returns empty for no prey', () => {
    expect(detectCatches(player, [], 100)).toEqual([]);
  });
});

describe('evaluatePredatorOutcome', () => {
  it('is ongoing (null) before the target + before the clock expires', () => {
    expect(evaluatePredatorOutcome(0, 0, PARAMS)).toBeNull();
    expect(evaluatePredatorOutcome(2, 29.9, PARAMS)).toBeNull();
  });

  it('wins immediately on reaching the target (even with time left)', () => {
    expect(evaluatePredatorOutcome(3, 5, PARAMS)).toBe('won');
    expect(evaluatePredatorOutcome(4, 5, PARAMS)).toBe('won');
  });

  it('loses when the clock expires below the target', () => {
    expect(evaluatePredatorOutcome(2, 30, PARAMS)).toBe('lost');
    expect(evaluatePredatorOutcome(0, 45, PARAMS)).toBe('lost');
  });

  it('target reached AT the time limit still wins (target check first)', () => {
    expect(evaluatePredatorOutcome(3, 30, PARAMS)).toBe('won');
  });
});

describe('predatorTimeRemainingSec', () => {
  it('counts down and clamps at zero', () => {
    expect(predatorTimeRemainingSec(0, PARAMS)).toBe(30);
    expect(predatorTimeRemainingSec(10.2, PARAMS)).toBe(20); // ceil(19.8)
    expect(predatorTimeRemainingSec(30, PARAMS)).toBe(0);
    expect(predatorTimeRemainingSec(45, PARAMS)).toBe(0);
  });
});

describe('DEFAULT_PREDATOR_PARAMS', () => {
  it('matches the predator descriptor framing (8 catches / 60 s)', () => {
    expect(DEFAULT_PREDATOR_PARAMS.targetCatches).toBe(8);
    expect(DEFAULT_PREDATOR_PARAMS.timeLimitSec).toBe(60);
    expect(DEFAULT_PREDATOR_PARAMS.catchRadiusMm).toBeGreaterThan(0);
  });
});
