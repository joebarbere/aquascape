// DI token for the 3D renderer's camera-control surface.
//
// The interface itself lives in `@aquascape/rendering/renderer-3d`
// (`Orbital3DControls`) because the renderer is the implementer. We
// re-declare the token here in editor-shell because the editor-shell is
// where it's CONSUMED — `Orbit3DService` injects it to wire its
// signal-shaped wrapper around the renderer's camera methods.
//
// `apps/web` provides the binding (factory that returns the same
// `Three3DRenderer` instance backing `SCENE_RENDERER_3D`). Test beds
// that override `SCENE_RENDERER_3D` with a stub `SceneRenderer` (which
// won't implement the orbital methods) leave the token as `null`, and
// the service no-ops on every call so the 2D code paths run unchanged.

import { InjectionToken } from '@angular/core';

import type { Orbital3DControls } from '@aquascape/rendering/renderer-3d';

export type { Orbital3DControls };

export const ORBITAL_3D_CONTROLS = new InjectionToken<Orbital3DControls | null>(
  'Orbital3DControls',
);
