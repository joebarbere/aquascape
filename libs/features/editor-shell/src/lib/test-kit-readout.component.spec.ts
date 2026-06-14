// TestKitReadoutComponent tests. Plan Stage 13 F13.5 (F13.5b).
//
// Covers: the readout renders the four-row band chart from the projected
// chemistry, hides the chart for an unstocked tank, and the water-change action
// dispatches the undoable `WaterChange` Command through the NgRx pipeline.

import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import { SceneActions, selectScene } from '@aquascape/state';

import { TestKitReadoutComponent } from './test-kit-readout.component';
import { PreviewChemistryService } from './preview-chemistry.service';
import { PreviewTimeService } from './preview-time.service';

const catalog: Catalog = {
  get: () => ({ kind: 'livestock', id: 'med', bioloadClass: 'medium' }) as never,
} as unknown as Catalog;

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

function scene(opts: { stocked: boolean; chemistry: boolean }): Scene {
  const base = {
    tank: {
      width: 600,
      height: 400,
      depth: 400,
      style: { frame: 'rimless', background: { kind: 'none' } },
      ...(opts.chemistry
        ? {
            waterChemistry: {
              chemistry: {
                ammonia: 1,
                nitrite: 0.5,
                nitrate: 40,
                ph: 7.0,
                aobColony: 1,
                nobColony: 1,
                ageWeeks: 8,
                engineVersion: 1,
              },
              cycle: 'cycled',
            },
          }
        : {}),
    },
    substrate: { regions: [] },
    layers: [],
    seed: 3,
  };
  return {
    ...base,
    ...(opts.stocked
      ? { livestock: [{ id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 12 }] }
      : {}),
  } as Scene;
}

function configure(initial: Scene) {
  TestBed.configureTestingModule({
    providers: [
      provideMockStore(),
      { provide: STORAGE_SERVICE, useValue: new FakeStorageService() },
    ],
  });
  const store = TestBed.inject(MockStore);
  store.overrideSelector(selectScene, initial);
  TestBed.inject(PreviewChemistryService).setCatalog(catalog);
  const preview = TestBed.inject(PreviewTimeService);
  const fixture = TestBed.createComponent(TestKitReadoutComponent);
  fixture.componentInstance.collapsed.set(false); // expand the body for assertions
  return { fixture, store, preview };
}

describe('TestKitReadoutComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the four-row test-kit chart for a stocked tank', () => {
    const { fixture, preview } = configure(scene({ stocked: true, chemistry: true }));
    preview.setPreviewAge(8);
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.tk__row');
    expect(rows.length).toBe(4);
    // Each row has a swatch + a band verdict.
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.tk__swatch').length).toBe(4);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.tk__band').length).toBe(4);
  });

  it('hides the chart for an unstocked tank', () => {
    const { fixture } = configure(scene({ stocked: false, chemistry: false }));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.tk__chart')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.tk__empty')).not.toBeNull();
  });

  it('dispatches an undoable WaterChange command on apply', () => {
    const { fixture, store } = configure(scene({ stocked: true, chemistry: true }));
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'dispatch');

    fixture.componentInstance.setFraction(0.5);
    fixture.componentInstance.applyChange();

    expect(spy).toHaveBeenCalledWith(
      SceneActions.dispatchCommand({
        command: { kind: 'WaterChange', fractionReplaced: 0.5 },
      }),
    );
  });

  it('does not dispatch when the tank has no chemistry', () => {
    const { fixture, store } = configure(scene({ stocked: true, chemistry: false }));
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'dispatch');
    fixture.componentInstance.applyChange();
    expect(spy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.status()).toContain('No water chemistry');
  });
});
