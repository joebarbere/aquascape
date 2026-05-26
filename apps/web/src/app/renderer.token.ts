// Angular DI tokens for the `SceneRenderer`s the app component drives.
//
// Stage 10 F10.3 — the app holds TWO concrete renderers and swaps which one
// paints based on the user's `ViewModeService.mode()`. We keep them in
// separate root tokens (not one token + a setter) so:
//   1. Each token's default factory returns a fresh instance, matching the
//      one-renderer-per-injector contract the Stage 0 spec asserts.
//   2. Tests can swap one renderer (e.g. the 2D one) without disturbing the
//      other.
//   3. The 3D Three.js bundle isn't constructed in test beds that don't
//      need it — `inject(SCENE_RENDERER_3D)` is only called by `apps/web`'s
//      composition root, not by `features/*` which speak only the
//      `SceneRenderer` interface.
//
// CONTEXT INVARIANT (browser only — important for the 3D path)
// ------------------------------------------------------------
// A `<canvas>` element can have ONE `getContext` type for its lifetime:
// after `getContext('2d')` is called, any later `getContext('webgl')`
// returns `null` (and vice-versa). This is a hard browser invariant; it's
// why `apps/web` ships TWO canvas elements (stacked, one always
// `[hidden]`) rather than one canvas with a context swap. See the
// `app.component.ts` template comment for the user-visible side of the
// same decision.
//
// The provider's `useFactory` returns a **fresh** instance per injector so
// test beds and production bootstrap don't accidentally share state.

import { InjectionToken, inject } from '@angular/core';
import { Canvas2DRenderer } from '@aquascape/rendering/renderer-2d';
import { Three3DRenderer } from '@aquascape/rendering/renderer-3d';
import type { SceneRenderer } from '@aquascape/rendering/renderer-api';
import { ORBITAL_3D_CONTROLS } from '@aquascape/features/editor-shell';

export const SCENE_RENDERER_2D = new InjectionToken<SceneRenderer>('SceneRenderer2D', {
  providedIn: 'root',
  factory: () => new Canvas2DRenderer(),
});

export const SCENE_RENDERER_3D = new InjectionToken<SceneRenderer>('SceneRenderer3D', {
  providedIn: 'root',
  factory: () => new Three3DRenderer(),
});

/**
 * App-wide DI provider for the editor-shell's `ORBITAL_3D_CONTROLS`
 * token. Resolves to the SAME instance as `SCENE_RENDERER_3D` in
 * production — `Three3DRenderer` implements both `SceneRenderer` and the
 * `Orbital3DControls` shape the editor-shell consumes. Test beds that
 * override `SCENE_RENDERER_3D` with a `SceneRenderer`-only stub get
 * `null` here, and the editor-shell `Orbit3DService` no-ops on every
 * call — same way the rest of the orbit-control UI gates off when 3D
 * isn't real.
 */
export const orbital3DControlsProvider = {
  provide: ORBITAL_3D_CONTROLS,
  useFactory: () => {
    const r = inject(SCENE_RENDERER_3D);
    return isOrbital3DControls(r) ? r : null;
  },
};

function isOrbital3DControls(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['zoomBy'] === 'function' &&
    typeof v['panBy'] === 'function' &&
    typeof v['rotateBy'] === 'function' &&
    typeof v['resetView'] === 'function' &&
    typeof v['getZoomFraction'] === 'function' &&
    typeof v['addChangeListener'] === 'function'
  );
}
