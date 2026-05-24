// Renderer API is types-only — the contract is enforced at compile time
// by `tsc`. This spec exists so the project has at least one test target,
// and to pin the public type shape with a no-op assignment: if any of the
// exported types disappear or change incompatibly, this file fails to
// compile and the test target fails before it even runs.
//
// Coverage thresholds are intentionally disabled in `jest.config.ts` —
// there is no runtime code to cover.

import type { RenderSurface, Viewport, HitResult, SceneRenderer } from './index';
import type { Scene, ObjectId, LayerId } from '@aquascape/domain/scene-model';
import type { Vec2 } from '@aquascape/domain/geometry';

describe('@aquascape/rendering/renderer-api', () => {
  it('exports the SceneRenderer contract with a stable shape', () => {
    // The body of this test is a series of type-only assignments. They
    // produce no runtime work — but if any field on the exported types
    // is renamed, removed, or retyped, this file fails to type-check.

    // A fake renderer that satisfies the interface — also confirms the
    // method signatures are what features will be coded against.
    const fake: SceneRenderer = {
      attach(surface: RenderSurface) {
        void surface.canvas;
        void surface.devicePixelRatio;
        void surface.width;
        void surface.height;
      },
      render(scene: Scene, viewport: Viewport) {
        void scene.tank;
        void viewport.center;
        void viewport.zoom;
        void viewport.rotation;
      },
      hitTest(point: Vec2, scene: Scene, viewport: Viewport): HitResult | null {
        void point.x;
        void point.y;
        void scene.layers;
        void viewport.center;
        const objectId = '' as ObjectId;
        const layerId = '' as LayerId;
        // Confirm the optional `handle` literal set hasn't drifted.
        const handle: HitResult['handle'] = 'translate';
        return { objectId, layerId, handle };
      },
      dispose() {
        // no-op
      },
    };

    // Touch `fake` so the var isn't flagged as unused.
    expect(typeof fake.attach).toBe('function');
    expect(typeof fake.render).toBe('function');
    expect(typeof fake.hitTest).toBe('function');
    expect(typeof fake.dispose).toBe('function');
  });
});
