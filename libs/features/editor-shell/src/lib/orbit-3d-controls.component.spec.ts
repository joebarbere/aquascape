// Orbit3DControlsComponent tests. Stage 10 follow-up.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import { Orbit3DControlsComponent } from './orbit-3d-controls.component';
import {
  ORBITAL_3D_CONTROLS,
  type Orbital3DControls,
} from './orbital-3d-controls.token';
import { ViewModeService } from './view-mode.service';

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
    return 1;
  }
  addChangeListener(): () => void {
    return () => undefined;
  }
}

function configure(controls: Orbital3DControls | null = new FakeOrbital3DControls()) {
  TestBed.configureTestingModule({
    imports: [Orbit3DControlsComponent],
    providers: [
      { provide: STORAGE_SERVICE, useValue: fakeStorage() },
      { provide: ORBITAL_3D_CONTROLS, useValue: controls },
    ],
  });
  const fixture = TestBed.createComponent(Orbit3DControlsComponent);
  fixture.detectChanges();
  const viewMode = TestBed.inject(ViewModeService);
  return { fixture, viewMode, controls };
}

function btn(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement {
  const found = fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);
  if (found === null) throw new Error(`No button with aria-label="${label}"`);
  return found as HTMLButtonElement;
}

describe('Orbit3DControlsComponent', () => {
  it('renders nothing when the active mode is 2D', () => {
    const { fixture } = configure();
    expect(fixture.nativeElement.querySelector('.orbit3d-control')).toBeNull();
  });

  it('renders the pill when the mode flips to 3D', () => {
    const { fixture, viewMode } = configure();
    viewMode.setMode('3d');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.orbit3d-control')).not.toBeNull();
  });

  it('pan buttons dispatch panBy with the matching delta sign in 3D mode', () => {
    const fake = new FakeOrbital3DControls();
    const { fixture, viewMode } = configure(fake);
    viewMode.setMode('3d');
    fixture.detectChanges();
    btn(fixture, 'Pan left').click();
    btn(fixture, 'Pan right').click();
    btn(fixture, 'Pan up').click();
    btn(fixture, 'Pan down').click();
    expect(fake.panDeltas.length).toBe(4);
    expect(fake.panDeltas[0]![0]).toBeLessThan(0); // left
    expect(fake.panDeltas[1]![0]).toBeGreaterThan(0); // right
    expect(fake.panDeltas[2]![1]).toBeGreaterThan(0); // up
    expect(fake.panDeltas[3]![1]).toBeLessThan(0); // down
  });

  it('rotate buttons dispatch rotateBy with the matching delta sign in 3D mode', () => {
    const fake = new FakeOrbital3DControls();
    const { fixture, viewMode } = configure(fake);
    viewMode.setMode('3d');
    fixture.detectChanges();
    btn(fixture, 'Rotate camera left').click();
    btn(fixture, 'Rotate camera right').click();
    btn(fixture, 'Tilt camera up').click();
    btn(fixture, 'Tilt camera down').click();
    expect(fake.rotateDeltas.length).toBe(4);
    expect(fake.rotateDeltas[0]![0]).toBeLessThan(0);
    expect(fake.rotateDeltas[1]![0]).toBeGreaterThan(0);
    expect(fake.rotateDeltas[2]![1]).toBeLessThan(0);
    expect(fake.rotateDeltas[3]![1]).toBeGreaterThan(0);
  });

  it('Reset view button calls resetView', () => {
    const fake = new FakeOrbital3DControls();
    const { fixture, viewMode } = configure(fake);
    viewMode.setMode('3d');
    fixture.detectChanges();
    btn(fixture, 'Reset 3D camera view').click();
    expect(fake.resets).toBe(1);
  });

  it('all action buttons are DISABLED when no Orbital3DControls implementation is wired', () => {
    const { fixture, viewMode } = configure(null);
    viewMode.setMode('3d');
    fixture.detectChanges();
    for (const label of [
      'Pan left',
      'Pan right',
      'Pan up',
      'Pan down',
      'Rotate camera left',
      'Rotate camera right',
      'Tilt camera up',
      'Tilt camera down',
      'Reset 3D camera view',
    ]) {
      expect(btn(fixture, label).disabled).toBe(true);
    }
  });

  it('every button has an aria-label and a title', () => {
    const { fixture, viewMode } = configure();
    viewMode.setMode('3d');
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeTruthy();
    }
  });

  it('renders separate Pan and Orbit groups, each with role region semantics via aria-label', () => {
    const { fixture, viewMode } = configure();
    viewMode.setMode('3d');
    fixture.detectChanges();
    const groups = fixture.nativeElement.querySelectorAll('.orbit3d-control__group');
    expect(groups.length).toBe(2);
    const labels = Array.from(groups).map((el) => (el as HTMLElement).getAttribute('aria-label'));
    expect(labels).toContain('Pan');
    expect(labels).toContain('Rotate');
  });
});
