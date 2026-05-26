// Orbit3DService tests. Stage 10 follow-up.

import { TestBed } from '@angular/core/testing';

import { Orbit3DService } from './orbit-3d.service';
import {
  ORBITAL_3D_CONTROLS,
  type Orbital3DControls,
} from './orbital-3d-controls.token';

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

function configure(controls: Orbital3DControls | null) {
  TestBed.configureTestingModule({
    providers: [{ provide: ORBITAL_3D_CONTROLS, useValue: controls }],
  });
  return TestBed.inject(Orbit3DService);
}

describe('Orbit3DService — wired with real controls', () => {
  it('exposes `available = true`', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    expect(svc.available).toBe(true);
  });

  it('seeds zoomFraction signal from the renderer', () => {
    const fake = new FakeOrbital3DControls();
    fake.zoomFraction = 0.5;
    const svc = configure(fake);
    expect(svc.zoomFraction()).toBeCloseTo(0.5, 5);
  });

  it('zoomIn multiplies dolly distance (factor > 1)', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    svc.zoomIn();
    expect(fake.zoomFactors.length).toBe(1);
    expect(fake.zoomFactors[0]).toBeGreaterThan(1);
  });

  it('zoomOut divides dolly distance (factor < 1)', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    svc.zoomOut();
    expect(fake.zoomFactors.length).toBe(1);
    expect(fake.zoomFactors[0]).toBeGreaterThan(0);
    expect(fake.zoomFactors[0]).toBeLessThan(1);
  });

  it('zoomIn and zoomOut compose as inverse operations (factor × factor = 1)', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    svc.zoomIn();
    svc.zoomOut();
    const product = fake.zoomFactors.reduce((a, b) => a * b, 1);
    expect(product).toBeCloseTo(1, 5);
  });

  it('pan + rotate buttons each call the matching renderer method with a delta', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    svc.panLeft();
    svc.panRight();
    svc.panUp();
    svc.panDown();
    expect(fake.panDeltas.length).toBe(4);
    expect(fake.panDeltas[0]![0]).toBeLessThan(0); // left
    expect(fake.panDeltas[1]![0]).toBeGreaterThan(0); // right
    expect(fake.panDeltas[2]![1]).toBeGreaterThan(0); // up
    expect(fake.panDeltas[3]![1]).toBeLessThan(0); // down
    svc.rotateLeft();
    svc.rotateRight();
    svc.rotateUp();
    svc.rotateDown();
    expect(fake.rotateDeltas.length).toBe(4);
    expect(fake.rotateDeltas[0]![0]).toBeLessThan(0); // azimuth left
    expect(fake.rotateDeltas[1]![0]).toBeGreaterThan(0); // azimuth right
    expect(fake.rotateDeltas[2]![1]).toBeLessThan(0); // polar up
    expect(fake.rotateDeltas[3]![1]).toBeGreaterThan(0); // polar down
  });

  it('reset() calls renderer.resetView()', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    svc.reset();
    expect(fake.resets).toBe(1);
  });

  it('updates the zoomFraction signal when the renderer fires a change event', () => {
    const fake = new FakeOrbital3DControls();
    const svc = configure(fake);
    expect(svc.zoomFraction()).toBeCloseTo(1, 5);
    fake.zoomFraction = 2.5;
    fake.fireChange();
    expect(svc.zoomFraction()).toBeCloseTo(2.5, 5);
  });
});

describe('Orbit3DService — null controls (2D-only test bed)', () => {
  it('exposes `available = false`', () => {
    const svc = configure(null);
    expect(svc.available).toBe(false);
  });

  it('every method is a safe no-op (no throw)', () => {
    const svc = configure(null);
    expect(() => {
      svc.zoomIn();
      svc.zoomOut();
      svc.panLeft();
      svc.panRight();
      svc.panUp();
      svc.panDown();
      svc.rotateLeft();
      svc.rotateRight();
      svc.rotateUp();
      svc.rotateDown();
      svc.reset();
    }).not.toThrow();
  });

  it('zoomFraction stays at 1', () => {
    const svc = configure(null);
    expect(svc.zoomFraction()).toBe(1);
  });
});
