import { evaluateSchooling } from './schooling';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

describe('evaluateSchooling', () => {
  it('returns [] when livestock is empty', () => {
    expect(evaluateSchooling(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] for a solitary species (schoolingMin === 1)', () => {
    const a = makeCatalogLivestock('a', 'A', { schoolingMin: 1 });
    const scene = makeScene([makeSceneEntry('e1', 'a', 1)]);
    expect(evaluateSchooling(scene, makeCatalog([a]))).toEqual([]);
  });

  it('returns [] when quantity equals the catalog minimum', () => {
    const a = makeCatalogLivestock('a', 'A', { schoolingMin: 6 });
    const scene = makeScene([makeSceneEntry('e1', 'a', 6)]);
    expect(evaluateSchooling(scene, makeCatalog([a]))).toEqual([]);
  });

  it('returns [] when quantity exceeds the catalog minimum', () => {
    const a = makeCatalogLivestock('a', 'A', { schoolingMin: 6 });
    const scene = makeScene([makeSceneEntry('e1', 'a', 12)]);
    expect(evaluateSchooling(scene, makeCatalog([a]))).toEqual([]);
  });

  it('emits a warning when a schooler is under the catalog minimum', () => {
    const a = makeCatalogLivestock('a', 'Neon', { schoolingMin: 10 });
    const scene = makeScene([makeSceneEntry('e1', 'a', 3)]);
    const out = evaluateSchooling(scene, makeCatalog([a]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.code).toBe('schooling-below-minimum');
    expect(out[0]?.relatedEntryIds).toEqual(['e1']);
    expect(out[0]?.message).toContain('Neon');
    expect(out[0]?.explanation).toContain('10');
    expect(out[0]?.explanation).toContain('3');
  });

  it('emits one warning per offending entry', () => {
    const a = makeCatalogLivestock('a', 'A', { schoolingMin: 6 });
    const b = makeCatalogLivestock('b', 'B', { schoolingMin: 10 });
    const c = makeCatalogLivestock('c', 'C', { schoolingMin: 1 }); // solitary — skip
    const scene = makeScene([
      makeSceneEntry('e1', 'a', 2),
      makeSceneEntry('e2', 'b', 5),
      makeSceneEntry('e3', 'c', 1),
    ]);
    const out = evaluateSchooling(scene, makeCatalog([a, b, c]));
    expect(out).toHaveLength(2);
    const ids = out.map((w) => w.relatedEntryIds[0]);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');
  });

  it('skips entries with missing catalog refs', () => {
    const scene = makeScene([makeSceneEntry('e1', 'missing', 1)]);
    expect(evaluateSchooling(scene, makeCatalog([]))).toEqual([]);
  });
});
