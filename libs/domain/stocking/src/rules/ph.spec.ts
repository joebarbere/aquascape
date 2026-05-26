import { evaluatePH } from './ph';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

describe('evaluatePH', () => {
  it('returns [] when livestock is empty', () => {
    expect(evaluatePH(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] with a single species', () => {
    const a = makeCatalogLivestock('a', 'A', { pHRange: { min: 6.0, max: 7.5 } });
    expect(evaluatePH(makeScene([makeSceneEntry('e1', 'a')]), makeCatalog([a]))).toEqual([]);
  });

  it('returns [] when pH ranges overlap', () => {
    const a = makeCatalogLivestock('a', 'A', { pHRange: { min: 6.0, max: 7.5 } });
    const b = makeCatalogLivestock('b', 'B', { pHRange: { min: 6.5, max: 8.0 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluatePH(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('returns [] when pH ranges touch at a single point', () => {
    const a = makeCatalogLivestock('a', 'A', { pHRange: { min: 5.5, max: 6.5 } });
    const b = makeCatalogLivestock('b', 'B', { pHRange: { min: 6.5, max: 7.5 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluatePH(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('emits one error warning when pH ranges do not overlap', () => {
    const a = makeCatalogLivestock('a', 'A', { pHRange: { min: 5.0, max: 6.0 } });
    const b = makeCatalogLivestock('b', 'B', { pHRange: { min: 7.5, max: 8.5 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    const out = evaluatePH(scene, makeCatalog([a, b]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.code).toBe('ph-incompatible');
    expect(out[0]?.relatedEntryIds).toEqual(['e1', 'e2']);
    expect(out[0]?.explanation).toContain('pH 5–6');
    expect(out[0]?.explanation).toContain('pH 7.5–8.5');
  });

  it('skips entries with missing catalog refs', () => {
    const a = makeCatalogLivestock('a', 'A', { pHRange: { min: 5.0, max: 6.0 } });
    const scene = makeScene([
      makeSceneEntry('e1', 'a'),
      makeSceneEntry('e2', 'missing'),
    ]);
    expect(evaluatePH(scene, makeCatalog([a]))).toEqual([]);
  });
});
