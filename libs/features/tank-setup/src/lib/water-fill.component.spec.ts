// Component tests for `WaterFillComponent`.
//
// The control authors `Tank.waterLevelMm` through the Command pipeline
// (`SceneActions.dispatchCommand(setWaterLevel(...))`). We assert:
//   - An untouched document renders the EFFECTIVE default fill
//     (`height − 25 mm`), badged "Auto", with the Auto button disabled.
//   - Committing a mm value (blur / Enter) dispatches `SetWaterLevel`.
//   - Committing in gallons converts through the tank footprint
//     (600 × 300 mm → 0.18 L per mm) before dispatching integer mm.
//   - Out-of-range input clamps to [1, tank.height] before dispatch (the
//     domain rejects rather than clamps).
//   - Auto dispatches `setWaterLevel(null)` and is a no-op when already
//     on the default.
//   - Invalid input reverts the field; committing the unchanged authored
//     value does not dispatch.
//   - a11y: labelled input, unit group + aria-pressed, labelled Auto.
//   - The unit choice persists via StorageService and rehydrates on init.

import { TestBed } from '@angular/core/testing';
import type { Tank } from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { selectTank } from '@aquascape/state';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { WaterFillComponent } from './water-fill.component';
import { WATER_FILL_UNIT_STORAGE_KEY } from './units';

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

/**
 * Test tank with a clean-numbers footprint: 600 × 300 mm → exactly 0.18 L
 * per mm of water level. Height 360 mm → effective default fill 335 mm.
 */
function testTank(waterLevelMm?: number): Tank {
  const tank: Tank = {
    width: 600,
    height: 360,
    depth: 300,
    style: { frame: 'rimless', background: { kind: 'none' } },
  };
  return waterLevelMm === undefined ? tank : { ...tank, waterLevelMm };
}

interface SetupOptions {
  tank?: Tank;
  storage?: StorageService;
}

function setup(opts: SetupOptions = {}) {
  TestBed.configureTestingModule({
    imports: [WaterFillComponent],
    providers: [
      provideMockStore({
        selectors: [{ selector: selectTank, value: opts.tank ?? testTank() }],
      }),
      { provide: STORAGE_SERVICE, useValue: opts.storage ?? new FakeStorageService() },
    ],
  });
  const fixture = TestBed.createComponent(WaterFillComponent);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    component: fixture.componentInstance,
    store: TestBed.inject(MockStore),
    input: root.querySelector('[data-testid="water-fill-input"]') as HTMLInputElement,
    root,
  };
}

/** Set the input's value and fire a blur-commit. */
function commitValue(env: ReturnType<typeof setup>, value: string): void {
  env.input.value = value;
  env.input.dispatchEvent(new Event('blur'));
  env.fixture.detectChanges();
}

describe('WaterFillComponent', () => {
  describe('effective default display', () => {
    it('shows the derived default fill for an untouched document', () => {
      const { input } = setup();
      // 360 mm height − 25 mm gap = 335 mm.
      expect(input.value).toBe('335');
    });

    it('badges the default as Auto and disables the Auto button', () => {
      const { root } = setup();
      expect(root.querySelector('[data-testid="water-fill-status"]')!.textContent!.trim()).toBe(
        'Auto',
      );
      const auto = root.querySelector('[data-testid="water-fill-auto"]') as HTMLButtonElement;
      expect(auto.disabled).toBe(true);
    });

    it('badges an authored level as Custom and enables Auto', () => {
      const { root } = setup({ tank: testTank(150) });
      expect(root.querySelector('[data-testid="water-fill-status"]')!.textContent!.trim()).toBe(
        'Custom',
      );
      const auto = root.querySelector('[data-testid="water-fill-auto"]') as HTMLButtonElement;
      expect(auto.disabled).toBe(false);
    });

    it('shows the default fill in gallons too (335 mm at 600×300 = 15.9 gal)', () => {
      const env = setup();
      env.component.setUnit('gal');
      env.fixture.detectChanges();
      expect(env.input.value).toBe('15.9');
    });
  });

  describe('mm commit', () => {
    it('dispatches SetWaterLevel with the typed integer mm on blur', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '200');
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const action = dispatchSpy.mock.calls[0]![0] as {
        type: string;
        command: { kind: string; waterLevelMm: number | null };
      };
      expect(action.type).toBe('[Scene] Dispatch Command');
      expect(action.command.kind).toBe('SetWaterLevel');
      expect(action.command.waterLevelMm).toBe(200);
    });

    it('commits on Enter as well', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      env.input.value = '180';
      env.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      env.fixture.detectChanges();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const action = dispatchSpy.mock.calls[0]![0] as {
        command: { kind: string; waterLevelMm: number | null };
      };
      expect(action.command).toMatchObject({ kind: 'SetWaterLevel', waterLevelMm: 180 });
    });

    it('rounds fractional mm before dispatch', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '210.6');
      const action = dispatchSpy.mock.calls[0]![0] as {
        command: { waterLevelMm: number | null };
      };
      expect(action.command.waterLevelMm).toBe(211);
      expect(env.input.value).toBe('211');
    });
  });

  describe('gal commit', () => {
    it('converts gallons → mm through the footprint (10 gal at 600×300 → 210 mm)', () => {
      const env = setup();
      env.component.setUnit('gal');
      env.fixture.detectChanges();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '10');
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const action = dispatchSpy.mock.calls[0]![0] as {
        command: { kind: string; waterLevelMm: number | null };
      };
      expect(action.command).toMatchObject({ kind: 'SetWaterLevel', waterLevelMm: 210 });
      // The field reflects the canonical (rounded-mm) value re-formatted
      // in gallons: 210 mm = 37.8 L = 9.98… gal → "10.0".
      expect(env.input.value).toBe('10.0');
    });
  });

  describe('clamping (the domain rejects; the UI clamps before dispatch)', () => {
    it('clamps above tank.height down to the height', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '9999');
      const action = dispatchSpy.mock.calls[0]![0] as {
        command: { waterLevelMm: number | null };
      };
      expect(action.command.waterLevelMm).toBe(360);
      expect(env.input.value).toBe('360');
    });

    it('clamps zero / negative input up to 1 mm', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '0');
      expect(
        (dispatchSpy.mock.calls[0]![0] as { command: { waterLevelMm: number | null } }).command
          .waterLevelMm,
      ).toBe(1);
    });

    it('clamps oversized gallon input to a brim-full tank', () => {
      const env = setup();
      env.component.setUnit('gal');
      env.fixture.detectChanges();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '500');
      expect(
        (dispatchSpy.mock.calls[0]![0] as { command: { waterLevelMm: number | null } }).command
          .waterLevelMm,
      ).toBe(360);
    });
  });

  describe('Auto', () => {
    it('dispatches setWaterLevel(null) when a level is authored', () => {
      const env = setup({ tank: testTank(150) });
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      (env.root.querySelector('[data-testid="water-fill-auto"]') as HTMLButtonElement).click();
      env.fixture.detectChanges();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const action = dispatchSpy.mock.calls[0]![0] as {
        type: string;
        command: { kind: string; waterLevelMm: number | null };
      };
      expect(action.type).toBe('[Scene] Dispatch Command');
      expect(action.command).toMatchObject({ kind: 'SetWaterLevel', waterLevelMm: null });
    });

    it('is a no-op when already on the default', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      env.component.setAuto();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('no-op + invalid input handling', () => {
    it('does not dispatch when committing the unchanged authored value', () => {
      const env = setup({ tank: testTank(200) });
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, '200');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('reverts the field to the canonical display on unparsable input', () => {
      const env = setup();
      const dispatchSpy = jest.spyOn(env.store, 'dispatch');
      commitValue(env, 'not-a-number');
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(env.input.value).toBe('335');
    });
  });

  describe('accessibility', () => {
    it('labels the input via for=', () => {
      const { root, input } = setup();
      expect(input.id).toBe('water-fill-level');
      expect(root.querySelector('label[for="water-fill-level"]')).not.toBeNull();
    });

    it('links the input to the range help text via aria-describedby', () => {
      const { root, input } = setup();
      expect(input.getAttribute('aria-describedby')).toBe('water-fill-help');
      expect(root.querySelector('#water-fill-help')).not.toBeNull();
    });

    it('wraps the unit buttons in a labelled group with aria-pressed state', () => {
      const env = setup();
      const group = env.root.querySelector('.water-fill__units') as HTMLElement;
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')).toBe('Water fill unit');
      expect(
        env.root.querySelector('[data-testid="water-unit-mm"]')!.getAttribute('aria-pressed'),
      ).toBe('true');
      expect(
        env.root.querySelector('[data-testid="water-unit-gal"]')!.getAttribute('aria-pressed'),
      ).toBe('false');
      (env.root.querySelector('[data-testid="water-unit-gal"]') as HTMLButtonElement).click();
      env.fixture.detectChanges();
      expect(
        env.root.querySelector('[data-testid="water-unit-gal"]')!.getAttribute('aria-pressed'),
      ).toBe('true');
    });

    it('gives the Auto button an explicit aria-label', () => {
      const { root } = setup();
      const auto = root.querySelector('[data-testid="water-fill-auto"]') as HTMLButtonElement;
      expect(auto.getAttribute('aria-label')).toBe(
        'Reset water fill to the automatic default level',
      );
    });

    it('keeps the unit suffix decorative (aria-hidden) inside the input wrap', () => {
      const { root } = setup();
      const unit = root.querySelector('.water-fill__unit') as HTMLElement;
      expect(unit.getAttribute('aria-hidden')).toBe('true');
    });

    it('sets min/max/step on the input per unit', () => {
      const env = setup();
      expect(env.input.getAttribute('min')).toBe('1');
      expect(env.input.getAttribute('max')).toBe('360');
      expect(env.input.getAttribute('step')).toBe('1');
      env.component.setUnit('gal');
      env.fixture.detectChanges();
      expect(env.input.getAttribute('min')).toBe('0.0');
      // Brim-full 600×300×360 = 64.8 L = 17.1 gal.
      expect(env.input.getAttribute('max')).toBe('17.1');
      expect(env.input.getAttribute('step')).toBe('0.1');
    });
  });

  describe('unit persistence', () => {
    it('persists the chosen unit via StorageService', async () => {
      const env = setup();
      const storage = TestBed.inject(STORAGE_SERVICE);
      env.component.setUnit('gal');
      await Promise.resolve();
      expect(await storage.get(WATER_FILL_UNIT_STORAGE_KEY)).toBe('gal');
    });

    it('rehydrates a previously persisted unit on init', async () => {
      const storage = new FakeStorageService();
      await storage.set(WATER_FILL_UNIT_STORAGE_KEY, 'gal');
      const env = setup({ storage });
      await Promise.resolve();
      await Promise.resolve();
      env.fixture.detectChanges();
      expect(env.component.unit()).toBe('gal');
      expect(env.input.value).toBe('15.9');
    });

    it('ignores a garbage stored value (stays on mm)', async () => {
      const storage = new FakeStorageService();
      await storage.set(WATER_FILL_UNIT_STORAGE_KEY, 'litres');
      const env = setup({ storage });
      await Promise.resolve();
      await Promise.resolve();
      expect(env.component.unit()).toBe('mm');
    });
  });
});
