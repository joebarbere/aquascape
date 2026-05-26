import { evaluateTemperament } from './temperament';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

describe('evaluateTemperament', () => {
  it('returns [] when livestock is empty', () => {
    expect(evaluateTemperament(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] with a single species', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    expect(
      evaluateTemperament(makeScene([makeSceneEntry('e1', 'a')]), makeCatalog([a])),
    ).toEqual([]);
  });

  it('returns [] for all-peaceful tank', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    const b = makeCatalogLivestock('b', 'B', { temperament: 'peaceful' });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperament(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('returns [] for all-aggressive tank (no peaceful target to clash with)', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'aggressive' });
    const b = makeCatalogLivestock('b', 'B', { temperament: 'aggressive' });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperament(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('returns [] for peaceful + semi-aggressive (buffer-zone coexistence)', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    const b = makeCatalogLivestock('b', 'B', { temperament: 'semi-aggressive' });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperament(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('emits a warning when peaceful and aggressive coexist', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    const b = makeCatalogLivestock('b', 'B', { temperament: 'aggressive' });
    const scene = makeScene([makeSceneEntry('e2', 'a'), makeSceneEntry('e1', 'b')]);
    const out = evaluateTemperament(scene, makeCatalog([a, b]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.code).toBe('temperament-clash');
    expect(out[0]?.relatedEntryIds).toEqual(['e1', 'e2']);
  });

  it('omits semi-aggressive entries from relatedEntryIds even when present', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    const b = makeCatalogLivestock('b', 'B', { temperament: 'aggressive' });
    const c = makeCatalogLivestock('c', 'C', { temperament: 'semi-aggressive' });
    const scene = makeScene([
      makeSceneEntry('e1', 'a'),
      makeSceneEntry('e2', 'b'),
      makeSceneEntry('e3-semi', 'c'),
    ]);
    const out = evaluateTemperament(scene, makeCatalog([a, b, c]));
    expect(out).toHaveLength(1);
    expect(out[0]?.relatedEntryIds).toEqual(['e1', 'e2']);
    expect(out[0]?.relatedEntryIds).not.toContain('e3-semi');
  });

  it('skips entries with missing catalog refs', () => {
    const a = makeCatalogLivestock('a', 'A', { temperament: 'peaceful' });
    const scene = makeScene([
      makeSceneEntry('e1', 'a'),
      makeSceneEntry('e2', 'missing-aggressive'),
    ]);
    expect(evaluateTemperament(scene, makeCatalog([a]))).toEqual([]);
  });
});
