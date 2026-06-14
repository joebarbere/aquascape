import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { freshWaterState } from '@aquascape/domain/water-sim';

import { createShowcaseScene } from './showcase-scene';
import { buildSimulationHudModel } from './simulation-hud.model';
import { SimulationHudComponent } from './simulation-hud.component';
import { WaterChemistryService } from '../water-chemistry.service';

/** Stub the live chemistry service so the HUD spec doesn't pull in the world
 *  + Store dependency chain. Exposes a static `live()` signal. */
const stubChemistry = {
  live: signal({ state: freshWaterState(), cycle: 'uncycled' as const, ticks: 0 }),
};

describe('buildSimulationHudModel', () => {
  it('summarises the showcase tank spec', () => {
    const model = buildSimulationHudModel(createShowcaseScene());
    expect(model.tankDimsMm).toBe('1500 × 600 × 600 mm');
    expect(model.frame).toBe('rimless');
    expect(model.waterLevelMm).toBe(575);
    // 1500 × 600 × 575 mm = 517.5 L.
    expect(model.volumeText).toContain('518 L');
    expect(model.volumeText).toContain('gal');
    expect(model.substrate).toContain('Amazonia');
  });

  it('counts every object kind and totals the livestock', () => {
    const scene = createShowcaseScene();
    const model = buildSimulationHudModel(scene);
    expect(model.hardscapeCount).toBeGreaterThan(0);
    expect(model.plantCount).toBeGreaterThan(0);
    expect(model.decorCount).toBeGreaterThan(0);
    expect(model.layerCount).toBe(scene.layers.length);
    expect(model.livestockTotal).toBe((scene.livestock ?? []).reduce((n, l) => n + l.quantity, 0));
    expect(model.equipment.length).toBeGreaterThan(0);
  });

  it('resolves catalog ids to display names', () => {
    const model = buildSimulationHudModel(createShowcaseScene());
    // Neon Tetra's manifest name carries the latin binomial.
    expect(model.livestock.some((r) => r.name.includes('Neon Tetra'))).toBe(true);
    expect(model.equipment.some((e) => e.toLowerCase().includes('kessil'))).toBe(true);
  });
});

describe('SimulationHudComponent', () => {
  // Fake timers: pin the wall clock (so the clock render is deterministic) AND
  // keep the component's once-a-second setInterval from leaking real handles.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 13, 13, 9, 5)); // Sat Jun 13 2026, 1:09:05 PM
    TestBed.configureTestingModule({
      providers: [{ provide: WaterChemistryService, useValue: stubChemistry }],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the date + clock in the HUD', () => {
    const fixture = TestBed.createComponent(SimulationHudComponent);
    fixture.componentInstance.scene = createShowcaseScene();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.sim-hud__clock-time')?.textContent?.trim()).toBe('1:09:05 PM');
    expect(root.querySelector('.sim-hud__clock-date')?.textContent?.trim()).toBe(
      'Saturday, June 13, 2026',
    );

    // The tick re-renders the time a second later.
    jest.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(root.querySelector('.sim-hud__clock-time')?.textContent?.trim()).toBe('1:09:06 PM');

    fixture.destroy();
  });

  it('renders nothing until a scene is set, then renders the tank details', () => {
    const fixture = TestBed.createComponent(SimulationHudComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sim-hud')).toBeNull();

    fixture.componentInstance.scene = createShowcaseScene();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.sim-hud')).not.toBeNull();
    expect(root.textContent).toContain('Simulation');
    expect(root.textContent).toContain('1500 × 600 × 600 mm');
    expect(root.textContent).toContain('Neon Tetra');
    expect(root.querySelectorAll('.sim-hud__list li').length).toBeGreaterThan(0);
  });

  it('renders the live performance strip from the metrics input', () => {
    const fixture = TestBed.createComponent(SimulationHudComponent);
    fixture.componentInstance.scene = createShowcaseScene();
    fixture.componentInstance.metrics = { fps: 58, frameMs: 17.2, entities: 206, bubbles: 41 };
    fixture.detectChanges();

    const stats = fixture.nativeElement.querySelectorAll('.sim-hud__stat-val');
    expect([...stats].map((s: Element) => s.textContent?.trim())).toEqual([
      '58',
      '17.2',
      '206',
      '41',
    ]);
  });

  it('flags a low FPS reading with the warning class', () => {
    const fixture = TestBed.createComponent(SimulationHudComponent);
    fixture.componentInstance.scene = createShowcaseScene();
    fixture.componentInstance.metrics = { fps: 22, frameMs: 45, entities: 206, bubbles: 0 };
    fixture.detectChanges();

    const fpsStat = fixture.nativeElement.querySelector('.sim-hud__stat');
    expect(fpsStat.classList.contains('sim-hud__stat--warn')).toBe(true);
  });
});
