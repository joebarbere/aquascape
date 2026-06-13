import { TestBed } from '@angular/core/testing';

import { LivestockSimulationService } from '../livestock-simulation.service';
import { SimulationPerfService, frameStats } from './simulation-perf.service';

describe('frameStats', () => {
  it('computes fps + average frame time over a window', () => {
    // 30 frames in 500 ms = 60 fps, ~16.7 ms/frame.
    expect(frameStats(30, 500)).toEqual({ fps: 60, frameMs: 16.7 });
  });

  it('handles a slower window', () => {
    // 15 frames in 500 ms = 30 fps, ~33.3 ms/frame.
    expect(frameStats(15, 500)).toEqual({ fps: 30, frameMs: 33.3 });
  });

  it('returns zeros for a degenerate window', () => {
    expect(frameStats(0, 500)).toEqual({ fps: 0, frameMs: 0 });
    expect(frameStats(10, 0)).toEqual({ fps: 0, frameMs: 0 });
  });
});

describe('SimulationPerfService', () => {
  function makeService(): SimulationPerfService {
    TestBed.configureTestingModule({
      providers: [
        // Stub the sim so the service has no real world (getWorld → null).
        { provide: LivestockSimulationService, useValue: { getWorld: () => null } },
        SimulationPerfService,
      ],
    });
    return TestBed.inject(SimulationPerfService);
  }

  it('starts at zeroed metrics', () => {
    expect(makeService().metrics()).toEqual({ fps: 0, frameMs: 0, entities: 0, bubbles: 0 });
  });

  it('stop() is safe before start() and resets to zeros', () => {
    const service = makeService();
    expect(() => service.stop()).not.toThrow();
    expect(service.metrics()).toEqual({ fps: 0, frameMs: 0, entities: 0, bubbles: 0 });
  });

  it('start() then stop() does not throw', () => {
    const service = makeService();
    expect(() => {
      service.start();
      service.start(); // idempotent
      service.stop();
    }).not.toThrow();
  });
});
