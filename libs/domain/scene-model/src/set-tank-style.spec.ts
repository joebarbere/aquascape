/**
 * Tests for `SetTankStyleCommand` — apply validation, structural
 * replacement semantics, invert round-trip, and JSON serializability
 * across every `background` variant.
 *
 * Property tests for `apply ∘ invert = id` over an arbitrary `TankStyle`
 * live in `properties.spec.ts` alongside the suite's other invariants;
 * this file owns the hand-written branches.
 */

import fc from 'fast-check';

import { applyCommand, composite, invertCommand, setLayerLocked, setTankStyle } from './commands';
import type { Command, SetTankStyleCommand } from './commands';
import { makeScene } from './test-fixtures';
import type { AssetRef, Scene, TankStyle } from './types';

function applyOk(scene: Scene, cmd: Command): { ok: true; scene: Scene } {
  const r = applyCommand(scene, cmd);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
}

// ─── Canonical valid styles, one per background variant ───────────────────

const styleNone: TankStyle = {
  frame: 'rimless',
  background: { kind: 'none' },
};

const styleColor: TankStyle = {
  frame: 'framed',
  frameColor: '#222222',
  waterTint: '#a0d8ef33',
  background: { kind: 'color', color: '#0b0d0e' },
};

const sampleAsset: AssetRef = {
  id: '00000000-0000-4000-8000-000000000001',
  uri: 'assets/backdrop.png',
  mimeType: 'image/png',
};

const styleImage: TankStyle = {
  frame: 'braced',
  background: { kind: 'image', asset: sampleAsset },
};

const styleGradient: TankStyle = {
  frame: 'rimless',
  background: {
    kind: 'gradient',
    angle: Math.PI / 2,
    stops: [
      { at: 0, color: '#0a1622' },
      { at: 0.5, color: '#1c3a5c' },
      { at: 1, color: '#3b6ea5' },
    ],
  },
};

// ─── apply: validation branches ───────────────────────────────────────────

describe('applyCommand(SetTankStyle) — validation', () => {
  it('accepts each canonical style', () => {
    const scene = makeScene();
    for (const style of [styleNone, styleColor, styleImage, styleGradient]) {
      const r = applyCommand(scene, setTankStyle(style));
      expect(r.ok).toBe(true);
    }
  });

  it('rejects an invalid frame', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'wood-cabinet' as unknown as TankStyle['frame'],
      background: { kind: 'none' },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/frame/);
    }
  });

  it('rejects a malformed frameColor', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'framed',
      frameColor: 'red',
      background: { kind: 'none' },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/frameColor/);
    }
  });

  it('rejects a malformed waterTint', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      waterTint: '#fff', // 3-digit shorthand is not accepted
      background: { kind: 'none' },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/waterTint/);
    }
  });

  it('rejects a malformed background.color', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: { kind: 'color', color: 'not-a-color' },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/background\.color/);
    }
  });

  it('rejects a gradient with < 2 stops', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [{ at: 0.5, color: '#abcdef' }],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/stops/);
    }
  });

  it('rejects a gradient stop with a non-hex color', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: 1, color: 'rgb(0,0,0)' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/stops\[1\]\.color/);
    }
  });

  it('rejects a gradient stop with `at` outside [0,1]', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: -0.1, color: '#000000' },
          { at: 1, color: '#ffffff' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/stops\[0\]\.at/);
    }
  });

  it('rejects a gradient stop with non-finite `at`', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: Number.NaN, color: '#ffffff' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/stops\[1\]\.at/);
    }
  });

  it('rejects gradient stops not sorted ascending by `at`', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: 0.8, color: '#888888' },
          { at: 0.3, color: '#cccccc' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/sorted ascending/);
    }
  });

  it('accepts gradient stops with equal `at` (non-strict ascending — hard-stop band)', () => {
    const scene = makeScene();
    const style: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: 0.5, color: '#888888' },
          { at: 0.5, color: '#ff8800' },
          { at: 1, color: '#ffffff' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(style));
    expect(r.ok).toBe(true);
  });

  it('rejects a gradient with non-finite angle', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: Number.POSITIVE_INFINITY,
        stops: [
          { at: 0, color: '#000000' },
          { at: 1, color: '#ffffff' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/angle/);
    }
  });

  it('rejects an image background with empty `asset.id`', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'image',
        asset: { id: '', uri: 'assets/x.png', mimeType: 'image/png' },
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/asset\.id/);
    }
  });

  it('rejects an image background with empty `asset.uri`', () => {
    const scene = makeScene();
    const bad: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'image',
        asset: { id: 'abc', uri: '', mimeType: 'image/png' },
      },
    };
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/asset\.uri/);
    }
  });

  it('rejects an image background with missing asset', () => {
    const scene = makeScene();
    const bad = {
      frame: 'rimless',
      background: { kind: 'image' },
    } as unknown as TankStyle;
    const r = applyCommand(scene, setTankStyle(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid');
      expect(r.message).toMatch(/asset/);
    }
  });

  it('accepts 8-digit (with-alpha) hex colors in every slot', () => {
    const scene = makeScene();
    const style: TankStyle = {
      frame: 'framed',
      frameColor: '#11223344',
      waterTint: '#aabbccdd',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#aabbccdd' },
          { at: 1, color: '#ffeeddcc' },
        ],
      },
    };
    const r = applyCommand(scene, setTankStyle(style));
    expect(r.ok).toBe(true);
  });
});

// ─── apply: replacement semantics ─────────────────────────────────────────

describe('applyCommand(SetTankStyle) — replacement semantics', () => {
  it('replaces style and leaves dimensions / glassThickness / presetRef untouched', () => {
    const scene = makeScene();
    scene.tank.presetRef = { catalog: 'core', id: 'ada.mini-m', version: 1 };
    scene.tank.glassThickness = 5;
    const dimsBefore = {
      width: scene.tank.width,
      height: scene.tank.height,
      depth: scene.tank.depth,
    };

    const r = applyOk(scene, setTankStyle(styleGradient));
    expect(r.scene.tank.style).toEqual(styleGradient);
    expect(r.scene.tank.width).toBe(dimsBefore.width);
    expect(r.scene.tank.height).toBe(dimsBefore.height);
    expect(r.scene.tank.depth).toBe(dimsBefore.depth);
    expect(r.scene.tank.glassThickness).toBe(5);
    expect(r.scene.tank.presetRef).toEqual({ catalog: 'core', id: 'ada.mini-m', version: 1 });
  });

  it('does not mutate the input scene', () => {
    const scene = makeScene();
    const before = JSON.stringify(scene);
    applyCommand(scene, setTankStyle(styleGradient));
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('deep-clones the input style — mutating the caller reference does not leak in', () => {
    const scene = makeScene();
    const style: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: 0,
        stops: [
          { at: 0, color: '#000000' },
          { at: 1, color: '#ffffff' },
        ],
      },
    };
    const r = applyOk(scene, setTankStyle(style));
    // Mutate the original after apply; the stored style must be unaffected.
    if (style.background.kind === 'gradient') {
      style.background.stops[0]!.color = '#deadbe';
      style.background.angle = 999;
    }
    const stored = r.scene.tank.style;
    if (stored.background.kind !== 'gradient') {
      throw new Error('expected gradient');
    }
    expect(stored.background.stops[0]!.color).toBe('#000000');
    expect(stored.background.angle).toBe(0);
  });

  it('works on a zero-layer scene', () => {
    const scene = makeScene();
    scene.layers = [];
    const r = applyOk(scene, setTankStyle(styleColor));
    expect(r.scene.tank.style).toEqual(styleColor);
    expect(r.scene.layers).toHaveLength(0);
  });

  it('is NOT blocked by locked layers (structural global op)', () => {
    const scene = makeScene();
    // Lock every layer first.
    let s: Scene = scene;
    for (const layer of scene.layers) {
      const r = applyOk(s, setLayerLocked(layer.id, true));
      s = r.scene;
    }
    // Confirm at least one layer is locked.
    expect(s.layers.some((l) => l.locked)).toBe(true);
    // SetTankStyle should still succeed.
    const r = applyOk(s, setTankStyle(styleGradient));
    expect(r.scene.tank.style).toEqual(styleGradient);
  });

  it('keeps locking a single specific layer from blocking the command', () => {
    const scene = makeScene();
    scene.layers[0]!.locked = true;
    const r = applyCommand(scene, setTankStyle(styleColor));
    expect(r.ok).toBe(true);
    // Layer.locked must be unchanged.
    if (r.ok) {
      expect(r.scene.layers[0]!.locked).toBe(true);
    }
  });

  it('skips revalidation? — NO. Validates even when `inverse` is present.', () => {
    // Build a command "as if" produced by invertCommand but with an invalid
    // style; apply must still reject. This pins the always-validate policy.
    const scene = makeScene();
    const bad: SetTankStyleCommand = {
      kind: 'SetTankStyle',
      style: {
        frame: 'rimless',
        // Invalid: 3-digit shorthand.
        background: { kind: 'color', color: '#abc' },
      },
      inverse: { previousStyle: styleNone },
    };
    const r = applyCommand(scene, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });
});

// ─── invert ───────────────────────────────────────────────────────────────

describe('invertCommand(SetTankStyle)', () => {
  for (const [name, style] of [
    ['none', styleNone],
    ['color', styleColor],
    ['image', styleImage],
    ['gradient', styleGradient],
  ] as Array<[string, TankStyle]>) {
    it(`round-trips for background.kind = '${name}'`, () => {
      const scene = makeScene();
      const cmd = setTankStyle(style);
      const a = applyOk(scene, cmd);
      const inv = invertCommand(scene, cmd);
      const b = applyOk(a.scene, inv);
      expect(b.scene).toEqual(scene);
    });
  }

  it('captures the previous style in `dimensions`-equivalent slot (`style`)', () => {
    const scene = makeScene();
    const cmd = setTankStyle(styleGradient);
    const inv = invertCommand(scene, cmd);
    expect(inv.kind).toBe('SetTankStyle');
    if (inv.kind !== 'SetTankStyle') return;
    expect(inv.style).toEqual(scene.tank.style);
    expect(inv.inverse?.previousStyle).toEqual(styleGradient);
  });

  it('inverse-of-inverse round-trips structurally', () => {
    const scene = makeScene();
    const cmd = setTankStyle(styleGradient);
    const a = applyOk(scene, cmd);
    const inv = invertCommand(scene, cmd);
    // Apply inverse to land back at the pre-apply scene.
    const b = applyOk(a.scene, inv);
    expect(b.scene).toEqual(scene);
    // Now invert the inverse, against the scene the inverse saw.
    const invInv = invertCommand(a.scene, inv);
    const c = applyOk(b.scene, invInv);
    expect(c.scene).toEqual(a.scene);
  });

  it('the inverse command is itself JSON-serializable', () => {
    const scene = makeScene();
    const cmd = setTankStyle(styleGradient);
    const inv = invertCommand(scene, cmd);
    expect(JSON.parse(JSON.stringify(inv))).toEqual(inv);
  });

  it('captured inverse style is independent of post-apply scene mutations', () => {
    const scene = makeScene();
    const cmd = setTankStyle(styleColor);
    const inv = invertCommand(scene, cmd);
    // Mutate the original scene style; the captured snapshot must not move.
    scene.tank.style = styleGradient;
    if (inv.kind !== 'SetTankStyle') throw new Error('expected SetTankStyle');
    expect(inv.style).not.toEqual(styleGradient);
  });

  it('integrates with Composite — undo wraps multiple style changes as one', () => {
    const scene = makeScene();
    const cmd = composite([setTankStyle(styleColor), setTankStyle(styleGradient)]);
    const a = applyOk(scene, cmd);
    expect(a.scene.tank.style).toEqual(styleGradient);
    const inv = invertCommand(scene, cmd);
    const b = applyOk(a.scene, inv);
    expect(b.scene).toEqual(scene);
  });
});

// ─── JSON round-trip on hand-built commands ───────────────────────────────

describe('SetTankStyleCommand JSON round-trip', () => {
  for (const [name, style] of [
    ['none', styleNone],
    ['color', styleColor],
    ['image', styleImage],
    ['gradient', styleGradient],
  ] as Array<[string, TankStyle]>) {
    it(`round-trips a freshly-built command for '${name}'`, () => {
      const cmd = setTankStyle(style);
      expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    });

    it(`round-trips a command carrying an \`inverse\` envelope for '${name}'`, () => {
      const cmd: SetTankStyleCommand = {
        kind: 'SetTankStyle',
        style,
        inverse: { previousStyle: styleNone },
      };
      expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
    });
  }
});

// ─── Property test: arbitrary TankStyle round-trips ───────────────────────

/**
 * Hex-color arbitrary: `#` followed by 6 or 8 lowercase hex digits. We
 * keep this lowercase so deep-equal on the round-tripped string holds
 * (the validator is case-insensitive either way).
 */
const arbHex = (): fc.Arbitrary<string> =>
  fc.oneof(fc.stringMatching(/^#[0-9a-f]{6}$/), fc.stringMatching(/^#[0-9a-f]{8}$/));

const arbBackgroundNone = (): fc.Arbitrary<TankStyle['background']> =>
  fc.constant({ kind: 'none' as const });

const arbBackgroundColor = (): fc.Arbitrary<TankStyle['background']> =>
  arbHex().map((color) => ({ kind: 'color' as const, color }));

const arbBackgroundGradient = (): fc.Arbitrary<TankStyle['background']> =>
  fc
    .record({
      angle: fc.double({ min: -10, max: 10, noNaN: true }),
      stops: fc.array(
        fc.record({
          at: fc.double({ min: 0, max: 1, noNaN: true }),
          color: arbHex(),
        }),
        { minLength: 2, maxLength: 6 },
      ),
    })
    .map((r) => ({
      kind: 'gradient' as const,
      // Filter `-0` artefacts that JSON.stringify would coerce to `0`.
      angle: Object.is(r.angle, -0) ? 0 : r.angle,
      stops: [...r.stops]
        .sort((a, b) => a.at - b.at)
        .map((s) => ({ at: Object.is(s.at, -0) ? 0 : s.at, color: s.color })),
    }));

const arbTankStyle = (): fc.Arbitrary<TankStyle> =>
  fc
    .record({
      frame: fc.constantFrom('rimless' as const, 'framed' as const, 'braced' as const),
      frameColor: fc.option(arbHex(), { nil: undefined }),
      waterTint: fc.option(arbHex(), { nil: undefined }),
      background: fc.oneof(arbBackgroundNone(), arbBackgroundColor(), arbBackgroundGradient()),
    })
    .map((r) => {
      const style: TankStyle = {
        frame: r.frame,
        background: r.background,
      };
      if (r.frameColor !== undefined) style.frameColor = r.frameColor;
      if (r.waterTint !== undefined) style.waterTint = r.waterTint;
      return style;
    });

describe('SetTankStyle property tests', () => {
  it('any valid arbitrary style is accepted by applyCommand', () => {
    fc.assert(
      fc.property(arbTankStyle(), (style) => {
        const r = applyCommand(makeScene(), setTankStyle(style));
        expect(r.ok).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('apply ∘ invert = id for any valid arbitrary style', () => {
    fc.assert(
      fc.property(arbTankStyle(), (style) => {
        const scene = makeScene();
        const cmd = setTankStyle(style);
        const a = applyCommand(scene, cmd);
        if (!a.ok) throw new Error(`apply rejected: ${a.message}`);
        const inv = invertCommand(scene, cmd);
        const b = applyCommand(a.scene, inv);
        if (!b.ok) throw new Error(`invert apply rejected: ${b.message}`);
        expect(b.scene).toEqual(scene);
      }),
      { numRuns: 50 },
    );
  });

  it('a SetTankStyleCommand JSON-round-trips for any valid arbitrary style', () => {
    fc.assert(
      fc.property(arbTankStyle(), (style) => {
        const cmd = setTankStyle(style);
        expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
      }),
      { numRuns: 50 },
    );
  });
});
