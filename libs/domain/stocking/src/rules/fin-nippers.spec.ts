import { evaluateFinNippers } from './fin-nippers';
import { LONG_FINNED_CATALOG_IDS } from './shared';
import {
  makeCatalog,
  makeCatalogLivestock,
  makeScene,
  makeSceneEntry,
} from '../test-fixtures';

describe('evaluateFinNippers', () => {
  it('returns [] when livestock is empty', () => {
    expect(evaluateFinNippers(makeScene([]), makeCatalog([]))).toEqual([]);
  });

  it('returns [] for a fin-nipper alone (no long-finned target)', () => {
    const nipper = makeCatalogLivestock('nipper', 'Tiger Barb', {
      compatibilityFlags: { finNipper: true },
    });
    const scene = makeScene([
      makeSceneEntry('e1', 'nipper', 5),
      // Add a non-target so resolved.length >= 2 (the guard).
      makeSceneEntry('e2', 'nipper', 5),
    ]);
    expect(evaluateFinNippers(scene, makeCatalog([nipper]))).toEqual([]);
  });

  it('returns [] for a long-finned target alone (no nipper)', () => {
    const longFinned = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta');
    const filler = makeCatalogLivestock('filler', 'Filler');
    const scene = makeScene([
      makeSceneEntry('e1', 'livestock.fish.betta-splendens', 1),
      makeSceneEntry('e2', 'filler', 5),
    ]);
    expect(evaluateFinNippers(scene, makeCatalog([longFinned, filler]))).toEqual([]);
  });

  it('emits a warning when a fin-nipper and a long-finned target coexist', () => {
    const nipper = makeCatalogLivestock('nipper', 'Tiger Barb', {
      compatibilityFlags: { finNipper: true },
    });
    const betta = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta');
    const scene = makeScene([
      makeSceneEntry('e-nipper', 'nipper', 5),
      makeSceneEntry('e-betta', 'livestock.fish.betta-splendens', 1),
    ]);
    const out = evaluateFinNippers(scene, makeCatalog([nipper, betta]));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.code).toBe('fin-nipper-with-long-finned');
    expect(out[0]?.relatedEntryIds).toEqual(['e-betta', 'e-nipper']);
    expect(out[0]?.explanation).toContain('Tiger Barb');
    expect(out[0]?.explanation).toContain('Betta');
  });

  it('treats compatibilityFlags.finNipper === false as not-a-nipper', () => {
    const notNipper = makeCatalogLivestock('not-nipper', 'Gourami', {
      compatibilityFlags: { finNipper: false },
    });
    const betta = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta');
    const scene = makeScene([
      makeSceneEntry('e1', 'not-nipper', 1),
      makeSceneEntry('e2', 'livestock.fish.betta-splendens', 1),
    ]);
    expect(evaluateFinNippers(scene, makeCatalog([notNipper, betta]))).toEqual([]);
  });

  it('treats absent compatibilityFlags as not-a-nipper', () => {
    const noFlags = makeCatalogLivestock('no-flags', 'Some Fish');
    const betta = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta');
    const scene = makeScene([
      makeSceneEntry('e1', 'no-flags', 1),
      makeSceneEntry('e2', 'livestock.fish.betta-splendens', 1),
    ]);
    expect(evaluateFinNippers(scene, makeCatalog([noFlags, betta]))).toEqual([]);
  });

  it('exposes betta as a long-finned target', () => {
    // Sanity guard against an accidental removal in shared.ts.
    expect(LONG_FINNED_CATALOG_IDS.has('livestock.fish.betta-splendens')).toBe(true);
  });

  it('skips entries with missing catalog refs', () => {
    const betta = makeCatalogLivestock('livestock.fish.betta-splendens', 'Betta');
    const scene = makeScene([
      makeSceneEntry('e1', 'missing-nipper', 1),
      makeSceneEntry('e2', 'livestock.fish.betta-splendens', 1),
    ]);
    expect(evaluateFinNippers(scene, makeCatalog([betta]))).toEqual([]);
  });
});
