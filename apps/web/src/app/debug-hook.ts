// Stage 11 follow-up — closes the F11.1/F11.2 "Coverage gap" (see
// docs/caveats/livestock-ecs.md → "No real-browser smoke test yet").
//
// Read-only introspection surface on `window.__aquascape_debug__` for the
// upcoming Playwright e2e suite. Tests need to interrogate world / scene /
// view-mode state WITHOUT coupling to NgRx internals — every selector
// reimplemented in the test runner would have to be maintained in lockstep
// with the production code.
//
// CONTRACT
// --------
//  * Read-only. There is no setter, no dispatch, no spawnFish surface — if
//    a test needs to mutate state it does so through real user gestures
//    (click, key) like a normal browser test.
//  * Off by default in production. Gated by `isDevMode()`, which is the
//    same flag `main.ts` uses for `provideStoreDevtools` + the service
//    worker registration toggle (no per-app `environment.ts` file exists
//    in this workspace — Angular's runtime-mode helper is the convention).
//    Tree-shakes out of `nx build web --configuration=production` because
//    `attachDebugHook` early-returns and the `__aquascape_debug__` write
//    becomes dead code under the Angular CLI's production optimiser.
//  * Initialised ONCE on AppComponent bootstrap (via `attachDebugHook`)
//    and detached on teardown (via `detachDebugHook`) — no re-attach on
//    every change-detection cycle.
//  * Typed via the `declare global` augmentation below. Playwright code
//    can `await page.evaluate(() => window.__aquascape_debug__?.getScene())`
//    and get a TS-checked shape if the test suite imports this file's
//    types.

import { isDevMode } from '@angular/core';
import type { Store } from '@ngrx/store';

import type { LivestockWorld } from '@aquascape/domain/livestock-ecs';
import type { Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';
import type { ViewModeService } from '@aquascape/features/editor-shell';

import type { LivestockSimulationService } from './livestock-simulation.service';

/**
 * Public read-only debug interface exposed on `window.__aquascape_debug__`.
 * Every accessor returns a snapshot or a live handle — none of them mutate.
 *
 * NOTE: the returned `LivestockWorld` reference is the same object the
 * simulation service owns. Tests MUST treat it as read-only — calling
 * `world.spawnFish` / `world.step` / `world.despawn` from a Playwright
 * evaluate block would diverge the simulation from the production tick
 * loop and corrupt subsequent assertions. The TypeScript surface can't
 * forbid that (the world's interface exposes those methods for the
 * RAF tick + the simulation service); discipline is on the test author.
 */
export interface AquascapeDebugHandle {
  /**
   * The live `LivestockWorld` owned by `LivestockSimulationService`, or
   * `null` when the current scene has no livestock entries.
   */
  getWorld(): LivestockWorld | null;
  /**
   * Total live ECS entities across all archetypes. Returns 0 when no
   * world has been built yet (no livestock in the scene). Sourced from
   * the existing `world.snapshot(0).entityCount` field — no new public
   * accessor was added to `LivestockSimulationService` for this.
   */
  getEntityCount(): number;
  /**
   * The current `Scene` from the NgRx store, or `null` before the first
   * store emission. Returns the same object reference the renderer would
   * read on its next paint.
   */
  getScene(): Scene | null;
  /** The current canvas view mode driven by `ViewModeService`. */
  getViewMode(): '2d' | '3d';
}

declare global {
  interface Window {
    /**
     * Read-only debug surface for Playwright e2e tests. Only attached when
     * `isDevMode()` is true (i.e. NOT in `nx build --configuration=production`
     * artifacts). See `apps/web/src/app/debug-hook.ts` for the full contract.
     */
    __aquascape_debug__?: AquascapeDebugHandle;
  }
}

/**
 * Wire `window.__aquascape_debug__` to live handles. Idempotent —
 * `AppComponent.ngOnInit` calls this exactly once, but a stray double-call
 * just overwrites the same shape.
 *
 * No-op in production builds: `isDevMode()` returns false when Angular is
 * bootstrapped with the production configuration (`enableProdMode()` was
 * called or `optimization` is on at build time). That means the
 * `window.__aquascape_debug__` write is dead code in the production bundle
 * and tree-shakes out.
 */
export function attachDebugHook(deps: {
  store: Store;
  livestockSim: LivestockSimulationService;
  viewMode: ViewModeService;
}): void {
  if (!isDevMode()) return;
  if (typeof window === 'undefined') return;

  const handle: AquascapeDebugHandle = {
    getWorld: () => deps.livestockSim.getWorld(),
    getEntityCount: () => {
      const world = deps.livestockSim.getWorld();
      if (world === null) return 0;
      // `snapshot(0)` copies the world's current state into the renderer
      // snapshot pool. The `entityCount` field is the sum across every
      // spawned entity (one fish == one entity in F11.1/F11.2; future
      // archetypes ride the same component slabs). The `0` alpha
      // argument selects the post-step state with no sub-tick lerping.
      return world.snapshot(0).entityCount;
    },
    getScene: () => {
      // NgRx Stores are BehaviorSubjects under the hood — subscribing
      // synchronously fires the current value, so we can read it without
      // awaiting an async pipe or holding a subscription. The one-shot
      // subscribe+unsubscribe pattern below avoids leaking a sub
      // across debug-hook reads.
      let current: Scene | null = null;
      const sub = deps.store.select(selectScene).subscribe((s) => {
        current = s;
      });
      sub.unsubscribe();
      return current;
    },
    getViewMode: () => deps.viewMode.mode(),
  };

  window.__aquascape_debug__ = handle;
}

/**
 * Clear the global hook. Called from `AppComponent.ngOnDestroy` so a
 * teardown (test cleanup, HMR re-bootstrap) leaves no dangling reference
 * to the disposed services.
 */
export function detachDebugHook(): void {
  if (typeof window === 'undefined') return;
  delete window.__aquascape_debug__;
}
