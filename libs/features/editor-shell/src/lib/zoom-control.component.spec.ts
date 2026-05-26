// ZoomControlComponent tests. Stage 5.x; 3D-mode tests Stage 10 follow-up.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  ORBITAL_3D_CONTROLS,
  type Orbital3DControls,
} from './orbital-3d-controls.token';
import { ViewModeService } from './view-mode.service';
import { ViewportService } from './viewport.service';
import { ZoomControlComponent } from './zoom-control.component';
import { ZOOM_MULT_MAX, ZOOM_MULT_MIN, ZOOM_STEP_MULT } from './zoom-math';

function fakeStorage(): StorageService {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string) => Promise.resolve((store.get(key) ?? null) as T | null),
    set: <T>(key: string, value: T) => {
      store.set(key, value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

class FakeOrbital3DControls implements Orbital3DControls {
  zoomFactors: number[] = [];
  panDeltas: Array<[number, number]> = [];
  rotateDeltas: Array<[number, number]> = [];
  resets = 0;
  zoomFraction = 1;
  private listeners = new Set<() => void>();

  zoomBy(factor: number): void {
    this.zoomFactors.push(factor);
  }
  panBy(deltaX: number, deltaY: number): void {
    this.panDeltas.push([deltaX, deltaY]);
  }
  rotateBy(azimuth: number, polar: number): void {
    this.rotateDeltas.push([azimuth, polar]);
  }
  resetView(): void {
    this.resets++;
  }
  getZoomFraction(): number {
    return this.zoomFraction;
  }
  addChangeListener(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  fireChange(): void {
    for (const cb of this.listeners) cb();
  }
}

function configure(orbitalControls: Orbital3DControls | null = null) {
  TestBed.configureTestingModule({
    imports: [ZoomControlComponent],
    providers: [
      { provide: STORAGE_SERVICE, useValue: fakeStorage() },
      { provide: ORBITAL_3D_CONTROLS, useValue: orbitalControls },
    ],
  });
  const fixture = TestBed.createComponent(ZoomControlComponent);
  fixture.detectChanges();
  const viewport = TestBed.inject(ViewportService);
  const viewMode = TestBed.inject(ViewModeService);
  return { fixture, viewport, viewMode };
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

  describe('3D mode', () => {
    it('+ button calls Orbital3DControls.zoomBy with a factor > 1 (zoom IN)', () => {
      const controls = new FakeOrbital3DControls();
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      btn(fixture, 'Zoom in').click();
      expect(controls.zoomFactors.length).toBe(1);
      expect(controls.zoomFactors[0]).toBeGreaterThan(1);
    });

    it('− button calls Orbital3DControls.zoomBy with a factor < 1 (zoom OUT)', () => {
      const controls = new FakeOrbital3DControls();
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      btn(fixture, 'Zoom out').click();
      expect(controls.zoomFactors.length).toBe(1);
      expect(controls.zoomFactors[0]).toBeLessThan(1);
      expect(controls.zoomFactors[0]).toBeGreaterThan(0);
    });

    it('Fit button calls Orbital3DControls.resetView', () => {
      const controls = new FakeOrbital3DControls();
      controls.zoomFraction = 2;
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      btn(fixture, 'Reset zoom to fit window').click();
      expect(controls.resets).toBe(1);
    });

    it('percent label reflects Orbital3DControls.getZoomFraction', () => {
      const controls = new FakeOrbital3DControls();
      controls.zoomFraction = 2;
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('200%');
    });

    it('percent label updates reactively when the renderer fires a change event', () => {
      const controls = new FakeOrbital3DControls();
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      controls.zoomFraction = 1.5;
      controls.fireChange();
      fixture.detectChanges();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('150%');
    });

    it('Fit button is disabled at zoom fraction = 1 (already at default framing)', () => {
      const controls = new FakeOrbital3DControls();
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      expect(btn(fixture, 'Reset zoom to fit window').disabled).toBe(true);
    });

    it('+ and − buttons stay enabled in 3D regardless of zoom level (OrbitControls clamps internally)', () => {
      const controls = new FakeOrbital3DControls();
      controls.zoomFraction = 1000; // Wildly zoomed in.
      const { fixture, viewMode } = configure(controls);
      viewMode.setMode('3d');
      fixture.detectChanges();
      expect(btn(fixture, 'Zoom in').disabled).toBe(false);
      expect(btn(fixture, 'Zoom out').disabled).toBe(false);
    });

    it('falls back to 100% label when no orbital controls are wired (null token)', () => {
      const { fixture, viewMode } = configure(null);
      viewMode.setMode('3d');
      fixture.detectChanges();
      const value = fixture.nativeElement.querySelector('.zoom-control__value') as HTMLElement;
      expect(value.textContent?.trim()).toBe('100%');
    });
  });
});
