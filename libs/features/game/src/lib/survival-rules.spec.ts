import {
  DEFAULT_SURVIVAL_PARAMS,
  SURVIVAL_MAX_STAMINA,
  anyWithin,
  evaluateSurvivalOutcome,
  isCaught,
  isThreatened,
  stepStamina,
  survivalScoreFor,
  survivalTimeRemainingSec,
  type PredatorCandidate,
  type SurvivalRuleParams,
} from './survival-rules';

const PARAMS: SurvivalRuleParams = {
  catchRadiusMm: 100,
  threatRadiusMm: 300,
  staminaDrainPerSec: 0.5,
  staminaRecoverPerSec: 0.25,
  timeLimitSec: 30,
};

const player = { x: 0, y: 0, z: 0 };

describe('anyWithin / isCaught / isThreatened', () => {
  it('detects a predator inside the radius (boundary inclusive)', () => {
    const preds: PredatorCandidate[] = [{ id: 1, x: 100, y: 0, z: 0 }];
    expect(anyWithin(player, preds, 100)).toBe(true);
    expect(anyWithin(player, preds, 99)).toBe(false);
  });

  it('measures distance in 3D', () => {
    // (60,60,60) → ~103.9 > 100 → not caught; threat radius 300 → threatened.
    const preds: PredatorCandidate[] = [{ id: 1, x: 60, y: 60, z: 60 }];
    expect(isCaught(player, preds, PARAMS)).toBe(false);
    expect(isThreatened(player, preds, PARAMS)).toBe(true);
  });

  it('caught requires a predator inside the (tighter) catch radius', () => {
    const near: PredatorCandidate[] = [{ id: 1, x: 80, y: 0, z: 0 }];
    const mid: PredatorCandidate[] = [{ id: 2, x: 200, y: 0, z: 0 }];
    expect(isCaught(player, near, PARAMS)).toBe(true);
    expect(isCaught(player, mid, PARAMS)).toBe(false);
    expect(isThreatened(player, mid, PARAMS)).toBe(true); // still a threat
  });

  it('is false with no predators', () => {
    expect(isCaught(player, [], PARAMS)).toBe(false);
    expect(isThreatened(player, [], PARAMS)).toBe(false);
  });
});

describe('stepStamina', () => {
  it('drains while threatened, clamped at 0', () => {
    expect(stepStamina(1, true, 1, PARAMS)).toBeCloseTo(0.5);
    expect(stepStamina(0.2, true, 1, PARAMS)).toBe(0); // would go negative → 0
  });

  it('recovers while safe, clamped at the max', () => {
    expect(stepStamina(0.5, false, 1, PARAMS)).toBeCloseTo(0.75);
    expect(stepStamina(0.9, false, 1, PARAMS)).toBe(SURVIVAL_MAX_STAMINA); // clamped
  });

  it('is a no-op for dt 0', () => {
    expect(stepStamina(0.6, true, 0, PARAMS)).toBe(0.6);
  });
});

describe('evaluateSurvivalOutcome', () => {
  it('is ongoing (null) while alive, safe, and before the clock', () => {
    expect(evaluateSurvivalOutcome(false, 1, 1, 0, PARAMS)).toBeNull();
    expect(evaluateSurvivalOutcome(false, 0.5, 0.5, 29.9, PARAMS)).toBeNull();
  });

  it('loses on caught (even at the buzzer)', () => {
    expect(evaluateSurvivalOutcome(true, 1, 1, 5, PARAMS)).toBe('lost');
    expect(evaluateSurvivalOutcome(true, 1, 1, 30, PARAMS)).toBe('lost');
  });

  it('loses on health 0', () => {
    expect(evaluateSurvivalOutcome(false, 0, 1, 5, PARAMS)).toBe('lost');
  });

  it('loses on stamina 0', () => {
    expect(evaluateSurvivalOutcome(false, 1, 0, 5, PARAMS)).toBe('lost');
  });

  it('wins on surviving to the time limit', () => {
    expect(evaluateSurvivalOutcome(false, 1, 1, 30, PARAMS)).toBe('won');
    expect(evaluateSurvivalOutcome(false, 0.3, 0.1, 31, PARAMS)).toBe('won');
  });
});

describe('survivalTimeRemainingSec', () => {
  it('counts down and clamps at zero', () => {
    expect(survivalTimeRemainingSec(0, PARAMS)).toBe(30);
    expect(survivalTimeRemainingSec(10.2, PARAMS)).toBe(20); // ceil(19.8)
    expect(survivalTimeRemainingSec(30, PARAMS)).toBe(0);
    expect(survivalTimeRemainingSec(45, PARAMS)).toBe(0);
  });
});

describe('survivalScoreFor', () => {
  it('is the whole seconds survived', () => {
    expect(survivalScoreFor(0)).toBe(0);
    expect(survivalScoreFor(4.9)).toBe(4);
    expect(survivalScoreFor(30)).toBe(30);
  });
});

describe('DEFAULT_SURVIVAL_PARAMS', () => {
  it('matches the survival framing (threat wider than catch; positive clock)', () => {
    expect(DEFAULT_SURVIVAL_PARAMS.threatRadiusMm).toBeGreaterThan(
      DEFAULT_SURVIVAL_PARAMS.catchRadiusMm,
    );
    expect(DEFAULT_SURVIVAL_PARAMS.timeLimitSec).toBeGreaterThan(0);
  });
});
