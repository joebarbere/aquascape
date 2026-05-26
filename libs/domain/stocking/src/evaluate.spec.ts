import { STOCKING_RULES, evaluateStocking } from './evaluate';
import type { WarningCode } from './types';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from './test-fixtures';

describe('evaluateStocking', () => {
  it('returns [] for an empty livestock list', () => {
    expect(evaluateStocking(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] for a clean tank that violates no rules', () => {
    const a = makeCatalogLivestock('a', 'Neon', {
      schoolingMin: 10,
      temperament: 'peaceful',
      adultSize: 30,
      bioloadClass: 'low',
      temperatureRange: { minC: 22, maxC: 26 },
      pHRange: { min: 6.5, max: 7.5 },
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 12)]);
    expect(evaluateStocking(scene, makeCatalog([a]))).toEqual([]);
  });

  it('exposes a non-empty rule registry that includes every rule fn', () => {
    expect(STOCKING_RULES.length).toBeGreaterThanOrEqual(6);
    STOCKING_RULES.forEach((fn) => {
      expect(typeof fn).toBe('function');
    });
  });

  describe('deterministic ordering', () => {
    // Build a scene that triggers every rule simultaneously. Aiming for one
    // warning per rule in the output.
    //
    //   schooler:  schoolingMin=10, qty=2 → schooling-below-minimum (warning)
    //   peaceful + aggressive coexist     → temperament-clash       (warning)
    //   ranges 5–6 vs 7–8                 → ph-incompatible         (error)
    //   temps 18–22 vs 26–30              → temperature-incompatible(error)
    //   fin-nipper + betta                → fin-nipper-…            (warning)
    //   heavy bioload                     → bioload-severely-…      (error)
    //
    // The aggregator should sort: errors (alphabetical by code) →
    // warnings (alphabetical by code).
    const schooler = makeCatalogLivestock('schooler', 'Schooler', {
      schoolingMin: 10,
      adultSize: 100, // 10 cm
      bioloadClass: 'high', // ×2.0
      temperament: 'peaceful',
      temperatureRange: { minC: 18, maxC: 22 },
      pHRange: { min: 5, max: 6 },
    });
    const bully = makeCatalogLivestock('bully', 'Bully', {
      schoolingMin: 1,
      adultSize: 80,
      bioloadClass: 'high',
      temperament: 'aggressive',
      temperatureRange: { minC: 26, maxC: 30 },
      pHRange: { min: 7, max: 8 },
      compatibilityFlags: { finNipper: true },
    });
    const betta = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta', {
      schoolingMin: 1,
      adultSize: 65,
      bioloadClass: 'medium',
      temperament: 'semi-aggressive',
      temperatureRange: { minC: 24, maxC: 28 },
      pHRange: { min: 6, max: 7.5 },
    });
    // Use a small tank so bioload definitely fires.
    const TANK = { width: 250, depth: 200, height: 200 }; // 10 L
    const scene = makeScene(
      [
        makeSceneEntry('z-schooler', 'schooler', 2),
        makeSceneEntry('a-bully', 'bully', 1),
        makeSceneEntry('m-betta', 'livestock.fish.betta-splendens', 1),
      ],
      TANK,
    );

    it('orders by severity rank (error > warning > info) then alphabetical code', () => {
      const out = evaluateStocking(scene, makeCatalog([schooler, bully, betta]));
      const codes = out.map((w) => w.code);

      // Errors first, alphabetised.
      const errors = out.filter((w) => w.severity === 'error').map((w) => w.code);
      const warnings = out.filter((w) => w.severity === 'warning').map((w) => w.code);

      expect(errors).toEqual([...errors].sort());
      expect(warnings).toEqual([...warnings].sort());

      // The first error must precede the first warning in the array.
      const firstWarning = codes.findIndex((c) =>
        out.find((w) => w.code === c)?.severity === 'warning',
      );
      const firstError = codes.findIndex((c) =>
        out.find((w) => w.code === c)?.severity === 'error',
      );
      expect(firstError).toBeLessThan(firstWarning);
    });

    it('emits exactly the expected codes simultaneously', () => {
      const out = evaluateStocking(scene, makeCatalog([schooler, bully, betta]));
      const expected: WarningCode[] = [
        // errors (sorted alphabetically by code)
        'bioload-severely-overstocked',
        'ph-incompatible',
        'temperature-incompatible',
        // warnings (sorted alphabetically by code)
        'fin-nipper-with-long-finned',
        'schooling-below-minimum',
        'temperament-clash',
      ];
      expect(out.map((w) => w.code)).toEqual(expected);
    });

    it('is deterministic — repeated runs return identical ids', () => {
      const a = evaluateStocking(scene, makeCatalog([schooler, bully, betta]));
      const b = evaluateStocking(scene, makeCatalog([schooler, bully, betta]));
      expect(a.map((w) => w.id)).toEqual(b.map((w) => w.id));
    });

    it('breaks ties on identical (severity, code) by sorted relatedEntryIds', () => {
      // Two scenes are independently subject to the schooling rule, which
      // emits one warning per offending entry — same code, same severity,
      // disambiguated only by relatedEntryIds.
      const sA = makeCatalogLivestock('a', 'A', { schoolingMin: 6 });
      const sB = makeCatalogLivestock('b', 'B', { schoolingMin: 6 });
      const scn = makeScene([
        makeSceneEntry('zzz', 'a', 1),
        makeSceneEntry('aaa', 'b', 1),
      ]);
      const out = evaluateStocking(scn, makeCatalog([sA, sB]));
      const sameCode = out.filter((w) => w.code === 'schooling-below-minimum');
      // sorted by sorted relatedEntryIds → 'aaa' before 'zzz'
      expect(sameCode.map((w) => w.relatedEntryIds[0])).toEqual(['aaa', 'zzz']);
    });
  });
});
