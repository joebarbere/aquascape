// Renderer API is types-only — the contract is enforced at compile time
// by `tsc`. This spec exists so the project has at least one test target,
// and to pin the public type shape with a no-op assignment: if any of the
// exported types disappear or change incompatibly, this file fails to
// compile and the test target fails before it even runs.
//
// Coverage thresholds are intentionally disabled in `jest.config.ts` —
// there is no runtime code to cover.

import type {
  RenderSurface,
  Viewport,
  HitResult,
  SceneRenderer,
  OverlayOptions,
  WallBackground,
} from './index';
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

  it('accepts previewAgeWeeks as the trailing render() and hitTest() arg (F4.4)', () => {
    // Type-only assertion: a callable matching the new signature must accept
    // an optional `previewAgeWeeks` number. If the interface changes shape,
    // these assignments stop compiling.
    const stub: SceneRenderer = {
      attach: () => undefined,
      render: () => undefined,
      hitTest: () => null,
      dispose: () => undefined,
    };
    stub.render({} as Scene, {} as Viewport, undefined, undefined, 12);
    const hit = stub.hitTest(
      { x: 0, y: 0 } as Vec2,
      {} as Scene,
      {} as Viewport,
      undefined,
      undefined,
      12,
    );
    expect(hit).toBeNull();
  });

  it('accepts overlayOptions as the 6th render() arg (F5.3) and exports the OverlayOptions shape', () => {
    // Type-only assertions: the OverlayOptions shape is exactly three booleans,
    // and `render()`'s 6th parameter accepts it. `hitTest()` deliberately does
    // NOT take overlays — they are non-interactive view aids.
    const overlays: OverlayOptions = {
      goldenRatio: true,
      thirds: false,
      focalPoints: true,
    };
    const stub: SceneRenderer = {
      attach: () => undefined,
      render: () => undefined,
      hitTest: () => null,
      dispose: () => undefined,
    };
    stub.render({} as Scene, {} as Viewport, undefined, undefined, undefined, overlays);
    // hitTest signature must stay 6-arg (point, scene, viewport, catalog?,
    // selection?, previewAgeWeeks?) — adding overlays here would be a
    // contract violation.
    type HitTestArity = Parameters<SceneRenderer['hitTest']>['length'];
    const arity: HitTestArity = 6;
    expect(arity).toBe(6);
    expect(overlays.goldenRatio).toBe(true);
  });

  it('accepts wallBackground as the 7th render() arg (Stage 5.x) and exports the WallBackground shape', () => {
    // Type-only assertions: WallBackground exposes exactly the four fields
    // the renderer + UI service share. `render`'s 7th slot accepts it.
    // `hitTest` still does NOT take the wall — it's pure decoration.
    const wall: WallBackground = {
      enabled: true,
      color: '#2a2d35',
      widthMm: 1200,
      heightMm: 600,
    };
    const stub: SceneRenderer = {
      attach: () => undefined,
      render: () => undefined,
      hitTest: () => null,
      dispose: () => undefined,
    };
    stub.render(
      {} as Scene,
      {} as Viewport,
      undefined,
      undefined,
      undefined,
      undefined,
      wall,
    );
    type HitTestArity = Parameters<SceneRenderer['hitTest']>['length'];
    const arity: HitTestArity = 6;
    expect(arity).toBe(6);
    expect(wall.widthMm).toBe(1200);
  });
});
