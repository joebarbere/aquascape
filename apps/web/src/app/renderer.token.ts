// Angular DI token for the `SceneRenderer` the app component drives.
//
// Decoupling the component from `Canvas2DRenderer` (the Stage 0 concrete
// renderer) via a token serves two purposes:
//   1. Tests can swap in a recorded mock without monkey-patching imports.
//   2. Future stages can wire a different renderer (e.g. renderer-3d, Stage 10)
//      at the composition root without editing the feature code.
//
// The provider's `useFactory` returns a **fresh** instance per injector so
// that test beds and production bootstrap don't accidentally share state.

import { InjectionToken } from '@angular/core';
import { Canvas2DRenderer } from '@aquascape/rendering/renderer-2d';
import type { SceneRenderer } from '@aquascape/rendering/renderer-api';

export const SCENE_RENDERER = new InjectionToken<SceneRenderer>('SceneRenderer', {
  providedIn: 'root',
  factory: () => new Canvas2DRenderer(),
});
