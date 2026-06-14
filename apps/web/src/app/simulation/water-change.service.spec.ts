import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';

import type { Scene } from '@aquascape/domain/scene-model';

import { WaterChemistryService } from '../water-chemistry.service';

import { WaterChangeService } from './water-change.service';
import { createShowcaseScene } from './showcase-scene';

/** A scene with a tracked chemistry block (so the WaterChange command applies). */
function sceneWithChemistry(): Scene {
  const base = createShowcaseScene();
  return {
    ...base,
    tank: {
      ...base.tank,
      waterLevelMm: 575,
      waterChemistry: {
        chemistry: {
          ammonia: 0,
          nitrite: 0,
          nitrate: 40,
          ph: 7.4,
          aobColony: 1,
          nobColony: 1,
          ageWeeks: 8,
          engineVersion: 1,
        },
        cycle: 'cycled',
      },
    },
  };
}

describe('WaterChangeService', () => {
  let svc: WaterChangeService;
  let dispatched: Array<{ type: string; command?: { kind: string } }>;
  let liveChanges: Array<{ fraction: number; replacement?: unknown }>;

  beforeEach(() => {
    dispatched = [];
    liveChanges = [];
    const storeMock = {
      dispatch: (action: { type: string; command?: { kind: string } }) => dispatched.push(action),
    };
    const chemistryMock = {
      applyWaterChange: (fraction: number, replacement?: unknown) => {
        liveChanges.push({ fraction, replacement });
        return {} as never;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        WaterChangeService,
        { provide: Store, useValue: storeMock },
        { provide: WaterChemistryService, useValue: chemistryMock },
      ],
    });
    svc = TestBed.inject(WaterChangeService);
  });

  it('OUT dispatches WaterChange + SetWaterLevel commands and drives the live runtime', () => {
    const scene = sceneWithChemistry();
    const result = svc.siphonOut(scene, 0.3);

    expect(result).not.toBeNull();
    expect(result?.fraction).toBe(0.3);
    expect(result?.newLevelMm).toBe(403); // round(575 * 0.7)

    const kinds = dispatched.map((a) => a.command?.kind);
    expect(kinds).toContain('WaterChange');
    expect(kinds).toContain('SetWaterLevel');

    // Live runtime diluted by the OUT fraction (clean source — no replacement).
    expect(liveChanges).toHaveLength(1);
    expect(liveChanges[0].fraction).toBe(0.3);
    expect(liveChanges[0].replacement).toBeUndefined();
  });

  it('OUT then IN restores the level + lerps chemistry toward the replacement', () => {
    const scene = sceneWithChemistry();
    svc.siphonOut(scene, 0.3);
    dispatched = [];
    liveChanges = [];

    // After OUT the live scene level is lower; pass a fresh scene reflecting it.
    const drained: Scene = { ...scene, tank: { ...scene.tank, waterLevelMm: 403 } };
    const result = svc.siphonIn(drained, { temperatureC: 24, ph: 6.8, hardnessDgh: 5 }, 0.3);

    expect(result).not.toBeNull();
    // IN restores back to the captured pre-drain level (575).
    expect(result?.newLevelMm).toBe(575);

    const kinds = dispatched.map((a) => a.command?.kind);
    expect(kinds).toContain('WaterChange');
    expect(kinds).toContain('SetWaterLevel');

    expect(liveChanges).toHaveLength(1);
    expect(liveChanges[0].fraction).toBe(0.3);
    expect(liveChanges[0].replacement).toMatchObject({ ph: 6.8 });
  });

  it('IN is a no-op without a prior OUT', () => {
    const scene = sceneWithChemistry();
    const result = svc.siphonIn(scene, { temperatureC: 24, ph: 7, hardnessDgh: 6 }, 0.3);
    expect(result).toBeNull();
    expect(dispatched).toHaveLength(0);
    expect(liveChanges).toHaveLength(0);
  });

  it('OUT skips the WaterChange command when the tank tracks no chemistry, but still drives live', () => {
    const scene = createShowcaseScene(); // no waterChemistry block
    const result = svc.siphonOut(scene, 0.3);
    expect(result).not.toBeNull();
    const kinds = dispatched.map((a) => a.command?.kind);
    expect(kinds).not.toContain('WaterChange');
    expect(kinds).toContain('SetWaterLevel');
    expect(liveChanges).toHaveLength(1);
  });

  it('clear() forgets a pending OUT so a later IN no-ops', () => {
    const scene = sceneWithChemistry();
    svc.siphonOut(scene, 0.3);
    svc.clear();
    const result = svc.siphonIn(scene, { temperatureC: 24, ph: 7, hardnessDgh: 6 }, 0.3);
    expect(result).toBeNull();
  });
});
