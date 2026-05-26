import { evaluateBioload } from './bioload';
import {
  BIOLOAD_RATIO_NEAR_CAPACITY,
  BIOLOAD_RATIO_OVERSTOCKED,
  BIOLOAD_RATIO_SEVERELY_OVERSTOCKED,
} from './shared';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

// A 10 L tank (250 × 200 × 200 mm) keeps the bioload arithmetic clean:
//   weighted_cm / 10  ==  ratio.
const TANK_10L = { width: 250, depth: 200, height: 200 };

describe('evaluateBioload', () => {
  it('returns [] when scene.livestock is undefined', () => {
    const scene = makeScene(undefined, TANK_10L);
    const catalog = makeCatalog([]);
    expect(evaluateBioload(scene, catalog)).toEqual([]);
  });

  it('returns [] when scene.livestock is empty', () => {
    const scene = makeScene([], TANK_10L);
    const catalog = makeCatalog([]);
    expect(evaluateBioload(scene, catalog)).toEqual([]);
  });

  it('returns [] when tank volume is zero', () => {
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 30,
      bioloadClass: 'medium',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 5)], {
      width: 0,
      depth: 200,
      height: 200,
    });
    expect(evaluateBioload(scene, makeCatalog([fish]))).toEqual([]);
  });

  it('skips entries whose catalog ref cannot be resolved', () => {
    // Single entry that resolves cleanly to keep the rule active, plus a
    // second entry whose ref is unknown — the rule should ignore it.
    const known = makeCatalogLivestock('known', 'Known', {
      adultSize: 30, // 3 cm
      bioloadClass: 'medium', // ×1.0
    });
    const scene = makeScene(
      [makeSceneEntry('e1', 'known', 5), makeSceneEntry('e2', 'missing', 100)],
      TANK_10L,
    );
    const result = evaluateBioload(scene, makeCatalog([known]));
    // 5 × 3 cm × 1 / 10 L = 1.5 → overstocked tier.
    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('bioload-overstocked');
    expect(result[0]?.relatedEntryIds).toEqual(['e1']);
  });

  it('returns [] just under the near-capacity threshold', () => {
    // ratio = 9 / 10 = 0.9 (< 1.0)
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10, // 1 cm
      bioloadClass: 'medium', // ×1.0
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 9)], TANK_10L);
    expect(evaluateBioload(scene, makeCatalog([fish]))).toEqual([]);
  });

  it('emits info "bioload-near-capacity" at the lower boundary', () => {
    // ratio = exactly 1.0
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10,
      bioloadClass: 'medium',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 10)], TANK_10L);
    const out = evaluateBioload(scene, makeCatalog([fish]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('info');
    expect(out[0]?.code).toBe('bioload-near-capacity');
    expect(out[0]?.message).toContain('1.00');
    expect(out[0]?.explanation).toContain('10.0 cm');
    expect(out[0]?.explanation).toContain('10.0 L');
  });

  it('escalates to warning "bioload-overstocked" at ratio 1.5', () => {
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10,
      bioloadClass: 'medium',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 15)], TANK_10L);
    const out = evaluateBioload(scene, makeCatalog([fish]));
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.code).toBe('bioload-overstocked');
  });

  it('escalates to error "bioload-severely-overstocked" at ratio 2.5', () => {
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10,
      bioloadClass: 'medium',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 25)], TANK_10L);
    const out = evaluateBioload(scene, makeCatalog([fish]));
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.code).toBe('bioload-severely-overstocked');
  });

  it('applies the bioload-class multiplier (high doubles the load)', () => {
    // High × ×2, qty=5, body 1cm → 10 cm weighted → ratio 1.0 → info.
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10,
      bioloadClass: 'high',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 5)], TANK_10L);
    const out = evaluateBioload(scene, makeCatalog([fish]));
    expect(out[0]?.code).toBe('bioload-near-capacity');
  });

  it('applies the bioload-class multiplier (low halves the load)', () => {
    // Low × ×0.5, qty=20, body 1cm → 10 cm weighted → ratio 1.0.
    const fish = makeCatalogLivestock('a', 'A', {
      adultSize: 10,
      bioloadClass: 'low',
    });
    const scene = makeScene([makeSceneEntry('e1', 'a', 20)], TANK_10L);
    const out = evaluateBioload(scene, makeCatalog([fish]));
    expect(out[0]?.code).toBe('bioload-near-capacity');
  });

  it('lists every implicated entry id sorted ascending', () => {
    const a = makeCatalogLivestock('a', 'A', { adultSize: 10, bioloadClass: 'medium' });
    const b = makeCatalogLivestock('b', 'B', { adultSize: 10, bioloadClass: 'medium' });
    const scene = makeScene(
      [makeSceneEntry('z-second', 'a', 10), makeSceneEntry('a-first', 'b', 5)],
      TANK_10L,
    );
    const out = evaluateBioload(scene, makeCatalog([a, b]));
    expect(out[0]?.relatedEntryIds).toEqual(['a-first', 'z-second']);
  });

  it('exposes the three tier constants in non-decreasing order', () => {
    // Sanity guard so a tuning PR can't accidentally invert the tiers.
    expect(BIOLOAD_RATIO_NEAR_CAPACITY).toBeLessThan(BIOLOAD_RATIO_OVERSTOCKED);
    expect(BIOLOAD_RATIO_OVERSTOCKED).toBeLessThan(BIOLOAD_RATIO_SEVERELY_OVERSTOCKED);
  });
});
