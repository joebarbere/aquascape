import { INITIAL_SCORE, awardPoints, tickElapsed } from './scoring';

describe('scoring', () => {
  it('starts at zero', () => {
    expect(INITIAL_SCORE).toEqual({ points: 0, elapsedSec: 0 });
  });

  it('awards points', () => {
    expect(awardPoints(INITIAL_SCORE, 10).points).toBe(10);
    expect(awardPoints({ points: 5, elapsedSec: 3 }, 7).points).toBe(12);
  });

  it('clamps the total at zero on a penalty', () => {
    expect(awardPoints({ points: 3, elapsedSec: 0 }, -10).points).toBe(0);
  });

  it('preserves elapsed time when awarding', () => {
    expect(awardPoints({ points: 0, elapsedSec: 42 }, 5).elapsedSec).toBe(42);
  });

  it('advances elapsed time', () => {
    expect(tickElapsed(INITIAL_SCORE, 0.5).elapsedSec).toBeCloseTo(0.5, 6);
    expect(tickElapsed({ points: 9, elapsedSec: 1 }, 2).elapsedSec).toBe(3);
  });

  it('ignores non-positive dt', () => {
    const s = { points: 0, elapsedSec: 5 };
    expect(tickElapsed(s, 0)).toBe(s);
    expect(tickElapsed(s, -1)).toBe(s);
  });

  it('does not mutate the input', () => {
    const s = { points: 1, elapsedSec: 1 };
    awardPoints(s, 5);
    tickElapsed(s, 5);
    expect(s).toEqual({ points: 1, elapsedSec: 1 });
  });
});
