/**
 * Water-change command tests — Stage 13 F13.5a.
 *
 * Covers:
 *   - the pure `applyWaterChange` dilution math (dissolved compounds blend
 *     toward replacement; pH shifts only when provided),
 *   - the COLONY-UNTOUCHED honest-biology invariant (aob/nob/ageWeeks never
 *     move — a water change does NOT reset the cycle),
 *   - the denormalized `cycle` recompute,
 *   - the command apply / invert + reject paths,
 *   - the `apply ∘ invert = id` invertibility property (single + stacked),
 *   - the absent-`waterChemistry` edge case (clean reject, not a silent no-op),
 *   - the no-locked-layer-guard case.
 */

import fc from 'fast-check';

import { applyCommand, invertCommand } from './commands';
import { makeScene, makeSceneWithChemistry, makeWaterChemistry } from './test-fixtures';
import type { Scene, WaterChemistry } from './types';
import {
  applyWaterChange,
  waterChange,
  type ReplacementWater,
} from './water-change-commands';

// ─── Pure dilution helper ─────────────────────────────────────────────────

describe('applyWaterChange (pure helper)', () => {
  it('halves nitrate on a 50% change against clean water', () => {
    const chem = makeWaterChemistry({ nitrate: 40 });
    const next = applyWaterChange(chem, 0.5);
    expect(next.chemistry.nitrate).toBeCloseTo(20, 10);
  });

  it('dilutes ammonia + nitrite + nitrate proportionally (clean replacement)', () => {
    const chem = makeWaterChemistry({ ammonia: 2, nitrite: 1, nitrate: 80 });
    const next = applyWaterChange(chem, 0.25); // remove a quarter
    expect(next.chemistry.ammonia).toBeCloseTo(1.5, 10);
    expect(next.chemistry.nitrite).toBeCloseTo(0.75, 10);
    expect(next.chemistry.nitrate).toBeCloseTo(60, 10);
  });

  it('blends toward a NON-zero replacement compound', () => {
    // Replacement water itself carries 10 mg/L nitrate (e.g. dirty tap).
    const chem = makeWaterChemistry({ nitrate: 50 });
    const next = applyWaterChange(chem, 0.5, { nitrate: 10 });
    // 50·0.5 + 10·0.5 = 30
    expect(next.chemistry.nitrate).toBeCloseTo(30, 10);
  });

  it('a 100% change replaces the water column entirely', () => {
    const chem = makeWaterChemistry({ ammonia: 4, nitrite: 3, nitrate: 100 });
    const next = applyWaterChange(chem, 1, { nitrate: 5 });
    expect(next.chemistry.ammonia).toBeCloseTo(0, 10);
    expect(next.chemistry.nitrite).toBeCloseTo(0, 10);
    expect(next.chemistry.nitrate).toBeCloseTo(5, 10);
  });

  it('shifts pH toward replacement.ph when provided', () => {
    const chem = makeWaterChemistry({ ph: 7.0 });
    const next = applyWaterChange(chem, 0.5, { ph: 6.0 });
    expect(next.chemistry.ph).toBeCloseTo(6.5, 10);
  });

  it('leaves pH UNCHANGED when replacement.ph is omitted', () => {
    const chem = makeWaterChemistry({ ph: 7.3 });
    const next = applyWaterChange(chem, 0.5);
    expect(next.chemistry.ph).toBe(7.3);
  });

  // ─── COLONY-UNTOUCHED — the load-bearing honest-biology proof ──────────
  it('NEVER touches the bacterial colony or the cycling clock', () => {
    const chem = makeWaterChemistry({
      ammonia: 3,
      nitrite: 2,
      nitrate: 90,
      aobColony: 2.7,
      nobColony: 1.9,
      ageWeeks: 8,
    });
    const next = applyWaterChange(chem, 1, { nitrate: 0 }); // even a 100% change
    expect(next.chemistry.aobColony).toBe(2.7);
    expect(next.chemistry.nobColony).toBe(1.9);
    expect(next.chemistry.ageWeeks).toBe(8);
    expect(next.chemistry.engineVersion).toBe(chem.chemistry.engineVersion);
  });

  it('property: colony + clock are invariant across ANY fraction/replacement', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        fc.integer({ min: 0, max: 52 }),
        (f, replNitrate, aob, nob, age) => {
          const chem = makeWaterChemistry({
            nitrate: 60,
            aobColony: aob,
            nobColony: nob,
            ageWeeks: age,
          });
          const next = applyWaterChange(chem, f, { nitrate: replNitrate });
          expect(next.chemistry.aobColony).toBe(aob);
          expect(next.chemistry.nobColony).toBe(nob);
          expect(next.chemistry.ageWeeks).toBe(age);
        },
      ),
    );
  });

  it('a cycled tank STAYS cycled after a water change (colony preserved)', () => {
    const chem = makeWaterChemistry({
      ammonia: 0,
      nitrite: 0,
      nitrate: 80,
      aobColony: 3,
      nobColony: 3,
    });
    const next = applyWaterChange(chem, 0.9);
    expect(next.cycle).toBe('cycled');
  });

  it('recomputes the cycle stage from the new chemistry (cycling → cycled)', () => {
    // Mid-cycle: nitrite elevated above safe, colonies established. A big water
    // change pulls nitrite under the safe floor → reclassifies as cycled.
    const chem = makeWaterChemistry({
      ammonia: 0,
      nitrite: 2,
      nitrate: 40,
      aobColony: 1,
      nobColony: 1,
      // The stored `cycle` is stale ('cycled' from the fixture default); the
      // helper must recompute it from the new chemistry.
    });
    const next = applyWaterChange(chem, 0.95, { nitrite: 0 });
    expect(next.chemistry.nitrite).toBeLessThan(0.25);
    expect(next.cycle).toBe('cycled');
  });

  it('cycle recompute mirrors water-sim cycleProgress across the classification space', () => {
    // `classifyCycle` MIRRORS water-sim's `cycleProgress` (the spec file is kept
    // free of a water-sim *import* so nx doesn't graph a build dependency onto
    // it — see the report). We re-encode the SAME thresholds/branch order here
    // as the reference oracle so any drift in the scene-model copy is caught.
    const SAFE = 0.25; // SAFE_NITROGEN_MG_L
    const FLOOR = 0.05; // UNCYCLED_COLONY_FLOOR
    const oracle = (a: number, n: number, aob: number, nob: number): WaterChemistry['cycle'] => {
      const sa = a > 0 ? a : 0;
      const sn = n > 0 ? n : 0;
      const saob = aob > 0 ? aob : 0;
      const snob = nob > 0 ? nob : 0;
      if (sa <= SAFE && sn <= SAFE && saob > FLOOR && snob > FLOOR) return 'cycled';
      if (saob + snob <= FLOOR && sa <= SAFE && sn <= SAFE) return 'uncycled';
      return 'cycling';
    };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (ammonia, nitrite, aob, nob) => {
          const chem = makeWaterChemistry({
            ammonia,
            nitrite,
            nitrate: 30,
            aobColony: aob,
            nobColony: nob,
          });
          // Tiny fraction + matching replacement so dissolved values stay put;
          // the recomputed `cycle` reflects the input chemistry.
          const next = applyWaterChange(chem, 0.001, { ammonia, nitrite, nitrate: 30 });
          expect(next.cycle).toBe(
            oracle(next.chemistry.ammonia, next.chemistry.nitrite, aob, nob),
          );
        },
      ),
    );
  });

  it('carries the algae block through unchanged (a water change does not scrub surfaces)', () => {
    const chem = makeWaterChemistry({ nitrate: 50 }, { 'green-spot': 0.4, diatom: 0.1 });
    const next = applyWaterChange(chem, 0.5);
    expect(next.algae).toEqual({ 'green-spot': 0.4, diatom: 0.1 });
  });

  it('does not mutate the input snapshot', () => {
    const chem = makeWaterChemistry({ nitrate: 40 });
    const before = structuredClone(chem);
    applyWaterChange(chem, 0.5);
    expect(chem).toEqual(before);
  });
});

// ─── Command apply / reject paths ──────────────────────────────────────────

describe('WaterChange command — apply', () => {
  it('dilutes the tank chemistry through the dispatcher', () => {
    const scene = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 60 }));
    const result = applyCommand(scene, waterChange(0.5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.tank.waterChemistry?.chemistry.nitrate).toBeCloseTo(30, 10);
  });

  it('rejects "invalid" when the tank has no recorded chemistry (absent-field edge case)', () => {
    const scene = makeScene(); // no waterChemistry
    const result = applyCommand(scene, waterChange(0.5));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.message).toMatch(/no recorded water chemistry/);
  });

  it.each([0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects "invalid" for out-of-range fraction %p',
    (f) => {
      const scene = makeSceneWithChemistry();
      const result = applyCommand(scene, waterChange(f));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalid');
    },
  );

  it('accepts the boundary fraction 1 (full change)', () => {
    const scene = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 50 }));
    const result = applyCommand(scene, waterChange(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.tank.waterChemistry?.chemistry.nitrate).toBeCloseTo(0, 10);
  });

  // ─── No locked-layer guard ─────────────────────────────────────────────
  it('runs even when EVERY layer is locked (not object-scoped)', () => {
    const base = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 80 }));
    const scene: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, locked: true })),
    };
    const result = applyCommand(scene, waterChange(0.5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.tank.waterChemistry?.chemistry.nitrate).toBeCloseTo(40, 10);
  });

  it('does not mutate the source scene', () => {
    const scene = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 60 }));
    const before = structuredClone(scene);
    applyCommand(scene, waterChange(0.5));
    expect(scene).toEqual(before);
  });
});

// ─── Invertibility ─────────────────────────────────────────────────────────

describe('WaterChange command — invertibility', () => {
  function roundTrip(scene: Scene, fraction: number, replacement?: ReplacementWater): Scene {
    const cmd = waterChange(fraction, replacement);
    const inverse = invertCommand(scene, cmd);
    const applied = applyCommand(scene, cmd);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return scene;
    const restored = applyCommand(applied.scene, inverse);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return scene;
    return restored.scene;
  }

  it('apply ∘ invert = id restores the EXACT prior chemistry', () => {
    const scene = makeSceneWithChemistry(
      makeWaterChemistry({ ammonia: 1.3, nitrite: 0.7, nitrate: 73.2, ph: 7.1 }),
    );
    expect(roundTrip(scene, 0.4, { ph: 6.5, nitrate: 5 })).toEqual(scene);
  });

  it('the inverse of a freshly-built command is a single restore command', () => {
    const scene = makeSceneWithChemistry();
    const inverse = invertCommand(scene, waterChange(0.5));
    expect(inverse.kind).toBe('WaterChange');
    if (inverse.kind !== 'WaterChange') return;
    expect(inverse.inverse?.previousChemistry).toEqual(scene.tank.waterChemistry);
  });

  it('inverts to Noop when there is no chemistry to capture', () => {
    const scene = makeScene();
    expect(invertCommand(scene, waterChange(0.5))).toEqual({ kind: 'Noop' });
  });

  it('stacked water changes unwind in order (apply A, apply B, undo B, undo A)', () => {
    const s0 = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 100 }));

    const cmdA = waterChange(0.5);
    const invA = invertCommand(s0, cmdA);
    const rA = applyCommand(s0, cmdA);
    expect(rA.ok).toBe(true);
    if (!rA.ok) return;
    const s1 = rA.scene;

    const cmdB = waterChange(0.25, { nitrate: 4 });
    const invB = invertCommand(s1, cmdB);
    const rB = applyCommand(s1, cmdB);
    expect(rB.ok).toBe(true);
    if (!rB.ok) return;
    const s2 = rB.scene;

    // Undo B → back to s1.
    const uB = applyCommand(s2, invB);
    expect(uB.ok).toBe(true);
    if (!uB.ok) return;
    expect(uB.scene).toEqual(s1);

    // Undo A → back to s0.
    const uA = applyCommand(uB.scene, invA);
    expect(uA.ok).toBe(true);
    if (!uA.ok) return;
    expect(uA.scene).toEqual(s0);
  });

  it('property: apply ∘ invert = id for arbitrary fraction + replacement', () => {
    const arbReplacement: fc.Arbitrary<ReplacementWater | undefined> = fc.option(
      fc.record(
        {
          ammonia: fc.double({ min: 0, max: 5, noNaN: true }),
          nitrite: fc.double({ min: 0, max: 5, noNaN: true }),
          nitrate: fc.double({ min: 0, max: 30, noNaN: true }),
          ph: fc.double({ min: 5, max: 9, noNaN: true }),
        },
        { requiredKeys: [] },
      ),
      { nil: undefined },
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        arbReplacement,
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 120, noNaN: true }),
        (f, replacement, ammonia, nitrite, nitrate) => {
          const scene = makeSceneWithChemistry(
            makeWaterChemistry({ ammonia, nitrite, nitrate, aobColony: 1.5, nobColony: 1.5 }),
          );
          const cmd = waterChange(f, replacement);
          const inverse = invertCommand(scene, cmd);
          const applied = applyCommand(scene, cmd);
          expect(applied.ok).toBe(true);
          if (!applied.ok) return;
          const restored = applyCommand(applied.scene, inverse);
          expect(restored.ok).toBe(true);
          if (!restored.ok) return;
          expect(restored.scene).toEqual(scene);
        },
      ),
    );
  });
});

// ─── Builder factory ───────────────────────────────────────────────────────

describe('waterChange builder', () => {
  it('omits the replacement field when none is given', () => {
    const cmd = waterChange(0.5);
    expect(cmd).toEqual({ kind: 'WaterChange', fractionReplaced: 0.5 });
    expect('replacement' in cmd).toBe(false);
  });

  it('copies the replacement params (defensive — no shared reference)', () => {
    const replacement: ReplacementWater = { nitrate: 5, ph: 6.8 };
    const cmd = waterChange(0.3, replacement);
    expect(cmd.replacement).toEqual({ nitrate: 5, ph: 6.8 });
    expect(cmd.replacement).not.toBe(replacement);
  });

  it('produces a JSON-serializable command (no closures / class instances)', () => {
    const cmd = waterChange(0.5, { nitrate: 5 });
    expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
  });
});

// Belt-and-braces: the persisted snapshot shape the command writes stays a
// valid `WaterChemistry` (TS guards this, but keep an explicit anchor).
describe('WaterChange — output shape', () => {
  it('writes a well-formed WaterChemistry snapshot', () => {
    const scene = makeSceneWithChemistry(makeWaterChemistry({ nitrate: 60 }));
    const result = applyCommand(scene, waterChange(0.5));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wc = result.scene.tank.waterChemistry as WaterChemistry;
    expect(typeof wc.chemistry.nitrate).toBe('number');
    expect(['uncycled', 'cycling', 'cycled']).toContain(wc.cycle);
  });
});
