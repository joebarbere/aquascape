import { evaluateTemperature } from './temperature';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

describe('evaluateTemperature', () => {
  it('returns [] when livestock is empty', () => {
    expect(evaluateTemperature(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] with a single species (no second range to clash with)', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 22, maxC: 26 } });
    expect(
      evaluateTemperature(makeScene([makeSceneEntry('e1', 'a')]), makeCatalog([a])),
    ).toEqual([]);
  });

  it('returns [] when ranges overlap fully', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 20, maxC: 28 } });
    const b = makeCatalogLivestock('b', 'B', { temperatureRange: { minC: 22, maxC: 26 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperature(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('returns [] when ranges partially overlap', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 20, maxC: 24 } });
    const b = makeCatalogLivestock('b', 'B', { temperatureRange: { minC: 22, maxC: 28 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperature(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('returns [] when ranges touch at a single point (advisory tolerance)', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 20, maxC: 24 } });
    const b = makeCatalogLivestock('b', 'B', { temperatureRange: { minC: 24, maxC: 28 } });
    const scene = makeScene([makeSceneEntry('e1', 'a'), makeSceneEntry('e2', 'b')]);
    expect(evaluateTemperature(scene, makeCatalog([a, b]))).toEqual([]);
  });

  it('emits one error warning when ranges do not overlap', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 18, maxC: 22 } });
    const b = makeCatalogLivestock('b', 'B', { temperatureRange: { minC: 26, maxC: 30 } });
    const scene = makeScene([makeSceneEntry('e2', 'a'), makeSceneEntry('e1', 'b')]);
    const out = evaluateTemperature(scene, makeCatalog([a, b]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.code).toBe('temperature-incompatible');
    expect(out[0]?.relatedEntryIds).toEqual(['e1', 'e2']);
    expect(out[0]?.explanation).toContain('18–22 °C');
    expect(out[0]?.explanation).toContain('26–30 °C');
  });

  it('skips entries with missing catalog refs', () => {
    const a = makeCatalogLivestock('a', 'A', { temperatureRange: { minC: 18, maxC: 22 } });
    // Only 'a' resolves; 'missing' is dropped → effectively a one-species scene.
    const scene = makeScene([
      makeSceneEntry('e1', 'a'),
      makeSceneEntry('e2', 'missing-id'),
    ]);
    expect(evaluateTemperature(scene, makeCatalog([a]))).toEqual([]);
  });
});
