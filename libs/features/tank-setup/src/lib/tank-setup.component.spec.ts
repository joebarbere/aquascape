// Component tests for `TankSetupComponent`. F1.1 Phase B.
//
// These are TestBed component tests rather than Angular Testing Library to
// avoid pulling in another dep in this PR. We assert:
//   - The preset list renders the expected entries.
//   - Picking a preset dispatches `dispatchCommand(setTankDimensions(...))`
//     AND `setTankPresetRef({ presetRef: ... })`.
//   - Custom-form validation: empty / below-min / above-max blocks submit.
//   - cm → in → cm round-trips the displayed value (rounding tolerance).
//   - The aspect-ratio warning appears for ratios outside [0.3, 4.0] but
//     does not disable submit.
//   - Submitting custom dimensions clears the presetRef.
//   - Every input has a `<label>` linked via `for`, and validation errors
//     are addressable through `aria-describedby`.
//   - Enter on a focused preset selects it (keyboard operability).

import { TestBed } from '@angular/core/testing';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { defaultScene, selectTank, selectTankPresetRef } from '@aquascape/state';

import { TankSetupComponent } from './tank-setup.component';
import { tankPresets } from './tank-presets';

class FakeStorageService implements StorageService {
  private readonly data = new Map<string, unknown>();
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

function setup() {
  TestBed.configureTestingModule({
    imports: [TankSetupComponent],
    providers: [
      provideMockStore({
        selectors: [
          { selector: selectTank, value: defaultScene().tank },
          { selector: selectTankPresetRef, value: null },
        ],
      }),
      { provide: STORAGE_SERVICE, useClass: FakeStorageService },
    ],
  });
  const fixture = TestBed.createComponent(TankSetupComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    store: TestBed.inject(MockStore),
  };
}

describe('TankSetupComponent', () => {
  it('renders one item per preset', () => {
    const { fixture } = setup();
    for (const preset of tankPresets) {
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        `[data-testid="preset-${preset.id}"]`,
      );
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toContain(preset.name);
    }
  });

  it('groups presets by brand under role=radiogroup', () => {
    const { fixture } = setup();
    // Scope the query to the .presets fieldset so the styling subpanel's
    // frame radiogroup (F1.2 Phase D) doesn't get picked up by the count.
    const presets = (fixture.nativeElement as HTMLElement).querySelector('.presets') as HTMLElement;
    const groups = presets.querySelectorAll('[role="radiogroup"]');
    expect(groups.length).toBe(2);
    expect(groups[0]!.getAttribute('aria-label')).toBe('ADA tanks');
    expect(groups[1]!.getAttribute('aria-label')).toBe('Standard tanks');
  });

  it('dispatches setTankDimensions + setTankPresetRef when a preset is clicked', () => {
    const { fixture, store } = setup();
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="preset-ada.mini-m"]',
    ) as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    const calls = dispatchSpy.mock.calls.map((c) => c[0]);
    const types = calls.map((a) => (a as { type: string }).type);
    expect(types).toEqual(['[Scene] Dispatch Command', '[Scene] Set Tank Preset Ref']);

    const dispatchAction = calls[0] as {
      command: { kind: string; dimensions: { width: number; height: number; depth: number } };
    };
    expect(dispatchAction.command.kind).toBe('SetTankDimensions');
    expect(dispatchAction.command.dimensions).toEqual({
      width: 360,
      height: 220,
      depth: 220,
    });

    const stampAction = calls[1] as {
      presetRef: { catalog: string; id: string; version: number } | null;
    };
    expect(stampAction.presetRef).toEqual({
      catalog: 'core',
      id: 'ada.mini-m',
      version: 1,
    });
  });

  it('selects a preset via Enter on a focused radio button', () => {
    const { fixture, store } = setup();
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="preset-ada.60-p"]',
    ) as HTMLButtonElement;
    btn.focus();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalled();
  });

  describe('custom form validation', () => {
    it('apply button is disabled when the form is empty', () => {
      const { fixture, component } = setup();
      // Force-clear the form (toggles pristine→dirty so the store-sync
      // subscription doesn't overwrite on the next CD pass).
      component.customForm.setValue({
        width: null,
        height: null,
        depth: null,
      });
      component.customForm.markAsDirty();
      fixture.detectChanges();
      const submit = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="apply-custom"]',
      ) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
    });

    it('rejects below-min', () => {
      const { fixture, component } = setup();
      component.customForm.setValue({ width: 50, height: 200, depth: 200 });
      component.customForm.markAllAsTouched();
      fixture.detectChanges();
      const widthCtl = component.customForm.get('width')!;
      expect(widthCtl.invalid).toBe(true);
      expect(widthCtl.errors).toEqual({
        min: expect.objectContaining({ min: 100 }),
      });
    });

    it('rejects above-max', () => {
      const { fixture, component } = setup();
      component.customForm.setValue({ width: 4000, height: 200, depth: 200 });
      component.customForm.markAllAsTouched();
      fixture.detectChanges();
      const widthCtl = component.customForm.get('width')!;
      expect(widthCtl.invalid).toBe(true);
      expect(widthCtl.errors).toEqual({
        max: expect.objectContaining({ max: 3000 }),
      });
    });

    it('aria-describedby links inputs to the error element', () => {
      const { fixture } = setup();
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="custom-width"]',
      ) as HTMLInputElement;
      expect(input.getAttribute('aria-describedby')).toContain('width-error');
    });

    it('every input has a label linked via for=', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      for (const id of ['custom-width', 'custom-height', 'custom-depth']) {
        const input = root.querySelector(`#${id}`) as HTMLInputElement;
        const label = root.querySelector(`label[for="${id}"]`) as HTMLLabelElement;
        expect(input).not.toBeNull();
        expect(label).not.toBeNull();
      }
    });
  });

  describe('unit toggle', () => {
    it('cm → in → cm displays the same value (within rounding tolerance)', () => {
      const { fixture, component } = setup();
      // Seed form: 60 cm × 36 cm × 36 cm (600/360/360 mm).
      component.customForm.setValue({ width: 600, height: 360, depth: 360 });
      component.customForm.markAsPristine();
      fixture.detectChanges();

      const initialDisplayCm = component.display(component.customForm.value.width);
      expect(initialDisplayCm).toBe('60.0');

      component.setUnit('in');
      fixture.detectChanges();
      const inDisplay = component.display(component.customForm.value.width);
      // 600 mm = 23.62 in (to 2dp).
      expect(inDisplay).toBe('23.62');

      component.setUnit('cm');
      fixture.detectChanges();
      // Back to cm — internal value is still 600 mm.
      expect(component.display(component.customForm.value.width)).toBe('60.0');
    });

    it('aria-pressed reflects the active unit', () => {
      const { fixture, component } = setup();
      component.setUnit('in');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="unit-in"]')?.getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(root.querySelector('[data-testid="unit-cm"]')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });
  });

  describe('aspect-ratio warning', () => {
    it('appears for very wide ratios but does not block submit', () => {
      const { fixture, component } = setup();
      // 2000 × 200 → ratio 10 → out of band.
      component.customForm.setValue({ width: 2000, height: 200, depth: 300 });
      component.customForm.markAllAsTouched();
      fixture.detectChanges();
      const warning = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="aspect-warning"]',
      ) as HTMLElement;
      expect(warning.hidden).toBe(false);
      expect(warning.getAttribute('aria-live')).toBe('polite');
      // Submit is still enabled — the form is valid, just unusual.
      const submit = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="apply-custom"]',
      ) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);
    });

    it('does not appear for in-band ratios', () => {
      const { fixture, component } = setup();
      component.customForm.setValue({ width: 600, height: 360, depth: 360 });
      fixture.detectChanges();
      const warning = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="aspect-warning"]',
      ) as HTMLElement;
      expect(warning.hidden).toBe(true);
    });
  });

  describe('apply custom', () => {
    it('dispatches setTankDimensions + clears presetRef', () => {
      const { fixture, component, store } = setup();
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.customForm.setValue({ width: 700, height: 350, depth: 350 });
      component.customForm.markAllAsTouched();
      fixture.detectChanges();
      component.applyCustom();

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
      const calls = dispatchSpy.mock.calls.map((c) => c[0]);
      expect((calls[0] as { type: string }).type).toBe('[Scene] Dispatch Command');
      expect((calls[1] as { type: string }).type).toBe('[Scene] Set Tank Preset Ref');
      expect((calls[1] as { presetRef: unknown | null }).presetRef).toBeNull();
    });

    it('does not dispatch when the form is invalid', () => {
      const { fixture, component, store } = setup();
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      component.customForm.setValue({ width: 50, height: 50, depth: 50 });
      component.customForm.markAllAsTouched();
      fixture.detectChanges();
      component.applyCustom();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  it('onAxisInput converts the displayed value back to integer mm', () => {
    const { component } = setup();
    component.setUnit('cm');
    component.onAxisInput('width', '50');
    expect(component.customForm.get('width')?.value).toBe(500);
    component.setUnit('in');
    component.onAxisInput('width', '24');
    expect(component.customForm.get('width')?.value).toBe(610);
    component.setUnit('mm');
    component.onAxisInput('width', '700');
    expect(component.customForm.get('width')?.value).toBe(700);
  });

  it('onAxisInput clears the control on non-finite input', () => {
    const { component } = setup();
    component.customForm.setValue({ width: 500, height: 250, depth: 250 });
    component.onAxisInput('width', 'not-a-number');
    expect(component.customForm.get('width')?.value).toBeNull();
  });

  it('persists the chosen unit via StorageService', async () => {
    const { component } = setup();
    const storage = TestBed.inject(STORAGE_SERVICE);
    component.setUnit('in');
    // setUnit fires a fire-and-forget storage.set; wait a microtask.
    await Promise.resolve();
    const stored = await storage.get('tank-setup.units');
    expect(stored).toBe('in');
  });

  describe('storage restore on init', () => {
    function setupWithStoredUnit(unit: unknown): TankSetupComponent {
      const storage = new FakeStorageService();
      // Hand-seed the storage. The "as never" cast lets us inject an
      // intentionally-invalid value to drive the input-validation branch.
      void storage.set('tank-setup.units', unit as never);
      TestBed.configureTestingModule({
        imports: [TankSetupComponent],
        providers: [
          provideMockStore({
            selectors: [
              { selector: selectTank, value: defaultScene().tank },
              { selector: selectTankPresetRef, value: null },
            ],
          }),
          { provide: STORAGE_SERVICE, useValue: storage },
        ],
      });
      const fixture = TestBed.createComponent(TankSetupComponent);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('restores a previously persisted unit (in)', async () => {
      const component = setupWithStoredUnit('in');
      await Promise.resolve();
      await Promise.resolve();
      expect(component.displayUnit()).toBe('in');
    });

    it('ignores a garbage stored value (defaults to cm)', async () => {
      const component = setupWithStoredUnit('not-a-unit');
      await Promise.resolve();
      await Promise.resolve();
      expect(component.displayUnit()).toBe('cm');
    });
  });

  describe('applyCustom defensive null guard', () => {
    it('returns without dispatch when a control bypasses validators but holds null', () => {
      const { component, store } = setup();
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      // Bypass validators and force a null value into the form. The form is
      // technically "valid" with respect to its declared validators because
      // we set the value programmatically without re-running them, BUT the
      // top-level applyCustom() check fires its defensive null guard.
      // We clear validators on width then re-set null.
      const widthCtl = component.customForm.get('width')!;
      widthCtl.clearValidators();
      component.customForm.setValue({ width: null, height: 300, depth: 300 });
      component.customForm.updateValueAndValidity();
      expect(component.customForm.invalid).toBe(false);
      component.applyCustom();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
