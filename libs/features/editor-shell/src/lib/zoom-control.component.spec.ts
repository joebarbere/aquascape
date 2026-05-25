// ZoomControlComponent tests. Stage 5.x.

import { TestBed } from '@angular/core/testing';

import { ViewportService } from './viewport.service';
import { ZoomControlComponent } from './zoom-control.component';
import { ZOOM_MULT_MAX, ZOOM_MULT_MIN, ZOOM_STEP_MULT } from './zoom-math';

function configure() {
  TestBed.configureTestingModule({ imports: [ZoomControlComponent] });
  const fixture = TestBed.createComponent(ZoomControlComponent);
  fixture.detectChanges();
  const viewport = TestBed.inject(ViewportService);
  return { fixture, viewport };
}

function btn(fixture: ReturnType<typeof configure>['fixture'], label: string): HTMLButtonElement {
  const buttons = fixture.nativeElement.querySelectorAll(
    'button',
  ) as NodeListOf<HTMLButtonElement>;
  for (const b of buttons) {
    if (b.getAttribute('aria-label') === label) return b;
  }
  throw new Error(`No button found with aria-label="${label}"`);
}

describe('ZoomControlComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initial state (fit-to-window)', () => {
    it('renders 100% by default', () => {
      const { fixture } = configure();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('100%');
    });

    it('disables the Fit button when already fit', () => {
      const { fixture } = configure();
      expect(btn(fixture, 'Reset zoom to fit window').disabled).toBe(true);
    });

    it('enables both + and − at 100%', () => {
      const { fixture } = configure();
      expect(btn(fixture, 'Zoom in').disabled).toBe(false);
      expect(btn(fixture, 'Zoom out').disabled).toBe(false);
    });
  });

  describe('+ button', () => {
    it('multiplies the user zoom by ZOOM_STEP_MULT', () => {
      const { fixture, viewport } = configure();
      btn(fixture, 'Zoom in').click();
      fixture.detectChanges();
      expect(viewport.userZoomMult()).toBeCloseTo(ZOOM_STEP_MULT, 6);
    });

    it('stacks across multiple clicks', () => {
      const { fixture, viewport } = configure();
      btn(fixture, 'Zoom in').click();
      btn(fixture, 'Zoom in').click();
      expect(viewport.userZoomMult()).toBeCloseTo(ZOOM_STEP_MULT * ZOOM_STEP_MULT, 6);
    });

    it('clamps at ZOOM_MULT_MAX and disables the button there', () => {
      const { fixture, viewport } = configure();
      viewport.setZoomMult(ZOOM_MULT_MAX);
      fixture.detectChanges();
      expect(btn(fixture, 'Zoom in').disabled).toBe(true);
      btn(fixture, 'Zoom in').click();
      // Still at the ceiling — no overshoot.
      expect(viewport.userZoomMult()).toBe(ZOOM_MULT_MAX);
    });
  });

  describe('− button', () => {
    it('divides the user zoom by ZOOM_STEP_MULT', () => {
      const { fixture, viewport } = configure();
      btn(fixture, 'Zoom out').click();
      expect(viewport.userZoomMult()).toBeCloseTo(1 / ZOOM_STEP_MULT, 6);
    });

    it('clamps at ZOOM_MULT_MIN and disables the button there', () => {
      const { fixture, viewport } = configure();
      viewport.setZoomMult(ZOOM_MULT_MIN);
      fixture.detectChanges();
      expect(btn(fixture, 'Zoom out').disabled).toBe(true);
    });
  });

  describe('Fit button', () => {
    it('resets both zoom and pan, re-enabling fit-to-window', () => {
      const { fixture, viewport } = configure();
      viewport.setZoomAndPan(2, { x: 50, y: 50 });
      fixture.detectChanges();
      expect(btn(fixture, 'Reset zoom to fit window').disabled).toBe(false);

      btn(fixture, 'Reset zoom to fit window').click();
      fixture.detectChanges();

      expect(viewport.userZoomMult()).toBeNull();
      expect(viewport.userPan()).toBeNull();
      expect(viewport.isFit()).toBe(true);
    });
  });

  describe('percentage display', () => {
    it('reflects the current user-zoom multiplier', () => {
      const { fixture, viewport } = configure();
      viewport.setZoomMult(1.5);
      fixture.detectChanges();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('150%');
    });

    it('reads 100% when zoom is cleared back to null', () => {
      const { fixture, viewport } = configure();
      viewport.setZoomMult(2);
      fixture.detectChanges();
      viewport.setZoomMult(null);
      fixture.detectChanges();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('100%');
    });
  });

  describe('accessibility', () => {
    it('has a role=toolbar with an aria-label', () => {
      const { fixture } = configure();
      const root = fixture.nativeElement.querySelector('.zoom-control') as HTMLElement;
      expect(root.getAttribute('role')).toBe('toolbar');
      expect(root.getAttribute('aria-label')).toBe('Canvas zoom');
    });

    it('every button has an aria-label and a title', () => {
      const { fixture } = configure();
      for (const label of ['Zoom out', 'Zoom in', 'Reset zoom to fit window']) {
        const b = btn(fixture, label);
        expect(b.getAttribute('aria-label')).toBe(label);
        expect(b.getAttribute('title')).toBe(label);
      }
    });

    it('zoom value uses aria-live=polite so screen readers track changes', () => {
      const { fixture } = configure();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.getAttribute('role')).toBe('status');
      expect(value.getAttribute('aria-live')).toBe('polite');
    });
  });
});
