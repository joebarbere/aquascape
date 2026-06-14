// PreviewChemistryService tests. Plan Stage 13 F13.3 (editor path).
//
// Covers: the chemistry derives from scene + preview week; scrubbing the slider
// moves the cycle stage forward; "Now" (null) shows the persisted/initial age;
// the source term comes from stocking (bioloadSourceN agreement); determinism.

import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';
import { evaluateSceneChemistryAtWeek } from '@aquascape/domain/water-sim';

import { PreviewChemistryService } from './preview-chemistry.service';
import { PreviewTimeService } from './preview-time.service';

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    tank: { width: 600, height: 400, depth: 400, style: { frame: 'rimless', background: { kind: 'none' } } },
    substrate: { regions: [] },
    layers: [],
    seed: 7,
    livestock: [{ id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 10 }],
    ...overrides,
  } as Scene;
}

/** Catalog stub: every livestock ref resolves to a medium-class fish. */
const catalog: Catalog = {
  get: () => ({ kind: 'livestock', id: 'med', bioloadClass: 'medium' }) as never,
} as unknown as Catalog;

function configure(initialScene: Scene | null) {
  TestBed.configureTestingModule({
    providers: [provideMockStore()],
  });
  const store = TestBed.inject(MockStore);
  store.overrideSelector(selectScene, initialScene);
  const service = TestBed.inject(PreviewChemistryService);
  service.setCatalog(catalog);
  const preview = TestBed.inject(PreviewTimeService);
  return { service, store, preview };
}

describe('PreviewChemistryService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('returns empty/uncycled chemistry when no scene is loaded', () => {
    const { service } = configure(null);
    const c = service.chemistry();
    expect(c.cycle).toBe('uncycled');
    expect(c.sourceN).toBe(0);
  });

  it('derives a non-zero source term from a stocked scene', () => {
    const { service } = configure(scene());
    // 10 medium fish × 0.6 mg-N/day baseline.
    expect(service.chemistry().sourceN).toBeCloseTo(10 * 0.6, 6);
  });

  it('"Now" (null slider) evaluates at the persisted/initial age (week 0 fresh tank)', () => {
    const { service, preview } = configure(scene());
    preview.reset();
    expect(service.chemistry().week).toBe(0);
    // A fresh tank at week 0 is uncycled.
    expect(service.chemistry().cycle).toBe('uncycled');
  });

  it('scrubbing the time slider forward moves the cycle through its stages', () => {
    const { service, preview } = configure(scene());

    preview.setPreviewAge(0.1);
    const early = service.chemistry();
    expect(early.cycle).not.toBe('cycled');

    preview.setPreviewAge(8);
    const late = service.chemistry();
    expect(late.cycle).toBe('cycled');
    // Nitrate accumulates as the cycle runs (the husbandry signal).
    expect(late.state.nitrate).toBeGreaterThan(early.state.nitrate);
  });

  it('matches the framework-free evaluator exactly (deterministic projection)', () => {
    const s = scene();
    const { service, preview } = configure(s);
    preview.setPreviewAge(6);
    const viaService = service.chemistry();
    const direct = evaluateSceneChemistryAtWeek(s, 6, 10 * 0.6);
    expect(viaService.state).toEqual(direct);
  });

  it('recomputes when the scene changes (more fish ⇒ more source)', () => {
    const { service, store } = configure(scene());
    expect(service.chemistry().sourceN).toBeCloseTo(6, 6);
    store.overrideSelector(
      selectScene,
      scene({ livestock: [{ id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 20 }] }),
    );
    store.refreshState();
    expect(service.chemistry().sourceN).toBeCloseTo(12, 6);
  });
});
