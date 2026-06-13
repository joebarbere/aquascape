// Live performance sampler for the showcase HUD.
//
// Runs a requestAnimationFrame loop (OUTSIDE Angular's zone — the per-frame
// counter must not trip change detection) and, twice a second, publishes
// FPS + average frame time plus live simulation counts (entities, bubbles)
// read straight off the bitECS world. The HUD renders `metrics()`.
//
// Only sampled while the showcase is up: `AppComponent` calls `start()` on
// demo enter and `stop()` on demo leave, so the loop costs nothing in the
// normal editor.

import { Injectable, NgZone, inject, signal } from '@angular/core';

import { LivestockSimulationService } from '../livestock-simulation.service';

export interface PerfMetrics {
  /** Frames per second over the last sample window. */
  readonly fps: number;
  /** Average milliseconds per frame over the last sample window. */
  readonly frameMs: number;
  /** Live simulated livestock entities (fish + crawlers). */
  readonly entities: number;
  /** Live bubble particles in flight. */
  readonly bubbles: number;
}

const EMPTY_METRICS: PerfMetrics = { fps: 0, frameMs: 0, entities: 0, bubbles: 0 };

/** How long to accumulate frames before publishing a sample. */
const SAMPLE_WINDOW_MS = 500;

/**
 * Pure FPS / frame-time from a frame count over an elapsed window (ms).
 * Extracted so the arithmetic is unit-testable without driving rAF.
 */
export function frameStats(
  frameCount: number,
  elapsedMs: number,
): { fps: number; frameMs: number } {
  if (frameCount <= 0 || elapsedMs <= 0) return { fps: 0, frameMs: 0 };
  const fps = Math.round((frameCount * 1000) / elapsedMs);
  const frameMs = Math.round((elapsedMs / frameCount) * 10) / 10;
  return { fps, frameMs };
}

@Injectable({ providedIn: 'root' })
export class SimulationPerfService {
  private readonly zone = inject(NgZone);
  private readonly sim = inject(LivestockSimulationService);

  /** Latest sampled metrics. Updated ~twice a second while running. */
  readonly metrics = signal<PerfMetrics>(EMPTY_METRICS);

  private rafId: number | null = null;
  private frames = 0;
  private windowStart = 0;

  /** Begin sampling. Idempotent; no-op where rAF is unavailable (SSR/tests). */
  start(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return;

    this.frames = 0;
    this.windowStart = performance.now();

    this.zone.runOutsideAngular(() => {
      const tick = (now: number): void => {
        this.frames += 1;
        const elapsed = now - this.windowStart;
        if (elapsed >= SAMPLE_WINDOW_MS) {
          const { fps, frameMs } = frameStats(this.frames, elapsed);
          const world = this.sim.getWorld();
          const entities = world !== null ? world.snapshot(0).entityCount : 0;
          const bubbles = world !== null ? world.getBubbleParticleCount() : 0;
          // Re-enter the zone only for the (twice-a-second) publish so the
          // OnPush HUD re-renders; the frame counting stays zone-free.
          this.zone.run(() => this.metrics.set({ fps, frameMs, entities, bubbles }));
          this.frames = 0;
          this.windowStart = now;
        }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }

  /** Stop sampling and reset the published metrics to zero. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.metrics.set(EMPTY_METRICS);
  }
}
