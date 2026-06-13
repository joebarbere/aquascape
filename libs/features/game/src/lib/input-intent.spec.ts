import {
  DEFAULT_KEY_BINDINGS,
  NEUTRAL_INTENT,
  type HeldControls,
  heldControlsToIntent,
  intentToVelocity,
  keysToHeldControls,
  keysToIntent,
} from './input-intent';

const ALL_FALSE: HeldControls = {
  left: false,
  right: false,
  up: false,
  down: false,
  forward: false,
  back: false,
  primary: false,
  secondary: false,
  pause: false,
};

describe('keysToHeldControls', () => {
  it('maps WASD codes to logical controls', () => {
    const held = keysToHeldControls(new Set(['KeyW', 'KeyD']));
    expect(held.up).toBe(true);
    expect(held.right).toBe(true);
    expect(held.down).toBe(false);
    expect(held.left).toBe(false);
  });

  it('maps arrow keys as movement aliases', () => {
    const held = keysToHeldControls(new Set(['ArrowLeft', 'ArrowUp']));
    expect(held.left).toBe(true);
    expect(held.up).toBe(true);
  });

  it('maps depth + action + pause codes', () => {
    const held = keysToHeldControls(new Set(['KeyE', 'Space', 'ShiftLeft', 'Escape']));
    expect(held.forward).toBe(true);
    expect(held.primary).toBe(true);
    expect(held.secondary).toBe(true);
    expect(held.pause).toBe(true);
  });

  it('returns all-false for an empty set', () => {
    expect(keysToHeldControls(new Set())).toEqual(ALL_FALSE);
  });

  it('honours a custom binding map', () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS, primary: ['Enter'] as readonly string[] };
    expect(keysToHeldControls(new Set(['Enter']), bindings).primary).toBe(true);
    expect(keysToHeldControls(new Set(['Space']), bindings).primary).toBe(false);
  });
});

describe('heldControlsToIntent', () => {
  it('builds the move vector from opposed axes', () => {
    const intent = heldControlsToIntent({ ...ALL_FALSE, right: true, up: true, forward: true });
    expect(intent.move).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('cancels opposed controls to zero (no jitter)', () => {
    const intent = heldControlsToIntent({ ...ALL_FALSE, left: true, right: true });
    expect(intent.move.x).toBe(0);
  });

  it('maps negative directions', () => {
    const intent = heldControlsToIntent({ ...ALL_FALSE, left: true, down: true, back: true });
    expect(intent.move).toEqual({ x: -1, y: -1, z: -1 });
  });

  it('passes action flags through', () => {
    const intent = heldControlsToIntent({ ...ALL_FALSE, primary: true, pause: true });
    expect(intent.actions.primary).toBe(true);
    expect(intent.actions.secondary).toBe(false);
    expect(intent.actions.pause).toBe(true);
  });
});

describe('keysToIntent', () => {
  it('keyboard codes map to the same intent shape a gamepad would produce', () => {
    const intent = keysToIntent(new Set(['KeyD', 'KeyW']));
    expect(intent.move).toEqual({ x: 1, y: 1, z: 0 });
  });

  it('an empty set is the neutral intent', () => {
    expect(keysToIntent(new Set())).toEqual(NEUTRAL_INTENT);
  });
});

describe('intentToVelocity (input → velocity mapping)', () => {
  it('scales a cardinal move by the speed', () => {
    const v = intentToVelocity({ ...NEUTRAL_INTENT, move: { x: 1, y: 0, z: 0 } }, 200);
    expect(v).toEqual({ x: 200, y: 0, z: 0 });
  });

  it('a zero move yields zero velocity (direct stop)', () => {
    expect(intentToVelocity(NEUTRAL_INTENT, 200)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('clamps diagonal magnitude so it is not faster than a cardinal', () => {
    const v = intentToVelocity({ ...NEUTRAL_INTENT, move: { x: 1, y: 1, z: 0 } }, 200);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(200, 4);
    // Components are equal + each ~ 200/√2.
    expect(v.x).toBeCloseTo(200 / Math.SQRT2, 4);
    expect(v.y).toBeCloseTo(200 / Math.SQRT2, 4);
  });

  it('respects an analogue (sub-1) magnitude as a throttle', () => {
    const v = intentToVelocity({ ...NEUTRAL_INTENT, move: { x: 0.5, y: 0, z: 0 } }, 200);
    expect(v.x).toBeCloseTo(100, 4);
  });

  it('keyboard intent → velocity round-trips through the same mapper a gamepad would use', () => {
    const intent = keysToIntent(new Set(['KeyD']));
    expect(intentToVelocity(intent, 150)).toEqual({ x: 150, y: 0, z: 0 });
  });
});
