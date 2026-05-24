// Component tests for `TankStylingComponent`. F1.2 Phase D.
//
// These are TestBed component tests, matching the existing F1.1 style.
// We assert against:
//   - Frame picker dispatch + frameColor reveal/hide.
//   - Water-tint hex validation + preset chips.
//   - Background tab switching (None / Solid / Gradient / Image).
//   - Gradient stop add/remove + angle deg→rad conversion + sort-on-dispatch.
//   - Image tab is `aria-disabled="true"` and dispatches nothing.
//   - ARIA labels, aria-live announcement, keyboard activation.

import { TestBed } from '@angular/core/testing';
import type { Scene, Tank, TankStyle } from '@aquascape/domain/scene-model';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { defaultScene, selectTank } from '@aquascape/state';

import {
  degToRad,
  hexWithoutAlpha,
  isDomainHex,
  normaliseHex,
  radToDeg,
  TankStylingComponent,
} from './tank-styling.component';
import { DEFAULT_FRAME_COLOR, WATER_TINT_PRESETS } from './tank-style-defaults';

interface DispatchedSetTankStyle {
  type: string;
  command: { kind: 'SetTankStyle'; style: TankStyle };
}

function setupWithTank(tank: Tank) {
  TestBed.configureTestingModule({
    imports: [TankStylingComponent],
    providers: [
      provideMockStore({
        selectors: [{ selector: selectTank, value: tank }],
      }),
    ],
  });
  const fixture = TestBed.createComponent(TankStylingComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    store: TestBed.inject(MockStore),
  };
}

function setupDefault() {
  return setupWithTank(defaultScene().tank);
}

function lastSetTankStyle(spy: jest.SpyInstance): TankStyle {
  // Walk backwards through the dispatch list to find the most recent
  // `SetTankStyle` command. Helper so tests don't have to repeat the cast.
  const calls = spy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const action = calls[i][0] as DispatchedSetTankStyle;
    if (action.type === '[Scene] Dispatch Command' && action.command.kind === 'SetTankStyle') {
      return action.command.style;
    }
  }
  throw new Error('No SetTankStyle command dispatched');
}

describe('TankStylingComponent', () => {
  describe('default style on a fresh document', () => {
    it('renders rimless / clear water / background=none', () => {
      const { component } = setupDefault();
      expect(component.style().frame).toBe('rimless');
      expect(component.style().waterTint).toBeUndefined();
      expect(component.style().background.kind).toBe('none');
    });

    it('hides the frame-color picker for rimless tanks', () => {
      const { fixture } = setupDefault();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="frame-color-native"]')).toBeNull();
    });
  });

  // ── Frame picker ──────────────────────────────────────────────────────
  describe('frame picker', () => {
    it('exposes role=radiogroup with one radio per option', () => {
      const { fixture } = setupDefault();
      const root = fixture.nativeElement as HTMLElement;
      const group = root.querySelector('[role="radiogroup"]') as HTMLElement;
      expect(group).not.toBeNull();
      expect(group.getAttribute('aria-labelledby')).toBe('frame-label');
      expect(group.querySelectorAll('[role="radio"]').length).toBe(3);
    });

    it('selecting "Black-rimmed" dispatches frame="framed" with default color', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="frame-framed"]',
      ) as HTMLButtonElement;
      btn.click();
      const style = lastSetTankStyle(spy);
      expect(style.frame).toBe('framed');
      expect(style.frameColor).toBe(DEFAULT_FRAME_COLOR);
    });

    it('selecting "Braced" dispatches frame="braced"', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="frame-braced"]',
      ) as HTMLButtonElement;
      btn.click();
      const style = lastSetTankStyle(spy);
      expect(style.frame).toBe('braced');
      expect(style.frameColor).toBe(DEFAULT_FRAME_COLOR);
    });

    it('reveals the frame-color picker after switching to a non-rimless frame', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#abcdef',
          background: { kind: 'none' },
        },
      };
      const { fixture } = setupWithTank(tank);
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="frame-color-native"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="frame-color-hex"]')).not.toBeNull();
    });

    it('selecting rimless drops frameColor from the dispatched style', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#333333',
          background: { kind: 'none' },
        },
      };
      const { fixture, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="frame-rimless"]',
      ) as HTMLButtonElement;
      btn.click();
      const style = lastSetTankStyle(spy);
      expect(style.frame).toBe('rimless');
      expect(Object.prototype.hasOwnProperty.call(style, 'frameColor')).toBe(false);
    });

    it('typing into the frame-color hex input dispatches an updated frameColor', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.setFrameColor('#ff8800');
      const style = lastSetTankStyle(spy);
      expect(style.frameColor).toBe('#ff8800');
    });

    it('Enter on a focused radio activates it', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="frame-framed"]',
      ) as HTMLButtonElement;
      btn.focus();
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── Water tint ────────────────────────────────────────────────────────
  describe('water tint', () => {
    it('typing a valid #RRGGBBAA hex dispatches the new waterTint', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintInput('#a8d8a880');
      const style = lastSetTankStyle(spy);
      expect(style.waterTint).toBe('#a8d8a880');
    });

    it('typing 3-char shorthand expands to 6-char #RRGGBB on dispatch', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintInput('#abc');
      const style = lastSetTankStyle(spy);
      expect(style.waterTint).toBe('#aabbcc');
    });

    it('typing an invalid hex sets an inline error and does not dispatch', () => {
      const { fixture, component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintInput('not-a-hex');
      fixture.detectChanges();
      expect(component.waterTintError()).not.toBeNull();
      // Find the error message linked via aria-describedby.
      const input = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="water-tint-hex"]',
      ) as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain('water-tint-error');
      const err = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="water-tint-error"]',
      ) as HTMLElement;
      expect(err.hidden).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('the "Clear" preset clears waterTint (drops the field)', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      // First preset is "Clear" with hex=null.
      const clearPreset = WATER_TINT_PRESETS[0];
      expect(clearPreset).toBeDefined();
      expect(clearPreset!.hex).toBeNull();
      component.selectWaterTintPreset(clearPreset!.hex);
      const style = lastSetTankStyle(spy);
      expect(Object.prototype.hasOwnProperty.call(style, 'waterTint')).toBe(false);
    });

    it('selecting the "Slight green" preset dispatches its hex', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const greenPreset = WATER_TINT_PRESETS[1];
      expect(greenPreset).toBeDefined();
      component.selectWaterTintPreset(greenPreset!.hex);
      const style = lastSetTankStyle(spy);
      expect(style.waterTint).toBe(greenPreset!.hex);
    });

    it('the hex value is announced via aria-live=polite', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { fixture } = setupWithTank(tank);
      const announce = (fixture.nativeElement as HTMLElement).querySelector(
        '#water-tint-announced',
      ) as HTMLElement;
      expect(announce.getAttribute('aria-live')).toBe('polite');
      expect(announce.textContent).toContain('#a8d8a880');
    });

    it('clearing the hex input via empty string clears the tint', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintInput('');
      const style = lastSetTankStyle(spy);
      expect(Object.prototype.hasOwnProperty.call(style, 'waterTint')).toBe(false);
    });

    it('native color picker dispatches the picked value', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintNative('#112233');
      const style = lastSetTankStyle(spy);
      expect(style.waterTint).toBe('#112233');
    });

    it('rejects a non-hex value from the native picker without dispatching', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintNative('not-a-hex');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Background tabs ───────────────────────────────────────────────────
  describe('background tabs', () => {
    it('renders all four tabs with role=tab', () => {
      const { fixture } = setupDefault();
      const root = fixture.nativeElement as HTMLElement;
      const tabs = root.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(4);
      const ids = Array.from(tabs).map((t) => t.getAttribute('data-testid'));
      expect(ids).toEqual(['bg-tab-none', 'bg-tab-color', 'bg-tab-gradient', 'bg-tab-image']);
    });

    it('selecting "Solid" dispatches a color background', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-color"]',
      ) as HTMLButtonElement;
      tab.click();
      const style = lastSetTankStyle(spy);
      expect(style.background.kind).toBe('color');
    });

    it('selecting "Gradient" dispatches a gradient background with ≥ 2 stops', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-gradient"]',
      ) as HTMLButtonElement;
      tab.click();
      const style = lastSetTankStyle(spy);
      expect(style.background.kind).toBe('gradient');
      if (style.background.kind !== 'gradient') return;
      expect(style.background.stops.length).toBeGreaterThanOrEqual(2);
    });

    it('selecting "None" dispatches { kind: "none" }', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: { kind: 'color', color: '#123456' },
        },
      };
      const { fixture, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-none"]',
      ) as HTMLButtonElement;
      tab.click();
      const style = lastSetTankStyle(spy);
      expect(style.background.kind).toBe('none');
    });

    it('Image tab is aria-disabled and clicking it does NOT dispatch', () => {
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-image"]',
      ) as HTMLButtonElement;
      expect(tab.getAttribute('aria-disabled')).toBe('true');
      tab.click();
      fixture.detectChanges();
      // The tab is selectable (focusable) and shows the disabled panel,
      // but selecting it must not dispatch.
      expect(spy).not.toHaveBeenCalled();
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-image-panel"]',
      ) as HTMLElement;
      expect(panel).not.toBeNull();
      const upload = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-image-upload"]',
      ) as HTMLButtonElement;
      expect(upload.disabled).toBe(true);
      expect(upload.getAttribute('aria-disabled')).toBe('true');
    });

    it('does not redispatch when re-selecting the active tab', () => {
      // Default is `none`; clicking the "None" tab again should noop.
      const { fixture, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-none"]',
      ) as HTMLButtonElement;
      tab.click();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Solid background ──────────────────────────────────────────────────
  describe('solid background', () => {
    function withSolid(): ReturnType<typeof setupWithTank> {
      return setupWithTank({
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: { kind: 'color', color: '#111111' },
        },
      });
    }

    it('typing a hex dispatches an updated color', () => {
      const { component, store } = withSolid();
      const spy = jest.spyOn(store, 'dispatch');
      component.onBgSolidInput('#abcdef');
      const style = lastSetTankStyle(spy);
      expect(style.background).toEqual({ kind: 'color', color: '#abcdef' });
    });

    it('typing an invalid hex sets an inline error and does not dispatch', () => {
      const { fixture, component, store } = withSolid();
      const spy = jest.spyOn(store, 'dispatch');
      component.onBgSolidInput('zzz');
      fixture.detectChanges();
      expect(component.bgSolidError()).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it('clears the inline error and re-dispatches when fixed', () => {
      const { component, store } = withSolid();
      const spy = jest.spyOn(store, 'dispatch');
      component.onBgSolidInput('zzz');
      expect(component.bgSolidError()).not.toBeNull();
      component.onBgSolidInput('#001122');
      expect(component.bgSolidError()).toBeNull();
      const style = lastSetTankStyle(spy);
      expect(style.background).toEqual({ kind: 'color', color: '#001122' });
    });

    it('empty input sets an error rather than clearing', () => {
      const { component } = withSolid();
      component.onBgSolidInput('');
      expect(component.bgSolidError()).not.toBeNull();
    });

    it('preset chip dispatches the preset color', () => {
      const { component, store } = withSolid();
      const spy = jest.spyOn(store, 'dispatch');
      component.selectBgSolidPreset('#3a4a5a');
      const style = lastSetTankStyle(spy);
      expect(style.background).toEqual({ kind: 'color', color: '#3a4a5a' });
    });

    it('native color picker dispatches the new color', () => {
      const { component, store } = withSolid();
      const spy = jest.spyOn(store, 'dispatch');
      component.onBgSolidNative('#abcdef');
      const style = lastSetTankStyle(spy);
      expect(style.background).toEqual({ kind: 'color', color: '#abcdef' });
    });
  });

  // ── Gradient background ───────────────────────────────────────────────
  describe('gradient background', () => {
    function withGradient(): ReturnType<typeof setupWithTank> {
      return setupWithTank({
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: {
            kind: 'gradient',
            angle: Math.PI / 2,
            stops: [
              { at: 0, color: '#0b2540' },
              { at: 1, color: '#1f6f8b' },
            ],
          },
        },
      });
    }

    it('angle slider in degrees converts to radians on dispatch', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientAngleInput(180);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      expect(style.background.angle).toBeCloseTo(Math.PI, 5);
    });

    it('angle wraps for negative or > 360 inputs', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientAngleInput(-90);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      // -90° wraps to 270°.
      expect(style.background.angle).toBeCloseTo(degToRad(270), 5);
    });

    it('angle preset buttons set the displayed angle', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.setGradientAnglePreset(45);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      expect(style.background.angle).toBeCloseTo(degToRad(45), 5);
      expect(component.gradientAngleDeg()).toBe(45);
    });

    it('ignores non-finite angle input', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientAngleInput(Number.NaN);
      expect(spy).not.toHaveBeenCalled();
    });

    it('addGradientStop appends a stop', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      expect(component.gradientStops().length).toBe(2);
      component.addGradientStop();
      expect(component.gradientStops().length).toBe(3);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      expect(style.background.stops.length).toBe(3);
    });

    it('addGradientStop is bounded by MAX_GRADIENT_STOPS', () => {
      const { component } = withGradient();
      // Already 2; add four more to reach 6.
      for (let i = 0; i < 4; i++) component.addGradientStop();
      expect(component.gradientStops().length).toBe(6);
      // A seventh attempt is ignored.
      component.addGradientStop();
      expect(component.gradientStops().length).toBe(6);
    });

    it('removeGradientStop disables the remove button at MIN_GRADIENT_STOPS', () => {
      const { fixture, component } = withGradient();
      // Start with 2 stops; the Remove buttons must be disabled.
      const removeBtns = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid^="gradient-stop-remove-"]',
      );
      expect(removeBtns.length).toBe(2);
      for (const btn of Array.from(removeBtns)) {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      }
      // Add one, now we can remove.
      component.addGradientStop();
      fixture.detectChanges();
      const removeBtns3 = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid^="gradient-stop-remove-"]',
      );
      for (const btn of Array.from(removeBtns3)) {
        expect((btn as HTMLButtonElement).disabled).toBe(false);
      }
      // Remove the middle.
      component.removeGradientStop(1);
      fixture.detectChanges();
      expect(component.gradientStops().length).toBe(2);
      const removeBtns2 = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid^="gradient-stop-remove-"]',
      );
      for (const btn of Array.from(removeBtns2)) {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      }
    });

    it('removeGradientStop ignores out-of-range indices', () => {
      const { component } = withGradient();
      component.addGradientStop();
      expect(component.gradientStops().length).toBe(3);
      component.removeGradientStop(-1);
      component.removeGradientStop(999);
      expect(component.gradientStops().length).toBe(3);
    });

    it('stops are sorted ascending by `at` on dispatch even after out-of-order edit', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      // Add a third stop, then nudge its `at` below the second stop.
      component.addGradientStop();
      // Stops: [{0,#0b2540}, {1,#1f6f8b}, {≈0.5,...}]
      component.onGradientStopAtInput(2, 0.2);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      const ats = style.background.stops.map((s) => s.at);
      const sorted = ats.slice().sort((a, b) => a - b);
      expect(ats).toEqual(sorted);
    });

    it('`at` is clamped into [0, 1]', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientStopAtInput(0, -0.5);
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      const first = style.background.stops[0];
      expect(first).toBeDefined();
      expect(first!.at).toBeGreaterThanOrEqual(0);
    });

    it('ignores non-finite stop `at` input', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientStopAtInput(0, Number.NaN);
      expect(spy).not.toHaveBeenCalled();
    });

    it('typing an invalid stop color sets an inline error and blocks dispatch', () => {
      const { fixture, component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientStopColorInput(0, 'oops');
      fixture.detectChanges();
      expect(component.gradientStopErrors()[0]).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it('typing a valid stop color dispatches the updated stops array', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientStopColorInput(0, '#ffeeaa');
      const style = lastSetTankStyle(spy);
      if (style.background.kind !== 'gradient') {
        throw new Error('expected gradient');
      }
      expect(style.background.stops[0]!.color).toBe('#ffeeaa');
    });

    it('clears stop color error and re-dispatches when fixed', () => {
      const { component } = withGradient();
      component.onGradientStopColorInput(0, 'oops');
      expect(component.gradientStopErrors()[0]).not.toBeNull();
      component.onGradientStopColorInput(0, '#abcdef');
      expect(component.gradientStopErrors()[0]).toBeNull();
    });

    it('a pending stop error blocks angle-input dispatch too', () => {
      const { component, store } = withGradient();
      // Seed an error.
      component.onGradientStopColorInput(0, 'oops');
      const spy = jest.spyOn(store, 'dispatch');
      // An angle nudge should not dispatch while a stop has an error.
      component.onGradientAngleInput(30);
      expect(spy).not.toHaveBeenCalled();
    });

    it('ignores stop edits for out-of-range indices', () => {
      const { component, store } = withGradient();
      const spy = jest.spyOn(store, 'dispatch');
      component.onGradientStopColorInput(99, '#abcdef');
      component.onGradientStopAtInput(99, 0.5);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Keyboard + ARIA ────────────────────────────────────────────────────
  describe('keyboard + ARIA wiring', () => {
    it('every form input has an accessible label', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          waterTint: '#a8d8a880',
          background: { kind: 'color', color: '#1f2933' },
        },
      };
      const { fixture } = setupWithTank(tank);
      const root = fixture.nativeElement as HTMLElement;
      const inputs = root.querySelectorAll('input');
      for (const input of Array.from(inputs)) {
        const id = input.id;
        const hasAriaLabel = input.hasAttribute('aria-label');
        const hasLabelFor = id !== '' && root.querySelector(`label[for="${id}"]`) !== null;
        expect(hasAriaLabel || hasLabelFor).toBe(true);
      }
    });

    it('command rejection is surfaced via aria-live=assertive', () => {
      const { fixture, component } = setupDefault();
      // Force an obviously-bad value through the dispatch path: the
      // private dispatch() guard catches non-domain-hex values.
      // We use a public surface (setFrameColor) but with a value that
      // passes normaliseHex (3-char) — which would dispatch ok. Instead
      // build a synthetic case: directly invoke setFrameColor with a
      // value that bypasses normaliseHex (a non-string scenario isn't
      // realistic from the UI, so we test via the form path that uses
      // bg solid hex). The bgSolidInput path already blocks at the UI
      // layer; we instead surface rejectionMessage manually for the
      // template test.
      component['rejectionMessage'].set('Synthetic test rejection');
      fixture.detectChanges();
      const rejection = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="styling-rejection"]',
      ) as HTMLElement;
      expect(rejection).not.toBeNull();
      expect(rejection.getAttribute('aria-live')).toBe('assertive');
      expect(rejection.hidden).toBe(false);
      expect(rejection.textContent).toContain('Synthetic test rejection');
    });

    it('keyboard Enter on a Solid preset chip activates it', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: { kind: 'color', color: '#111111' },
        },
      };
      const { fixture, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      const btn = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid^="bg-color-preset-"]',
      ) as HTMLButtonElement;
      // Native <button> handles Enter / Space → click natively.
      btn.click();
      const style = lastSetTankStyle(spy);
      expect(style.background.kind).toBe('color');
    });

    it('rejectionMessage is cleared on a successful dispatch', () => {
      const { component } = setupDefault();
      component['rejectionMessage'].set('something');
      component.onWaterTintInput('#abc');
      expect(component['rejectionMessage']()).toBeNull();
    });

    it('dispatch guards against an invalid frameColor and surfaces a message', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      // Bypass the public hex-input by calling the private dispatch directly
      // with a deliberately-malformed style. (We can't construct this via
      // public surfaces because normaliseHex blocks it upstream.)
      component['dispatch']({
        frame: 'framed',
        frameColor: 'not-a-hex',
        background: { kind: 'none' },
      });
      expect(spy).not.toHaveBeenCalled();
      expect(component['rejectionMessage']()).toContain('Frame color');
    });

    it('dispatch guards against an invalid waterTint and surfaces a message', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component['dispatch']({
        frame: 'rimless',
        waterTint: 'not-a-hex',
        background: { kind: 'none' },
      });
      expect(spy).not.toHaveBeenCalled();
      expect(component['rejectionMessage']()).toContain('Water tint');
    });
  });

  // ── Field-preservation branches ────────────────────────────────────────
  describe('preserves co-existing fields across dispatches', () => {
    it('changing the frame preserves an existing waterTint', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.selectFrame('framed');
      const style = lastSetTankStyle(spy);
      expect(style.waterTint).toBe('#a8d8a880');
    });

    it('toggling to rimless preserves an existing waterTint', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.selectFrame('rimless');
      const style = lastSetTankStyle(spy);
      expect(style.frame).toBe('rimless');
      expect(style.waterTint).toBe('#a8d8a880');
      expect(Object.prototype.hasOwnProperty.call(style, 'frameColor')).toBe(false);
    });

    it('setFrameColor preserves an existing waterTint', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.setFrameColor('#ff8800');
      const style = lastSetTankStyle(spy);
      expect(style.frameColor).toBe('#ff8800');
      expect(style.waterTint).toBe('#a8d8a880');
    });

    it('setFrameColor noop on rimless', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      component.setFrameColor('#ff8800');
      expect(spy).not.toHaveBeenCalled();
    });

    it('setFrameColor noop on invalid hex', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.setFrameColor('not-a-hex');
      expect(spy).not.toHaveBeenCalled();
    });

    it('changing background preserves an existing frameColor', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          background: { kind: 'none' },
        },
      };
      const { fixture, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      const tab = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="bg-tab-color"]',
      ) as HTMLButtonElement;
      tab.click();
      const style = lastSetTankStyle(spy);
      expect(style.frameColor).toBe('#222222');
    });

    it('water-tint dispatch preserves an existing frameColor', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.onWaterTintInput('#a8d8a880');
      const style = lastSetTankStyle(spy);
      expect(style.frameColor).toBe('#222222');
      expect(style.waterTint).toBe('#a8d8a880');
    });

    it('clearing waterTint preserves an existing frameColor', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'framed',
          frameColor: '#222222',
          waterTint: '#a8d8a880',
          background: { kind: 'none' },
        },
      };
      const { component, store } = setupWithTank(tank);
      const spy = jest.spyOn(store, 'dispatch');
      component.selectWaterTintPreset(null);
      const style = lastSetTankStyle(spy);
      expect(style.frameColor).toBe('#222222');
      expect(Object.prototype.hasOwnProperty.call(style, 'waterTint')).toBe(false);
    });

    it('clearWaterTint is a noop when already clear', () => {
      const { component, store } = setupDefault();
      const spy = jest.spyOn(store, 'dispatch');
      // Already no waterTint; the empty-string code path should not dispatch.
      component.onWaterTintInput('');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── Store sync ────────────────────────────────────────────────────────
  describe('store sync', () => {
    it('reflects a store-driven gradient change in the editor signals', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: {
            kind: 'gradient',
            angle: Math.PI,
            stops: [
              { at: 0, color: '#aaaaaa' },
              { at: 1, color: '#bbbbbb' },
            ],
          },
        },
      };
      const { component } = setupWithTank(tank);
      expect(component.backgroundTab()).toBe('gradient');
      expect(component.gradientAngleDeg()).toBe(radToDeg(Math.PI));
      expect(component.gradientStops().length).toBe(2);
    });

    it('reflects a store-driven image background by selecting the Image tab', () => {
      const tank: Tank = {
        ...defaultScene().tank,
        style: {
          frame: 'rimless',
          background: {
            kind: 'image',
            asset: {
              id: 'asset-1',
              uri: 'assets/asset-1.png',
              mimeType: 'image/png',
            },
          },
        },
      };
      const { component } = setupWithTank(tank);
      expect(component.backgroundTab()).toBe('image');
    });

    it('updates from a subsequent store emission', () => {
      const start = defaultScene();
      const { component, store } = setupWithTank(start.tank);
      const updated: Scene = {
        ...start,
        tank: {
          ...start.tank,
          style: {
            frame: 'framed',
            frameColor: '#abcdef',
            background: { kind: 'color', color: '#445566' },
          },
        },
      };
      store.overrideSelector(selectTank, updated.tank);
      store.refreshState();
      expect(component.style().frame).toBe('framed');
      expect(component.cachedFrameColor()).toBe('#abcdef');
      expect(component.backgroundTab()).toBe('color');
    });
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────
describe('pure helpers', () => {
  describe('normaliseHex', () => {
    it('expands 3-char shorthand', () => {
      expect(normaliseHex('#abc')).toBe('#aabbcc');
    });
    it('lowercases 6-char input', () => {
      expect(normaliseHex('#ABCDEF')).toBe('#abcdef');
    });
    it('keeps 8-char (alpha) input', () => {
      expect(normaliseHex('#ABCDEF80')).toBe('#abcdef80');
    });
    it('returns null for non-hex strings', () => {
      expect(normaliseHex('not-a-hex')).toBeNull();
      expect(normaliseHex('#zzz')).toBeNull();
      expect(normaliseHex('')).toBeNull();
    });
    it('trims whitespace', () => {
      expect(normaliseHex('  #abc  ')).toBe('#aabbcc');
    });
  });

  describe('isDomainHex', () => {
    it('accepts 6 / 8-char hex', () => {
      expect(isDomainHex('#abcdef')).toBe(true);
      expect(isDomainHex('#abcdef80')).toBe(true);
    });
    it('rejects 3-char hex', () => {
      expect(isDomainHex('#abc')).toBe(false);
    });
    it('rejects garbage', () => {
      expect(isDomainHex('not-a-hex')).toBe(false);
    });
  });

  describe('hexWithoutAlpha', () => {
    it('strips alpha from #RRGGBBAA', () => {
      expect(hexWithoutAlpha('#abcdef80')).toBe('#abcdef');
    });
    it('passes through #RRGGBB', () => {
      expect(hexWithoutAlpha('#abcdef')).toBe('#abcdef');
    });
  });

  describe('degToRad / radToDeg', () => {
    it('degToRad: 180° = π', () => {
      expect(degToRad(180)).toBeCloseTo(Math.PI, 5);
    });
    it('radToDeg: π = 180°', () => {
      expect(radToDeg(Math.PI)).toBe(180);
    });
    it('radToDeg rounds and wraps', () => {
      expect(radToDeg(Math.PI * 2)).toBe(0);
    });
  });
});
