import {
  DEFAULT_FEEDING_PARAMS,
  FEEDING_MAX_FILL,
  applyBites,
  detectEaten,
  drainFill,
  evaluateFeedingOutcome,
  feedingTimeRemainingSec,
  type FeedingRuleParams,
  type FoodCandidate,
} from './feeding-rules';

const PARAMS: FeedingRuleParams = {
  eatRadiusMm: 100,
  fillPerBite: 0.2,
  drainPerSec: 0.1,
  targetFill: 0.8,
  timeLimitSec: 30,
  scorePerBite: 1,
  overeatPenalty: 1,
};

describe('detectEaten', () => {
  const player = { x: 0, y: 0, z: 0 };

  it('eats food inside the radius (boundary inclusive)', () => {
    const food: FoodCandidate[] = [
      { id: 1, x: 50, y: 0, z: 0 }, // 50  → eaten
      { id: 2, x: 100, y: 0, z: 0 }, // 100 → eaten (boundary)
      { id: 3, x: 101, y: 0, z: 0 }, // 101 → missed
    ];
    expect(detectEaten(player, food, 100)).toEqual([1, 2]);
  });

  it('returns ids in input order', () => {
    const food: FoodCandidate[] = [
      { id: 9, x: 10, y: 0, z: 0 },
      { id: 4, x: 20, y: 0, z: 0 },
    ];
    expect(detectEaten(player, food, 100)).toEqual([9, 4]);
  });

  it('returns empty for no food', () => {
    expect(detectEaten(player, [], 100)).toEqual([]);
  });
});

describe('applyBites', () => {
  it('fills the meter + scores per bite while there is headroom', () => {
    const res = applyBites(0, 3, PARAMS); // 0 → 0.6, +3
    expect(res.fill).toBeCloseTo(0.6);
    expect(res.scoreDelta).toBe(3);
  });

  it('clamps the meter at full + penalises overflow bites (gorging)', () => {
    // From 0.9: one bite tops to 1.0 (+1), the next two gorge (-1 each).
    const res = applyBites(0.9, 3, PARAMS);
    expect(res.fill).toBe(FEEDING_MAX_FILL);
    expect(res.scoreDelta).toBe(1 - 1 - 1); // +1 headroom, -2 gorge
  });

  it('is a no-op for zero bites', () => {
    expect(applyBites(0.4, 0, PARAMS)).toEqual({ fill: 0.4, scoreDelta: 0 });
  });
});

describe('drainFill', () => {
  it('drains over time, clamped at 0', () => {
    expect(drainFill(0.5, 1, PARAMS)).toBeCloseTo(0.4);
    expect(drainFill(0.05, 1, PARAMS)).toBe(0); // would go negative → 0
  });
});

describe('evaluateFeedingOutcome', () => {
  it('is ongoing (null) below target, with health, before the clock', () => {
    expect(evaluateFeedingOutcome(0, 1, 0, PARAMS)).toBeNull();
    expect(evaluateFeedingOutcome(0.7, 0.5, 29.9, PARAMS)).toBeNull();
  });

  it('wins on reaching the target fill (even with time left)', () => {
    expect(evaluateFeedingOutcome(0.8, 1, 5, PARAMS)).toBe('won');
    expect(evaluateFeedingOutcome(0.9, 0.2, 5, PARAMS)).toBe('won');
  });

  it('loses on health 0 (starved)', () => {
    expect(evaluateFeedingOutcome(0.3, 0, 5, PARAMS)).toBe('lost');
  });

  it('loses when the clock expires below target', () => {
    expect(evaluateFeedingOutcome(0.5, 1, 30, PARAMS)).toBe('lost');
  });

  it('target reached AT the time limit still wins (target check first)', () => {
    expect(evaluateFeedingOutcome(0.8, 1, 30, PARAMS)).toBe('won');
  });
});

describe('feedingTimeRemainingSec', () => {
  it('counts down and clamps at zero', () => {
    expect(feedingTimeRemainingSec(0, PARAMS)).toBe(30);
    expect(feedingTimeRemainingSec(10.2, PARAMS)).toBe(20);
    expect(feedingTimeRemainingSec(40, PARAMS)).toBe(0);
  });
});

describe('DEFAULT_FEEDING_PARAMS', () => {
  it('has a reachable target and a penalising overeat', () => {
    expect(DEFAULT_FEEDING_PARAMS.targetFill).toBeGreaterThan(0);
    expect(DEFAULT_FEEDING_PARAMS.targetFill).toBeLessThanOrEqual(1);
    expect(DEFAULT_FEEDING_PARAMS.overeatPenalty).toBeGreaterThan(0);
  });
});
