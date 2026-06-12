// Renderer API is types-only — the contract is enforced at compile time
// by `tsc`. This spec exists so the project has at least one test target,
// and to pin the public type shape with a no-op assignment: if any of the
// exported types disappear or change incompatibly, this file fails to
// compile and the test target fails before it even runs.
//
// Coverage thresholds are intentionally disabled in `jest.config.ts` —
// there is no runtime code to cover.

import type {
  BackdropImage,
  HitResult,
  HitTestOptions,
  OverlayOptions,
  RenderOptions,
  RenderSurface,
  SceneRenderer,
  SnapGuides,
  Viewport,
  WallBackground,
} from './index';
import type { LayerId, ObjectId, Scene } from '@aquascape/domain/scene-model';
import type { Vec2 } from '@aquascape/domain/geometry';

describe('@aquascape/rendering/renderer-api', () => {
  it('exports the SceneRenderer contract with a stable shape', () => {
    // The body of this test is a series of type-only assignments. They
    // produce no runtime work — but if any field on the exported types
    // is renamed, removed, or retyped, this file fails to type-check.
    const fake: SceneRenderer = {
      attach(surface: RenderSurface) {
        void surface.canvas;
        void surface.devicePixelRatio;
        void surface.width;
        void surface.height;
      },
      render(scene: Scene, viewport: Viewport, options?: RenderOptions) {
        void scene.tank;
        void viewport.center;
        void viewport.zoom;
        void viewport.rotation;
        void options?.catalog;
        void options?.selection;
        void options?.previewAgeWeeks;
        void options?.overlayOptions;
        void options?.wallBackground;
        void options?.snapGuides;
        void options?.backdropImage;
      },
      hitTest(
        point: Vec2,
        scene: Scene,
        viewport: Viewport,
        options?: HitTestOptions,
      ): HitResult | null {
        void point.x;
        void point.y;
        void scene.layers;
        void viewport.center;
        void options?.catalog;
        void options?.selection;
        void options?.previewAgeWeeks;
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
    expect(typeof fake.attach).toBe('function');
    expect(typeof fake.render).toBe('function');
    expect(typeof fake.hitTest).toBe('function');
    expect(typeof fake.dispose).toBe('function');
  });

  describe('post-refactor arity', () => {
    // The render → options-object refactor collapsed the historical 9-arg
    // render() + 6-arg hitTest() to 3 args + 4 args respectively. These
    // assertions lock that down so a future drift back to positional args
    // is a compile-time + runtime failure.

    it('render() arity is exactly 3 (scene, viewport, options?)', () => {
      type RenderArity = Parameters<SceneRenderer['render']>['length'];
      const arity: RenderArity = 3;
      expect(arity).toBe(3);
    });

    it('hitTest() arity is exactly 4 (point, scene, viewport, options?)', () => {
      type HitTestArity = Parameters<SceneRenderer['hitTest']>['length'];
      const arity: HitTestArity = 4;
      expect(arity).toBe(4);
    });

    it('render() accepts an empty options object', () => {
      const stub: SceneRenderer = {
        attach: () => undefined,
        render: () => undefined,
        hitTest: () => null,
        dispose: () => undefined,
      };
      stub.render({} as Scene, {} as Viewport, {});
      stub.render({} as Scene, {} as Viewport, undefined);
      stub.render({} as Scene, {} as Viewport);
      expect(stub.render).toBeDefined();
    });

    it('hitTest() accepts an empty options object', () => {
      const stub: SceneRenderer = {
        attach: () => undefined,
        render: () => undefined,
        hitTest: () => null,
        dispose: () => undefined,
      };
      stub.hitTest({ x: 0, y: 0 } as Vec2, {} as Scene, {} as Viewport, {});
      stub.hitTest({ x: 0, y: 0 } as Vec2, {} as Scene, {} as Viewport, undefined);
      stub.hitTest({ x: 0, y: 0 } as Vec2, {} as Scene, {} as Viewport);
      expect(stub.hitTest).toBeDefined();
    });
  });

  describe('RenderOptions field shape', () => {
    it('OverlayOptions slot is exactly three booleans', () => {
      const overlays: OverlayOptions = {
        goldenRatio: true,
        thirds: false,
        focalPoints: true,
      };
      const options: RenderOptions = { overlayOptions: overlays };
      expect(options.overlayOptions?.goldenRatio).toBe(true);
    });

    it('WallBackground slot has enabled / color / width / height', () => {
      const wall: WallBackground = {
        enabled: true,
        color: '#2a2d35',
        widthMm: 1200,
        heightMm: 600,
      };
      const options: RenderOptions = { wallBackground: wall };
      expect(options.wallBackground?.widthMm).toBe(1200);
    });

    it('SnapGuides slot has xs / ys arrays', () => {
      const guides: SnapGuides = { xs: [180, 240], ys: [110] };
      const options: RenderOptions = { snapGuides: guides };
      expect(options.snapGuides?.xs).toHaveLength(2);
    });

    it('BackdropImage slot has image + opacity', () => {
      const backdrop: BackdropImage = {
        image: {} as unknown as CanvasImageSource,
        opacity: 0.6,
      };
      const options: RenderOptions = { backdropImage: backdrop };
      expect(options.backdropImage?.opacity).toBe(0.6);
    });

    it('previewAgeWeeks slot is a number', () => {
      const options: RenderOptions = { previewAgeWeeks: 12 };
      expect(options.previewAgeWeeks).toBe(12);
    });

    it('selection slot is a ReadonlyArray<ObjectId>', () => {
      const options: RenderOptions = { selection: ['x' as ObjectId, 'y' as ObjectId] };
      expect(options.selection).toHaveLength(2);
    });

    it('catalogTextureBaseUrl slot is an optional string (Bucket 2 opt-in)', () => {
      // The 3D renderer prepends this to each entry's `textures` refs;
      // omitted ⇒ the procedural-only pre-Bucket-2 render. The 2D
      // renderer ignores it.
      const options: RenderOptions = {
        catalogTextureBaseUrl: 'assets/catalog-textures/',
      };
      expect(options.catalogTextureBaseUrl).toBe('assets/catalog-textures/');
      const optsWithout: RenderOptions = {};
      expect(optsWithout.catalogTextureBaseUrl).toBeUndefined();
    });

    it('dayNightLookup slot is optional and structural (no domain import)', () => {
      // F11.7 Wave 3 — the four-field shape is inlined in renderer-api so
      // the rendering libs stay free of `apps/web` / `domain/day-night-
      // service` imports. Plain object literal with the right shape must
      // type-check.
      const options: RenderOptions = {
        dayNightLookup: {
          ambientColor: '#fff5e0',
          directionalIntensity: 1,
          backgroundTint: '#a4c7e8',
          emissiveBoost: 0,
        },
      };
      expect(options.dayNightLookup?.ambientColor).toBe('#fff5e0');
      // Also valid: omit entirely.
      const optsWithout: RenderOptions = {};
      expect(optsWithout.dayNightLookup).toBeUndefined();
    });
  });

  describe('HitTestOptions is a strict subset', () => {
    it('keeps catalog, selection, previewAgeWeeks — decoration layers absent by design', () => {
      const options: HitTestOptions = {
        selection: ['a' as ObjectId],
        previewAgeWeeks: 8,
      };
      expect(options.selection).toHaveLength(1);
      // Compile-time check that decoration-only fields are NOT on HitTestOptions.
      // @ts-expect-error overlays don't participate in hit-test
      const bad: HitTestOptions = { overlayOptions: {} as OverlayOptions };
      void bad;
    });
  });
});
