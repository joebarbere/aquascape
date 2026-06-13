/**
 * "Nutrients & additives + dosing" — F-B `DoseNutrient` command tests.
 *
 * RUNTIME-ONLY: the command records a `DoseEvent` in `scene.doseLog`; it does
 * NOT apply chemistry (the `Tank.waterChemistry` effect is deferred to Stage
 * 13). These tests cover:
 *   - the delta math (disclosed linear scaling, proprietary omits numbers),
 *   - the factory baking a finished `DoseEvent`,
 *   - apply / invert behaviour + reject paths,
 *   - the `apply ∘ invert = id` invertibility property (single + stacked),
 *   - no locked-layer guard (dosing is not object-scoped),
 *   - the doseLog selectors + `nextDoseSeq`.
 */

import fc from 'fast-check';

import { applyCommand, invertCommand } from './commands';
import {
  computeDoseDeltas,
  doseNutrient,
  removeDoseEvent,
  type ResolvedNutrient,
} from './nutrient-commands';
import { nextDoseSeq, selectDoseEventById, selectDoseLog } from './selectors';
import { makeScene } from './test-fixtures';
import type { DoseEvent, Scene } from './types';

// ─── Fixtures ──────────────────────────────────────────────────────────────

/**
 * A disclosed dry salt: 0.3 g/dose → +4.84 ppm NO3, +3.1 K (the plan's KNO3
 * representative figures).
 */
const kno3: ResolvedNutrient = {
  catalog: 'core',
  id: 'nutrient.dry.kno3',
  version: 1,
  disclosed: true,
  affects: ['no3', 'k'],
  dose: { amount: 0.3, unit: 'g', perLitres: 38 },
  contributes: { no3: 4.84, k: 3.1 },
};

/** A proprietary all-in-one: discloses nothing, qualitative affects only. */
const flourish: ResolvedNutrient = {
  catalog: 'core',
  id: 'nutrient.liquid.flourish',
  version: 1,
  disclosed: false,
  affects: ['traces', 'fe'],
  dose: { amount: 5, unit: 'ml', perLitres: 250 },
  // No `contributes` — never fabricate.
};

let seq = 0;
function dose(
  nutrient: ResolvedNutrient,
  amount: number,
  unit?: 'g' | 'ml',
) {
  seq += 1;
  return doseNutrient(nutrient, amount, {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    unit,
  });
}

beforeEach(() => {
  seq = 0;
});

// ─── Delta computation ───────────────────────────────────────────────────

describe('computeDoseDeltas', () => {
  it('scales a disclosed product linearly by amount / dose.amount', () => {
    // 0.6 g is 2× the 0.3 g representative dose → exactly double.
    expect(computeDoseDeltas(kno3, 0.6)).toEqual({ no3: 9.68, k: 6.2 });
  });

  it('returns the base figures at exactly one representative dose', () => {
    expect(computeDoseDeltas(kno3, 0.3)).toEqual({ no3: 4.84, k: 3.1 });
  });

  it('scales below one dose (a fractional amount)', () => {
    expect(computeDoseDeltas(kno3, 0.15)).toEqual({ no3: 2.42, k: 1.55 });
  });

  it('returns undefined for a proprietary product (no fabricated numbers)', () => {
    expect(computeDoseDeltas(flourish, 5)).toBeUndefined();
  });

  it('returns undefined when a disclosed product has an empty contributes', () => {
    const empty: ResolvedNutrient = { ...kno3, contributes: {} };
    expect(computeDoseDeltas(empty, 1)).toBeUndefined();
  });
});

// ─── Factory ───────────────────────────────────────────────────────────────

describe('doseNutrient factory', () => {
  it('bakes a finished DoseEvent with scaled deltas for a disclosed product', () => {
    const cmd = dose(kno3, 0.6);
    expect(cmd.kind).toBe('DoseNutrient');
    expect(cmd.event).toMatchObject({
      ref: { catalog: 'core', id: 'nutrient.dry.kno3', version: 1 },
      amount: 0.6,
      unit: 'g',
      disclosed: true,
      affects: ['no3', 'k'],
      deltas: { no3: 9.68, k: 6.2 },
    });
  });

  it('omits deltas entirely for a proprietary product', () => {
    const cmd = dose(flourish, 5);
    expect(cmd.event.disclosed).toBe(false);
    expect('deltas' in cmd.event).toBe(false);
    expect(cmd.event.affects).toEqual(['traces', 'fe']);
  });

  it('defaults unit to the nutrient dose unit, honouring an override', () => {
    expect(dose(kno3, 1).event.unit).toBe('g');
    expect(dose(kno3, 1, 'ml').event.unit).toBe('ml');
  });

  it('copies affects (no shared reference with the catalog entry)', () => {
    const cmd = dose(kno3, 0.3);
    expect(cmd.event.affects).not.toBe(kno3.affects);
  });

  it('produces a JSON-serializable command (no closures / class instances)', () => {
    const cmd = dose(kno3, 0.6);
    expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
  });
});

// ─── Apply ───────────────────────────────────────────────────────────────

describe('DoseNutrient apply', () => {
  it('appends to an undefined doseLog (initializing it)', () => {
    const scene = makeScene();
    expect(scene.doseLog).toBeUndefined();
    const result = applyCommand(scene, dose(kno3, 0.6));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.doseLog).toHaveLength(1);
    expect(result.scene.doseLog?.[0]?.deltas).toEqual({ no3: 9.68, k: 6.2 });
  });

  it('appends in dosed order across multiple doses', () => {
    let scene: Scene = makeScene();
    for (const amt of [0.3, 0.6, 0.9]) {
      const r = applyCommand(scene, dose(kno3, amt));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      scene = r.scene;
    }
    expect(selectDoseLog(scene).map((e) => e.amount)).toEqual([0.3, 0.6, 0.9]);
    expect(selectDoseLog(scene).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input scene (immutable update)', () => {
    const scene = makeScene();
    applyCommand(scene, dose(kno3, 0.6));
    expect(scene.doseLog).toBeUndefined();
  });

  it('rejects a duplicate event id as invalid', () => {
    const cmd = dose(kno3, 0.3);
    const first = applyCommand(makeScene(), cmd);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const dup = applyCommand(first.scene, cmd);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.reason).toBe('invalid');
  });

  it('rejects a non-positive amount as invalid', () => {
    const bad = { ...dose(kno3, 0.3), event: { ...dose(kno3, 0.3).event, amount: 0 } };
    const r = applyCommand(makeScene(), bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid');
  });
});

// ─── Remove ──────────────────────────────────────────────────────────────

describe('RemoveDoseEvent apply', () => {
  it('removes by id and drops the array when it empties (absent-stays-absent)', () => {
    const cmd = dose(kno3, 0.6);
    const added = applyCommand(makeScene(), cmd);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const removed = applyCommand(added.scene, removeDoseEvent(cmd.event.id));
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect('doseLog' in removed.scene).toBe(false);
  });

  it('reports not-found for an unknown event id', () => {
    const r = applyCommand(makeScene(), removeDoseEvent('missing'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-found');
  });
});

// ─── No locked-layer guard ─────────────────────────────────────────────────

describe('locked-layer guard does not apply to dosing', () => {
  it('doses even when every layer is locked', () => {
    const base = makeScene();
    const scene: Scene = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, locked: true })),
    };
    const r = applyCommand(scene, dose(kno3, 0.3));
    expect(r.ok).toBe(true);
  });
});

// ─── Selectors ─────────────────────────────────────────────────────────────

describe('dose selectors', () => {
  it('selectDoseLog returns [] for an absent log', () => {
    expect(selectDoseLog(makeScene())).toEqual([]);
  });

  it('selectDoseEventById finds / misses', () => {
    const cmd = dose(kno3, 0.3);
    const r = applyCommand(makeScene(), cmd);
    if (!r.ok) throw new Error('apply failed');
    expect(selectDoseEventById(r.scene, cmd.event.id)?.amount).toBe(0.3);
    expect(selectDoseEventById(r.scene, 'nope')).toBeNull();
  });

  it('nextDoseSeq returns 0 for an empty log and max+1 otherwise', () => {
    const empty = makeScene();
    expect(nextDoseSeq(empty)).toBe(0);
    const withLog: Scene = {
      ...empty,
      doseLog: [{ ...dose(kno3, 0.3).event, seq: 7 }],
    };
    expect(nextDoseSeq(withLog)).toBe(8);
  });
});

// ─── Invertibility property ─────────────────────────────────────────────────

/**
 * Drive a sequence of dose / remove commands and assert each step round-trips:
 * `apply(invert(apply)) === pre-state` on the relevant slice.
 */
describe('apply ∘ invert = id (invertibility)', () => {
  function roundTrips(scene: Scene, command: Parameters<typeof applyCommand>[1]): void {
    const inverse = invertCommand(scene, command);
    const applied = applyCommand(scene, command);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const undone = applyCommand(applied.scene, inverse);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    // The dose log slice must be byte-identical to the pre-state — including
    // "absent stays absent" (the empty-array → drop-field path).
    expect(undone.scene.doseLog).toEqual(scene.doseLog);
    expect('doseLog' in undone.scene).toBe('doseLog' in scene);
  }

  it('a single dose round-trips on a fresh scene', () => {
    roundTrips(makeScene(), dose(kno3, 0.6));
  });

  it('a proprietary dose round-trips (no deltas)', () => {
    roundTrips(makeScene(), dose(flourish, 5));
  });

  it('a remove round-trips (re-inserts at the original index)', () => {
    const cmd = dose(kno3, 0.3);
    const added = applyCommand(makeScene(), cmd);
    if (!added.ok) throw new Error('setup failed');
    roundTrips(added.scene, removeDoseEvent(cmd.event.id));
  });

  it('removing the middle of three restores the exact ordering on undo', () => {
    let scene: Scene = makeScene();
    const cmds = [dose(kno3, 0.3), dose(kno3, 0.6), dose(kno3, 0.9)];
    for (const c of cmds) {
      const r = applyCommand(scene, c);
      if (!r.ok) throw new Error('setup failed');
      scene = r.scene;
    }
    const middleId = cmds[1].event.id;
    roundTrips(scene, removeDoseEvent(middleId));
  });

  it('stacked doses unwind in reverse order to the exact original scene', () => {
    const start: Scene = makeScene();
    const cmds = [dose(kno3, 0.3), dose(flourish, 5), dose(kno3, 1.2)];

    // Apply forward, capturing the scene seen before each command (the state
    // its inverse must restore).
    const states: Scene[] = [start];
    let scene = start;
    const inverses: ReturnType<typeof invertCommand>[] = [];
    for (const c of cmds) {
      inverses.push(invertCommand(scene, c));
      const r = applyCommand(scene, c);
      if (!r.ok) throw new Error('forward apply failed');
      scene = r.scene;
      states.push(scene);
    }
    expect(selectDoseLog(scene)).toHaveLength(3);

    // Unwind in reverse; each undo must reproduce the pre-command snapshot.
    for (let i = cmds.length - 1; i >= 0; i--) {
      const r = applyCommand(scene, inverses[i]);
      if (!r.ok) throw new Error('undo apply failed');
      scene = r.scene;
      expect(scene).toEqual(states[i]);
    }
    // Fully unwound: back to the pristine (doseLog-absent) scene.
    expect('doseLog' in scene).toBe(false);
  });

  it('property: random disclosed/proprietary doses each round-trip', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            disclosed: fc.boolean(),
            amount: fc.double({ min: 0.01, max: 50, noNaN: true }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (specs) => {
          let scene: Scene = makeScene();
          let n = 0;
          for (const spec of specs) {
            n += 1;
            const nutrient = spec.disclosed ? kno3 : flourish;
            const cmd = doseNutrient(nutrient, spec.amount, {
              id: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
              seq: n,
            });
            const before = scene;
            const inverse = invertCommand(before, cmd);
            const applied = applyCommand(before, cmd);
            if (!applied.ok) return false;
            const undone = applyCommand(applied.scene, inverse);
            if (!undone.ok) return false;
            if (
              JSON.stringify(undone.scene.doseLog ?? null) !==
              JSON.stringify(before.doseLog ?? null)
            ) {
              return false;
            }
            scene = applied.scene; // keep the dose for the next iteration
          }
          return true;
        },
      ),
    );
  });
});

// ─── Compile-time: catalog NutrientEntry is assignable to ResolvedNutrient ──

describe('type compatibility', () => {
  it('accepts a structurally-catalog-shaped object', () => {
    // A richer object (extra fields, like a catalog NutrientEntry) is still
    // assignable — proves the factory takes the resolved entry directly.
    const richer = {
      kind: 'nutrient' as const,
      catalog: 'core',
      id: 'nutrient.dry.k2so4',
      version: 1,
      name: 'Potassium Sulphate',
      brand: 'DIY dry salt',
      form: 'dry' as const,
      category: 'macro-salt' as const,
      disclosed: true,
      affects: ['k'],
      color: '#cccccc',
      dose: { amount: 1, unit: 'g' as const, perLitres: 100 },
      contributes: { k: 11.82 },
    };
    const cmd = doseNutrient(richer, 2, { id: 'g0000000-0000-4000-8000-000000000001', seq: 0 });
    const event: DoseEvent = cmd.event;
    expect(event.deltas).toEqual({ k: 23.64 });
  });
});
