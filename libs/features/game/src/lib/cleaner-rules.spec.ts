import {
  DEFAULT_CLEANER_PARAMS,
  cleanerTimeRemainingSec,
  cleanlinessFraction,
  cleanlinessScore,
  evaluateCleanerOutcome,
  raspAmountPerType,
  surfacesInReach,
  toolAlgaeTargets,
  type CleanerRuleParams,
  type CleanerToolProfile,
  type SurfaceCandidate,
} from './cleaner-rules';

const PARAMS: CleanerRuleParams = {
  reachMm: 100,
  cleanTargetTotal: 0.5,
  timeLimitSec: 30,
  wasteDrainPerSec: 0.05,
};

const SCRAPER: CleanerToolProfile = {
  type: 'scraper',
  targetAlgae: ['green-spot', 'diatom'],
  surfaces: ['glass'],
  effectiveness: 0.9,
  removesWaste: false,
};

const BRUSH: CleanerToolProfile = {
  type: 'brush',
  targetAlgae: ['black-beard', 'hair'],
  surfaces: ['hardscape'],
  effectiveness: 0.55,
  removesWaste: false,
};

const SIPHON: CleanerToolProfile = {
  type: 'siphon',
  targetAlgae: ['diatom'],
  surfaces: ['substrate'],
  effectiveness: 0.7,
  removesWaste: true,
};

describe('surfacesInReach', () => {
  const player = { x: 0, y: 0, z: 0 };

  it('returns surfaces inside the reach radius (boundary inclusive)', () => {
    const surfaces: SurfaceCandidate[] = [
      { id: 1, x: 50, y: 0, z: 0 }, // 50  → in
      { id: 2, x: 100, y: 0, z: 0 }, // 100 → in (boundary)
      { id: 3, x: 101, y: 0, z: 0 }, // 101 → out
    ];
    expect(surfacesInReach(player, surfaces, 100)).toEqual([1, 2]);
  });

  it('returns ids in input order; empty for no surfaces', () => {
    const surfaces: SurfaceCandidate[] = [
      { id: 8, x: 10, y: 0, z: 0 },
      { id: 3, x: 20, y: 0, z: 0 },
    ];
    expect(surfacesInReach(player, surfaces, 100)).toEqual([8, 3]);
    expect(surfacesInReach(player, [], 100)).toEqual([]);
  });

  it('measures distance in 3D', () => {
    // (50,50,50) → ~86.6 < 100 → in.
    expect(surfacesInReach(player, [{ id: 1, x: 50, y: 50, z: 50 }], 100)).toEqual([1]);
    // (60,60,60) → ~103.9 > 100 → out.
    expect(surfacesInReach(player, [{ id: 1, x: 60, y: 60, z: 60 }], 100)).toEqual([]);
  });
});

describe('toolAlgaeTargets', () => {
  it('a glass scraper targets its listed algae', () => {
    expect(toolAlgaeTargets(SCRAPER)).toEqual(['green-spot', 'diatom']);
  });

  it('a hardscape brush targets its listed algae', () => {
    expect(toolAlgaeTargets(BRUSH)).toEqual(['black-beard', 'hair']);
  });

  it('a substrate-only siphon scrapes NO algae (it removes waste, not algae)', () => {
    expect(toolAlgaeTargets(SIPHON)).toEqual([]);
  });

  it('a tool that reaches glass OR hardscape scrapes; pure-substrate does not', () => {
    const both: CleanerToolProfile = { ...SCRAPER, surfaces: ['glass', 'hardscape'] };
    expect(toolAlgaeTargets(both)).toEqual(['green-spot', 'diatom']);
  });
});

describe('raspAmountPerType', () => {
  it('scales the per-frame rasp by effectiveness × dt', () => {
    expect(raspAmountPerType(SCRAPER, 0.1)).toBeCloseTo(0.09);
    expect(raspAmountPerType(BRUSH, 0.1)).toBeCloseTo(0.055);
  });

  it('is zero for a non-positive dt', () => {
    expect(raspAmountPerType(SCRAPER, 0)).toBe(0);
    expect(raspAmountPerType(SCRAPER, -1)).toBe(0);
  });

  it('a higher-effectiveness tool rasps faster', () => {
    expect(raspAmountPerType(SCRAPER, 1)).toBeGreaterThan(raspAmountPerType(BRUSH, 1));
  });
});

describe('cleanlinessFraction', () => {
  it('is 1 (spotless) at zero total and 0 at the full reference load', () => {
    expect(cleanlinessFraction(0, 4)).toBe(1);
    expect(cleanlinessFraction(4, 4)).toBe(0);
  });

  it('is linear in between', () => {
    expect(cleanlinessFraction(2, 4)).toBeCloseTo(0.5);
    expect(cleanlinessFraction(1, 4)).toBeCloseTo(0.75);
  });

  it('clamps to [0,1] beyond the reference and treats a zero reference as clean', () => {
    expect(cleanlinessFraction(8, 4)).toBe(0);
    expect(cleanlinessFraction(0, 0)).toBe(1);
  });
});

describe('cleanlinessScore', () => {
  it('maps a fraction to a rounded 0–100 percent', () => {
    expect(cleanlinessScore(0)).toBe(0);
    expect(cleanlinessScore(1)).toBe(100);
    expect(cleanlinessScore(0.5)).toBe(50);
    expect(cleanlinessScore(0.754)).toBe(75);
  });

  it('clamps out-of-range fractions', () => {
    expect(cleanlinessScore(-0.2)).toBe(0);
    expect(cleanlinessScore(1.4)).toBe(100);
  });
});

describe('evaluateCleanerOutcome', () => {
  it('is ongoing (null) above the target before the clock expires', () => {
    expect(evaluateCleanerOutcome(2, 0, PARAMS)).toBeNull();
    expect(evaluateCleanerOutcome(0.6, 29.9, PARAMS)).toBeNull();
  });

  it('wins immediately once the tank is clean enough (total at/below target)', () => {
    expect(evaluateCleanerOutcome(0.5, 5, PARAMS)).toBe('won');
    expect(evaluateCleanerOutcome(0.1, 5, PARAMS)).toBe('won');
  });

  it('loses when the clock expires while still dirty', () => {
    expect(evaluateCleanerOutcome(1, 30, PARAMS)).toBe('lost');
    expect(evaluateCleanerOutcome(2, 45, PARAMS)).toBe('lost');
  });

  it('clean AT the time limit still wins (clean check first)', () => {
    expect(evaluateCleanerOutcome(0.3, 30, PARAMS)).toBe('won');
  });
});

describe('cleanerTimeRemainingSec', () => {
  it('counts down and clamps at zero', () => {
    expect(cleanerTimeRemainingSec(0, PARAMS)).toBe(30);
    expect(cleanerTimeRemainingSec(10.2, PARAMS)).toBe(20); // ceil(19.8)
    expect(cleanerTimeRemainingSec(30, PARAMS)).toBe(0);
    expect(cleanerTimeRemainingSec(45, PARAMS)).toBe(0);
  });
});

describe('DEFAULT_CLEANER_PARAMS', () => {
  it('is a brisk-but-achievable scrub-down (positive reach / target / clock)', () => {
    expect(DEFAULT_CLEANER_PARAMS.reachMm).toBeGreaterThan(0);
    expect(DEFAULT_CLEANER_PARAMS.cleanTargetTotal).toBeGreaterThan(0);
    expect(DEFAULT_CLEANER_PARAMS.timeLimitSec).toBe(90);
    expect(DEFAULT_CLEANER_PARAMS.wasteDrainPerSec).toBeGreaterThan(0);
  });
});
