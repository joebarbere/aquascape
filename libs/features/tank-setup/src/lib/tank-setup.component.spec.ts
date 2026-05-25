// Component tests for `TankSetupComponent`. F1.1 Phase B; updated for the
// two-step Brand → Size picker.
//
// These are TestBed component tests rather than Angular Testing Library to
// avoid pulling in another dep in this PR. We assert:
//   - Step 1 shows 5 brand cards (4 brands + Custom) with correct counts.
//   - Picking a brand transitions to Step 2.
//   - Back-to-brands returns to Step 1.
//   - The active brand is highlighted on landing when `presetRef` is set.
//   - Step 2 / brand → preset list dispatches `dispatchCommand(setTankDimensions)`
//     AND `setTankPresetRef({ presetRef: ... })`.
//   - Custom-form validation: empty / below-min / above-max blocks submit.
//   - cm → in → cm round-trips the displayed value (rounding tolerance).
//   - The aspect-ratio warning appears for ratios outside [0.3, 4.0] but
//     does not disable submit.
//   - Submitting custom dimensions clears the presetRef.
//   - Every input has a `<label>` linked via `for`, and validation errors
//     are addressable through `aria-describedby`.
//   - The unit suffix is absolutely positioned (inside the input visually)
//     with `aria-hidden`, and the input reserves right padding for it.
//   - Enter on a focused size card selects it (keyboard operability).

import { TestBed } from '@angular/core/testing';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { defaultScene, selectTank, selectTankPresetRef } from '@aquascape/state';

import {
  TANK_SETUP_COLLAPSED_KEY,
  TankSetupComponent,
  inferTankShape,
} from './tank-setup.component';
import { tankPresets } from './tank-presets';
import type { TankBrand } from './tank-presets';

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

interface SetupOptions {
  presetRef?: { catalog: string; id: string; version: number } | null;
}

function setup(opts: SetupOptions = {}) {
  TestBed.configureTestingModule({
    imports: [TankSetupComponent],
    providers: [
      provideMockStore({
        selectors: [
          { selector: selectTank, value: defaultScene().tank },
          { selector: selectTankPresetRef, value: opts.presetRef ?? null },
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

/** Navigate to Step 2 for a given brand and run change detection. */
function navigateToBrand(
  fixture: ReturnType<typeof setup>['fixture'],
  brand: TankBrand | 'Custom',
): void {
  const card = (fixture.nativeElement as HTMLElement).querySelector(
    `[data-testid="brand-${brand}"]`,
  ) as HTMLButtonElement;
  card.click();
  fixture.detectChanges();
}

describe('TankSetupComponent', () => {
  describe('Step 1 — brand picker', () => {
    it('renders one card per real brand plus Custom (5 total)', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      const cards = root.querySelectorAll('.brand-card');
      expect(cards.length).toBe(5);
      const labels = Array.from(cards).map((c) => c.getAttribute('data-testid'));
      // (Each card carries `data-testid="brand-<Brand>"` exactly.)
      expect(labels).toEqual([
        'brand-ADA',
        'brand-UNS',
        'brand-Waterbox',
        'brand-Standard',
        'brand-Custom',
      ]);
    });

    it('shows the preset count on each real-brand card', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      const adaCount = tankPresets.filter((p) => p.brand === 'ADA').length;
      const unsCount = tankPresets.filter((p) => p.brand === 'UNS').length;
      expect(root.querySelector('[data-testid="brand-ADA"]')!.textContent).toContain(
        `${adaCount} tanks`,
      );
      expect(root.querySelector('[data-testid="brand-UNS"]')!.textContent).toContain(
        `${unsCount} tanks`,
      );
      // Custom never shows a count — it shows "Custom W×H×D" instead.
      expect(root.querySelector('[data-testid="brand-Custom"]')!.textContent).not.toMatch(
        /\d+\s+tanks?/,
      );
    });

    it('clicking a brand card transitions to the size view', () => {
      const { fixture, component } = setup();
      expect(component.view()).toBe('brands');
      navigateToBrand(fixture, 'ADA');
      expect(component.view()).toBe('sizes');
      expect(component.activeBrand()).toBe('ADA');
      const sizePicker = fixture.nativeElement.querySelector('[data-testid="size-picker"]');
      expect(sizePicker).not.toBeNull();
    });

    it('clicking the Custom card transitions to the custom form', () => {
      const { fixture, component } = setup();
      navigateToBrand(fixture, 'Custom');
      expect(component.view()).toBe('sizes');
      expect(component.activeBrand()).toBe('Custom');
      // The size grid is NOT painted; the custom form is.
      expect(
        fixture.nativeElement.querySelector('[data-testid="size-picker"]'),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="custom-wrap"]'),
      ).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="custom-width"]'),
      ).not.toBeNull();
    });

    it('highlights the active brand on initial render when presetRef is present', async () => {
      const { fixture, component } = setup({
        presetRef: { catalog: 'core', id: 'ada.mini-m', version: 1 },
      });
      // The presetRef → activeBrand sync runs in an Angular `effect()` that
      // reads a `toSignal()` projection of the store's BehaviorSubject. The
      // first sync value lands on the next microtask; the effect then needs
      // a change-detection pass to re-run. Drain both.
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      await Promise.resolve();
      fixture.detectChanges();
      expect(component.activeBrand()).toBe('ADA');
      const adaCard = fixture.nativeElement.querySelector(
        '[data-testid="brand-ADA"]',
      ) as HTMLButtonElement;
      expect(adaCard.classList.contains('is-active')).toBe(true);
      expect(adaCard.getAttribute('aria-current')).toBe('true');
      // But the view stays on 'brands' — the user gets a one-click jump from
      // the highlighted card without being teleported past it.
      expect(component.view()).toBe('brands');
    });

    it('back-to-brands returns to the brand view from Step 2', () => {
      const { fixture, component } = setup();
      navigateToBrand(fixture, 'ADA');
      const back = fixture.nativeElement.querySelector(
        '[data-testid="back-to-brands"]',
      ) as HTMLButtonElement;
      back.click();
      fixture.detectChanges();
      expect(component.view()).toBe('brands');
      // activeBrand intentionally persists so the highlight stays visible.
      expect(component.activeBrand()).toBe('ADA');
    });

    it('back-to-brands also works from the Custom branch', () => {
      const { fixture, component } = setup();
      navigateToBrand(fixture, 'Custom');
      const back = fixture.nativeElement.querySelector(
        '[data-testid="back-to-brands"]',
      ) as HTMLButtonElement;
      back.click();
      fixture.detectChanges();
      expect(component.view()).toBe('brands');
      expect(component.activeBrand()).toBe('Custom');
    });
  });

  describe('Step 2 — size picker (per brand)', () => {
    it('renders one size card per preset for the selected brand', () => {
      const { fixture } = setup();
      for (const brand of ['ADA', 'UNS', 'Waterbox', 'Standard'] as const) {
        navigateToBrand(fixture, brand);
        const expectedIds = tankPresets.filter((p) => p.brand === brand).map((p) => p.id);
        for (const id of expectedIds) {
          const card = fixture.nativeElement.querySelector(`[data-testid="preset-${id}"]`);
          expect(card).not.toBeNull();
        }
        // Go back so the next iteration starts from a clean slate.
        (
          fixture.nativeElement.querySelector('[data-testid="back-to-brands"]') as HTMLButtonElement
        ).click();
        fixture.detectChanges();
      }
    });

    it('wraps the size cards in a radiogroup labelled by the active brand', () => {
      const { fixture } = setup();
      navigateToBrand(fixture, 'UNS');
      const group = fixture.nativeElement.querySelector(
        '[data-testid="size-picker"] [role="radiogroup"]',
      );
      expect(group).not.toBeNull();
      expect(group!.getAttribute('aria-label')).toBe('UNS tanks');
    });

    it('each card carries the dimensions in the active display unit', () => {
      const { fixture } = setup();
      navigateToBrand(fixture, 'ADA');
      const miniM = fixture.nativeElement.querySelector(
        '[data-testid="preset-ada.mini-m"]',
      ) as HTMLElement;
      // Default unit is cm; Mini-M is 360 × 220 × 220 mm → 36.0 × 22.0 × 22.0 cm.
      expect(miniM.textContent).toContain('36.0 × 22.0 × 22.0 cm');
    });

    it('renders a silhouette SVG sized proportionally to the brand max', () => {
      const { fixture } = setup();
      navigateToBrand(fixture, 'ADA');
      const root = fixture.nativeElement as HTMLElement;
      // Mega-150 is the biggest ADA tank (1500 mm wide / 600 mm tall) and
      // should fill the silhouette area. Mini-M (360 × 220) should be
      // visibly smaller.
      const mega = root.querySelector('[data-testid="preset-ada.150-p"] svg') as SVGSVGElement;
      const mini = root.querySelector('[data-testid="preset-ada.mini-m"] svg') as SVGSVGElement;
      expect(mega).not.toBeNull();
      expect(mini).not.toBeNull();
      const megaW = Number(mega.getAttribute('width'));
      const miniW = Number(mini.getAttribute('width'));
      expect(megaW).toBeGreaterThan(miniW);
    });

    it('clicking a size card dispatches setTankDimensions + setTankPresetRef', () => {
      const { fixture, store } = setup();
      navigateToBrand(fixture, 'ADA');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const btn = fixture.nativeElement.querySelector(
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

    it('selects a size card via Enter while focused (keyboard operability)', () => {
      const { fixture, store } = setup();
      navigateToBrand(fixture, 'ADA');
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const btn = fixture.nativeElement.querySelector(
        '[data-testid="preset-ada.60-p"]',
      ) as HTMLButtonElement;
      btn.focus();
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('shows a Cube chip on cube tanks', () => {
      const { fixture } = setup();
      navigateToBrand(fixture, 'ADA');
      // ADA 30-C is 300 × 300 × 300 mm — a perfect cube.
      const chip = fixture.nativeElement.querySelector('[data-testid="chip-ada.30-c"]');
      expect(chip).not.toBeNull();
      expect(chip!.textContent?.trim()).toBe('Cube');
    });
  });

  describe('activePresets / activeBrandMaxDim defensive paths', () => {
    it('activePresets returns [] when no brand has been chosen', () => {
      const { component } = setup();
      expect(component.activeBrand()).toBeNull();
      expect(component.activePresets()).toEqual([]);
    });

    it('activePresets returns [] when activeBrand is Custom', () => {
      const { component } = setup();
      component.pickBrand('Custom');
      expect(component.activePresets()).toEqual([]);
    });

    it('activeBrandMaxDim returns 1 when no brand is picked (divide-by-zero guard)', () => {
      const { component } = setup();
      expect(component.activeBrandMaxDim()).toBe(1);
    });

    it('activeBrandMaxDim returns the largest dimension across the brand', () => {
      const { component } = setup();
      component.pickBrand('ADA');
      // ADA Mega-150 is the biggest at 1500 × 600 × 600 mm; max axis is 1500.
      expect(component.activeBrandMaxDim()).toBe(1500);
    });
  });

  describe('inferTankShape', () => {
    it('returns Cube when all axes are within 10%', () => {
      expect(inferTankShape({ width: 300, height: 300, depth: 300 })).toBe('Cube');
      expect(inferTankShape({ width: 300, height: 310, depth: 290 })).toBe('Cube');
    });
    it('returns Long when width ≥ 2× height', () => {
      expect(inferTankShape({ width: 1500, height: 300, depth: 400 })).toBe('Long');
    });
    it('returns Shallow when depth > height (but not Long)', () => {
      // 350 × 200 × 300: not a cube (200 mm spread is > 10% of 350), not Long
      // (350 < 2×200), and depth (300) exceeds height (200) → "Shallow".
      expect(inferTankShape({ width: 350, height: 200, depth: 300 })).toBe('Shallow');
    });
    it('returns null for everything else', () => {
      expect(inferTankShape({ width: 600, height: 360, depth: 300 })).toBeNull();
    });
  });

  describe('custom form validation', () => {
    function setupOnCustom() {
      const env = setup();
      navigateToBrand(env.fixture, 'Custom');
      return env;
    }

    it('apply button is disabled when the form is empty', () => {
      const { fixture, component } = setupOnCustom();
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
      const { fixture, component } = setupOnCustom();
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
      const { fixture, component } = setupOnCustom();
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
      const { fixture } = setupOnCustom();
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="custom-width"]',
      ) as HTMLInputElement;
      expect(input.getAttribute('aria-describedby')).toContain('width-error');
    });

    it('every input has a label linked via for=', () => {
      const { fixture } = setupOnCustom();
      const root = fixture.nativeElement as HTMLElement;
      for (const id of ['custom-width', 'custom-height', 'custom-depth']) {
        const input = root.querySelector(`#${id}`) as HTMLInputElement;
        const label = root.querySelector(`label[for="${id}"]`) as HTMLLabelElement;
        expect(input).not.toBeNull();
        expect(label).not.toBeNull();
      }
    });

    it('unit suffix is aria-hidden (Task B)', () => {
      const { fixture } = setupOnCustom();
      const root = fixture.nativeElement as HTMLElement;
      const unit = root.querySelector('.custom__input-wrap .custom__unit') as HTMLElement;
      expect(unit).not.toBeNull();
      expect(unit.getAttribute('aria-hidden')).toBe('true');
    });

    it('wraps each input in a .custom__input-wrap container (Task B)', () => {
      const { fixture } = setupOnCustom();
      const root = fixture.nativeElement as HTMLElement;
      const wraps = root.querySelectorAll('.custom__input-wrap');
      expect(wraps.length).toBe(3);
      for (const wrap of Array.from(wraps)) {
        expect(wrap.querySelector('input')).not.toBeNull();
        expect(wrap.querySelector('.custom__unit')).not.toBeNull();
      }
    });

    it('CSS rules define an absolutely-positioned unit + padded input (Task B)', () => {
      // jsdom doesn't run a real layout engine, so we verify the
      // load-bearing CSS contract by inspecting the component's stylesheet
      // source. (The structural tests above prove the DOM is wired up
      // correctly; this asserts the styling that prevents the previous
      // overlap regression.)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path') as typeof import('path');
      const css = fs.readFileSync(
        path.resolve(__dirname, 'tank-setup.component.css'),
        'utf8',
      );
      // Unit suffix lives inside the input visually, never blocks pointer.
      expect(css).toMatch(/\.custom__unit\s*\{[^}]*position:\s*absolute/);
      expect(css).toMatch(/\.custom__unit\s*\{[^}]*pointer-events:\s*none/);
      // The input reserves enough right padding (2.5rem) so the unit suffix
      // doesn't overlap the typed numeric value.
      expect(css).toMatch(/\.custom__input-wrap\s+input\s*\{[^}]*padding:[^;]*2\.5rem/);
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

    it('unit toggle is visible at the body root, outside the two-step picker', () => {
      const { fixture } = setup();
      // The unit toggle is rendered above the brand picker and stays visible
      // on Step 2 as well — verify it lives outside the brand-picker /
      // size-picker / custom-wrap subtrees.
      const root = fixture.nativeElement as HTMLElement;
      const toggle = root.querySelector('.unit-toggle') as HTMLElement;
      expect(toggle).not.toBeNull();
      expect(toggle.closest('.brand-picker')).toBeNull();
      expect(toggle.closest('.size-picker')).toBeNull();
      expect(toggle.closest('.custom-wrap')).toBeNull();
    });
  });

  describe('aspect-ratio warning', () => {
    function setupOnCustom() {
      const env = setup();
      navigateToBrand(env.fixture, 'Custom');
      return env;
    }

    it('appears for very wide ratios but does not block submit', () => {
      const { fixture, component } = setupOnCustom();
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
      const { fixture, component } = setupOnCustom();
      component.customForm.setValue({ width: 600, height: 360, depth: 360 });
      fixture.detectChanges();
      const warning = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="aspect-warning"]',
      ) as HTMLElement;
      expect(warning.hidden).toBe(true);
    });
  });

  describe('apply custom', () => {
    function setupOnCustom() {
      const env = setup();
      navigateToBrand(env.fixture, 'Custom');
      return env;
    }

    it('dispatches setTankDimensions + clears presetRef', () => {
      const { fixture, component, store } = setupOnCustom();
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
      const { fixture, component, store } = setupOnCustom();
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

  describe('collapsible header (Task A)', () => {
    it('renders the header as a button with aria-expanded=true by default', () => {
      const { fixture } = setup();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.getAttribute('aria-controls')).toBe('tank-setup-body');
    });

    it('clicking the header toggles the collapsed signal and hides the body', () => {
      const { fixture, component } = setup();
      const toggle = fixture.nativeElement.querySelector(
        '.panel-header__toggle',
      ) as HTMLButtonElement;
      const body = fixture.nativeElement.querySelector('#tank-setup-body') as HTMLElement;
      expect(component.collapsed()).toBe(false);
      expect(body.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(component.collapsed()).toBe(true);
      expect(body.hidden).toBe(true);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('persists collapsed state to StorageService on toggle', async () => {
      const { component } = setup();
      const storage = TestBed.inject(STORAGE_SERVICE);
      component.toggleCollapsed();
      await Promise.resolve();
      await Promise.resolve();
      const stored = await storage.get<boolean>(TANK_SETUP_COLLAPSED_KEY);
      expect(stored).toBe(true);
    });

    it('hydrates the collapsed signal from StorageService on init', async () => {
      // Manual setup mirroring the setupWithStoredUnit pattern.
      const storage = new FakeStorageService();
      await storage.set(TANK_SETUP_COLLAPSED_KEY, true);
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
      await Promise.resolve();
      await Promise.resolve();
      expect(fixture.componentInstance.collapsed()).toBe(true);
    });
  });
});
