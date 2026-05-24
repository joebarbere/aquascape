// Jest setup for apps/web. Stage 0 F0.6.
//
// Loaded via `setupFilesAfterEnv` so it runs after `jest` is defined and
// after `jest-preset-angular` has wired the Angular testing helpers.
//
// Responsibilities:
//   1. Initialize the Angular browser-dynamic testing platform.
//   2. Polyfill `ResizeObserver` — jsdom doesn't ship one, and the
//      AppComponent installs one in ngAfterViewInit.

// `setupZoneTestEnv` (preset 14.x) initializes the Angular testing platform
// with browser-dynamic providers + zone.js + the `getTestBed`
// initTestEnvironment call. Do **not** call `initTestEnvironment` again from
// this file — it would throw "Cannot set base providers because it has
// already been called".
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// ── ResizeObserver shim ─────────────────────────────────────────────────────
// Tests assert resize-triggered re-render behaviour by invoking the observed
// callback directly. The shim keeps a reference to the most recent callback
// on the constructor itself so tests can grab it.

class ResizeObserverShim {
  static lastInstance: ResizeObserverShim | null = null;
  readonly callback: ResizeObserverCallback;
  readonly observed: Element[] = [];

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    ResizeObserverShim.lastInstance = this;
  }

  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {
    /* no-op for tests */
  }
  disconnect(): void {
    this.observed.length = 0;
  }

  /** Test helper — fire the observed callback with an empty payload. */
  trigger(): void {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverShim as unknown as typeof ResizeObserver;

// Expose the shim for tests that want to fire the observer manually.
(globalThis as { __ResizeObserverShim__?: typeof ResizeObserverShim }).__ResizeObserverShim__ =
  ResizeObserverShim;
