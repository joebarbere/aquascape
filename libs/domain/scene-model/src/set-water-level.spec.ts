/**
 * Tests for `SetWaterLevelCommand` — apply validation (range / finiteness /
 * rounding), the null-clears semantics, invert round-trip, lock-guard
 * exemption, and the `effectiveWaterLevelMm` selector it feeds.
 */

import fc from 'fast-check';

import { applyCommand, invertCommand, setLayerLocked, setWaterLevel } from './commands';
import type { Command } from './commands';
import {
  DEFAULT_WATER_GAP_BELOW_RIM_MM,
  effectiveWaterLevelMm,
} from './selectors';
import { makeScene } from './test-fixtures';
import type { Scene } from './types';

function applyOk(scene: Scene, cmd: Command): Scene {
  const r = applyCommand(scene, cmd);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r.scene;
}

describe('SetWaterLevelCommand — apply', () => {
  it('sets tank.waterLevelMm, rounded to integer mm', () => {
    const scene = makeScene();
    const next = applyOk(scene, setWaterLevel(150.4));
    expect(next.tank.waterLevelMm).toBe(150);
    // Original scene untouched (apply is pure).
    expect(scene.tank.waterLevelMm).toBeUndefined();
  });

  it('null clears the field entirely (document stays minimal)', () => {
    const scene = applyOk(makeScene(), setWaterLevel(180));
    const cleared = applyOk(scene, setWaterLevel(null));
    expect('waterLevelMm' in cleared.tank).toBe(false);
  });

  it('rejects non-finite and out-of-range values', () => {
    const scene = makeScene();
    const h = scene.tank.height;
    for (const bad of [Number.NaN, Infinity, -Infinity, 0, -5, h + 1]) {
      const r = applyCommand(scene, setWaterLevel(bad));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid');
    }
    // Boundary values are accepted.
    expect(applyOk(scene, setWaterLevel(1)).tank.waterLevelMm).toBe(1);
    expect(applyOk(scene, setWaterLevel(h)).tank.waterLevelMm).toBe(h);
  });

  it('is a structural global op — NOT blocked by locked layers', () => {
    let scene = makeScene();
    for (const layer of scene.layers) {
      scene = applyOk(scene, setLayerLocked(layer.id, true));
    }
    const next = applyOk(scene, setWaterLevel(200));
    expect(next.tank.waterLevelMm).toBe(200);
  });
});

describe('SetWaterLevelCommand — invert', () => {
  it('apply ∘ invert = id, from unset and from set', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 1, max: makeScene().tank.height }), { nil: undefined }),
        fc.integer({ min: 1, max: makeScene().tank.height }),
        (initial, next) => {
          let scene = makeScene();
          if (initial !== undefined) scene = applyOk(scene, setWaterLevel(initial));
          const cmd = setWaterLevel(next);
          const inverse = invertCommand(scene, cmd);
          const after = applyOk(scene, cmd);
          const restored = applyOk(after, inverse);
          expect(restored.tank.waterLevelMm).toEqual(scene.tank.waterLevelMm);
        },
      ),
    );
  });

  it('inverse carries the would-be-applied value for inverse-of-inverse', () => {
    const scene = applyOk(makeScene(), setWaterLevel(150));
    const cmd = setWaterLevel(280);
    const inverse = invertCommand(scene, cmd);
    expect(inverse).toEqual({
      kind: 'SetWaterLevel',
      waterLevelMm: 150,
      inverse: { previousWaterLevelMm: 280 },
    });
    // From-unset state inverts to null (clear).
    const inverse2 = invertCommand(makeScene(), cmd);
    expect(inverse2).toMatchObject({ kind: 'SetWaterLevel', waterLevelMm: null });
  });

  it('commands are JSON-serializable', () => {
    const cmd = setWaterLevel(123);
    expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    const clear = setWaterLevel(null);
    expect(JSON.parse(JSON.stringify(clear))).toEqual(clear);
  });
});

describe('effectiveWaterLevelMm', () => {
  it('derives the default fill when unset', () => {
    const scene = makeScene();
    expect(effectiveWaterLevelMm(scene.tank)).toBe(
      Math.max(1, scene.tank.height - DEFAULT_WATER_GAP_BELOW_RIM_MM),
    );
  });

  it('returns the authored level when set', () => {
    const scene = applyOk(makeScene(), setWaterLevel(111));
    expect(effectiveWaterLevelMm(scene.tank)).toBe(111);
  });

  it('clamps a stale authored level after a tank shrink', () => {
    const scene = applyOk(makeScene(), setWaterLevel(210));
    // Simulate a shrink that SetTankDimensions doesn't rewrite the level for.
    const shrunk: Scene = { ...scene, tank: { ...scene.tank, height: 100 } };
    expect(effectiveWaterLevelMm(shrunk.tank)).toBe(100);
  });

  it('floors the default at 1 for degenerate tiny tanks', () => {
    const scene = makeScene();
    const tiny = { ...scene.tank, height: 10 };
    expect(effectiveWaterLevelMm(tiny)).toBe(1);
  });
});
