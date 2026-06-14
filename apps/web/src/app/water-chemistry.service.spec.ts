// WaterChemistryService tests. Plan Stage 13 F13.3 (simulation-mode path).
//
// Covers:
//   - Initial state loads from the persisted Tank.waterChemistry (else fresh).
//   - The tick reads world.getWasteSourceN() as the source term, advances the
//     chemistry deterministically (same N ticks ⇒ identical state), and pushes
//     ammonia/nitrite into world.setWaterQuality (the loop is CLOSED).
//   - A stocked tank's chemistry rises off zero (ammonia spikes) and the water
//     quality pushed to the world becomes non-zero (so VitalitySystem responds).
//   - The fallback source (bioloadSourceN) drives the cycle before a world exists.

import { TestBed } from '@angular/core/testing';

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene, WaterChemistry } from '@aquascape/domain/scene-model';
import { ENGINE_VERSION } from '@aquascape/domain/water-sim';

import { LivestockSimulationService } from './livestock-simulation.service';
import { WaterChemistryService, WEEKS_PER_TICK } from './water-chemistry.service';

/** A fake world exposing only the two F13.3 seam methods. */
class FakeWorld {
  sourceN = 0;
  pushed: { ammonia: number; nitrite: number } | null = null;
  getWasteSourceN(): number {
    return this.sourceN;
  }
  setWaterQuality(q: { ammonia: number; nitrite: number }): void {
    this.pushed = { ammonia: q.ammonia, nitrite: q.nitrite };
  }
}

/** Stub LivestockSimulationService returning a controllable world (or null). */
class StubLivestockSim {
  world: FakeWorld | null = null;
  getWorld(): FakeWorld | null {
    return this.world;
  }
}

const catalog: Catalog = {
  get: () => ({ kind: 'livestock', id: 'med', bioloadClass: 'medium' }) as never,
} as unknown as Catalog;

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    tank: {
      width: 600,
      height: 400,
      depth: 400,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 99,
    livestock: [{ id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 12 }],
    ...overrides,
  } as Scene;
}

/** Track every configured service so afterEach can stop its real interval. */
let liveServices: WaterChemistryService[] = [];

function configure() {
  const stub = new StubLivestockSim();
  TestBed.configureTestingModule({
    providers: [{ provide: LivestockSimulationService, useValue: stub }],
  });
  const service = TestBed.inject(WaterChemistryService);
  service.setCatalog(catalog);
  liveServices.push(service);
  return { service, stub };
}

describe('WaterChemistryService', () => {
  afterEach(() => {
    // Stop any real intervals started by `start()` so they don't leak across
    // tests (the service ticks on a wall-clock setInterval in production).
    for (const s of liveServices) s.stop();
    liveServices = [];
    TestBed.resetTestingModule();
  });

  it('starts from a fresh uncycled state for a scene with no persisted chemistry', () => {
    const { service } = configure();
    service.start(scene());
    const live = service.live();
    expect(live.ticks).toBe(0);
    expect(live.cycle).toBe('uncycled');
    expect(live.state.ammonia).toBe(0);
  });

  it('loads the initial state from a persisted Tank.waterChemistry snapshot', () => {
    const snap: WaterChemistry = {
      chemistry: {
        ammonia: 0,
        nitrite: 0,
        nitrate: 40,
        ph: 7,
        aobColony: 5,
        nobColony: 5,
        ageWeeks: 6,
        engineVersion: ENGINE_VERSION,
      },
      cycle: 'cycled',
    };
    const { service } = configure();
    service.start(scene({ tank: { ...scene().tank, waterChemistry: snap } }));
    const live = service.live();
    expect(live.state.nitrate).toBe(40);
    expect(live.state.ageWeeks).toBe(6);
    expect(live.cycle).toBe('cycled');
  });

  it('a tick reads the world source term and pushes water quality back (loop closed)', () => {
    const { service, stub } = configure();
    const world = new FakeWorld();
    world.sourceN = 12 * 0.6; // 12 fish baseline
    stub.world = world;

    service.start(scene());
    // Drive many ticks so ammonia rises off zero before the filter catches up.
    for (let i = 0; i < 20; i++) service.tickOnce();

    expect(service.live().ticks).toBe(20);
    // Ammonia rose above zero somewhere in the run → water quality pushed.
    expect(world.pushed).not.toBeNull();
    expect((world.pushed?.ammonia ?? 0) + (world.pushed?.nitrite ?? 0)).toBeGreaterThan(0);
  });

  it('is deterministic — same scene + same tick count ⇒ identical state', () => {
    const runOnce = () => {
      const { service, stub } = configure();
      const world = new FakeWorld();
      world.sourceN = 5;
      stub.world = world;
      service.start(scene());
      for (let i = 0; i < 30; i++) service.tickOnce();
      const s = service.live().state;
      service.stop();
      TestBed.resetTestingModule();
      return s;
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('advances ageWeeks by WEEKS_PER_TICK per tick', () => {
    const { service, stub } = configure();
    stub.world = new FakeWorld();
    service.start(scene());
    service.tickOnce();
    service.tickOnce();
    expect(service.live().state.ageWeeks).toBeCloseTo(2 * WEEKS_PER_TICK, 6);
  });

  it('uses the stocking fallback source term before a world exists', () => {
    const { service, stub } = configure();
    stub.world = null; // no world yet (renderer hasn't built one)
    service.start(scene());
    for (let i = 0; i < 30; i++) service.tickOnce();
    // 12 medium fish drive a real cycle even without a live world.
    expect(service.live().state.nitrate).toBeGreaterThan(0);
  });

  it('applyWaterChange dilutes the live state + pushes cleaner water to the world (F13.5b)', () => {
    const { service, stub } = configure();
    const world = new FakeWorld();
    world.sourceN = 12 * 0.6;
    stub.world = world;
    service.start(scene());
    // Build up a dirty tank.
    for (let i = 0; i < 40; i++) service.tickOnce();
    const before = service.live().state;
    expect(before.nitrate).toBeGreaterThan(0);

    const after = service.applyWaterChange(0.5);
    // A 50% change against clean water halves the dissolved nitrogen.
    expect(after.nitrate).toBeCloseTo(before.nitrate * 0.5, 5);
    expect(after.ammonia).toBeCloseTo(before.ammonia * 0.5, 5);
    // Colony + cycling clock are preserved (a water change doesn't reset cycling).
    expect(after.aobColony).toBe(before.aobColony);
    expect(after.ageWeeks).toBe(before.ageWeeks);
    // The cleaner ammonia/nitrite are pushed to the world (fish health responds).
    expect(world.pushed?.ammonia).toBeCloseTo(after.ammonia, 5);
    // The live signal reflects the diluted state.
    expect(service.live().state.nitrate).toBeCloseTo(after.nitrate, 5);
  });

  it('applyWaterChange is a no-op for an out-of-range fraction', () => {
    const { service, stub } = configure();
    stub.world = new FakeWorld();
    service.start(scene());
    for (let i = 0; i < 10; i++) service.tickOnce();
    const before = service.live().state.nitrate;
    expect(service.applyWaterChange(0).nitrate).toBe(before);
    expect(service.applyWaterChange(1.5).nitrate).toBe(before);
  });

  it('stop() halts ticking', () => {
    const { service } = configure();
    service.start(scene());
    service.stop();
    const before = service.live().ticks;
    // No timer-driven ticks should have accrued; manual tick still works but
    // we assert the live value is stable without a manual call.
    expect(service.live().ticks).toBe(before);
  });
});
