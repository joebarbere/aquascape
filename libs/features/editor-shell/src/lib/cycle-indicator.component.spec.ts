// CycleIndicatorComponent tests. Plan Stage 13 F13.3 (editor path).
//
// Covers: the badge hides for an unstocked tank (sourceN == 0), shows the cycle
// stage + nitrogen readout for a stocked tank, and updates as the preview week
// scrubs forward (the F13.3 acceptance: scrubbing time changes the surfaced
// cycle state).

import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';

import { CycleIndicatorComponent } from './cycle-indicator.component';
import { PreviewChemistryService } from './preview-chemistry.service';
import { PreviewTimeService } from './preview-time.service';

const catalog: Catalog = {
  get: () => ({ kind: 'livestock', id: 'med', bioloadClass: 'medium' }) as never,
} as unknown as Catalog;

function scene(stocked: boolean): Scene {
  return {
    tank: { width: 600, height: 400, depth: 400, style: { frame: 'rimless', background: { kind: 'none' } } },
    substrate: { regions: [] },
    layers: [],
    seed: 3,
    ...(stocked
      ? { livestock: [{ id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 12 }] }
      : {}),
  } as Scene;
}

function configure(initial: Scene) {
  TestBed.configureTestingModule({ providers: [provideMockStore()] });
  const store = TestBed.inject(MockStore);
  store.overrideSelector(selectScene, initial);
  TestBed.inject(PreviewChemistryService).setCatalog(catalog);
  const preview = TestBed.inject(PreviewTimeService);
  const fixture = TestBed.createComponent(CycleIndicatorComponent);
  return { fixture, store, preview };
}

describe('CycleIndicatorComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides for an unstocked tank (no bioload source)', () => {
    const { fixture } = configure(scene(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cyc')).toBeNull();
  });

  it('shows the cycle stage + nitrogen readout for a stocked tank', () => {
    const { fixture, preview } = configure(scene(true));
    preview.reset(); // "Now" — fresh tank at week 0
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.cyc')).not.toBeNull();
    expect(root.querySelector('.cyc__stage')?.textContent?.trim()).toBe('Uncycled');
    expect(root.querySelectorAll('.cyc__readout div').length).toBe(3);
  });

  it('changes the surfaced cycle state as the preview week scrubs forward', () => {
    const { fixture, preview } = configure(scene(true));

    preview.setPreviewAge(0.1);
    fixture.detectChanges();
    const early = fixture.nativeElement.querySelector('.cyc__stage')?.textContent?.trim();
    expect(early).not.toBe('Cycled');

    preview.setPreviewAge(8);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cyc__stage')?.textContent?.trim()).toBe('Cycled');
  });
});
