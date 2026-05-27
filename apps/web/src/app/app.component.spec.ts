// Component test for AppComponent. Stage 0 F0.6 + F1.1 Phase B.
//
// Asserts:
//   1. The renderer is `attach`ed and `render`ed once after the first scene
//      emission from the store.
//   2. A ResizeObserver callback re-attaches and re-renders.
//   3. `dispose` is called on component destruction.
//   4. Updating the store's `Scene` triggers a new render with the new
//      tank dimensions.
//
// The Canvas2DRenderer is swapped out via the SCENE_RENDERER token so the
// spec runs entirely against an in-memory mock. The NgRx store is replaced
// with `provideMockStore` + an override of `selectScene` so we control the
// emitted scenes deterministically.

import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EMPTY } from 'rxjs';
import type { Scene } from '@aquascape/domain/scene-model';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import { createWebPlatform } from '@aquascape/platform/platform-web';
import type {
  HitResult,
  RenderOptions,
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import {
  defaultScene,
  initialDocumentState,
  initialSelectionState,
  selectCanRedo,
  selectCanUndo,
  selectDisplayTitle,
  selectHasPendingDraft,
  selectHasSelection,
  selectLastError,
  selectPendingDraft,
  selectRecentFiles,
  selectScene,
  selectSelectedIds,
  selectStatus,
} from '@aquascape/state';

import {
  OverlayOptionsService,
  ViewModeService,
  ViewportService,
  WallBackgroundService,
} from '@aquascape/features/editor-shell';

import { AppComponent } from './app.component';
import { SCENE_RENDERER_2D, SCENE_RENDERER_3D } from './renderer.token';

interface MockResizeObserverClass {
  lastInstance: { trigger(): void } | null;
}

class MockSceneRenderer implements SceneRenderer {
  readonly attach = jest.fn<void, [RenderSurface]>();
  readonly render = jest.fn<void, [Scene, Viewport, RenderOptions?]>();
  readonly hitTest = jest.fn<HitResult | null, unknown[]>(() => null);
  readonly dispose = jest.fn<void, []>();
}

function configure(
  mockRenderer: MockSceneRenderer,
  initialScene = defaultScene(),
  mockRenderer3d: MockSceneRenderer = new MockSceneRenderer(),
) {
  const platform = createWebPlatform();
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      { provide: SCENE_RENDERER_2D, useValue: mockRenderer },
      { provide: SCENE_RENDERER_3D, useValue: mockRenderer3d },
      { provide: FILE_SERVICE, useValue: platform.fileService },
      { provide: DIALOG_SERVICE, useValue: platform.dialogService },
      { provide: STORAGE_SERVICE, useValue: platform.storageService },
      { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
      provideMockStore({
        // Every feature slice the composed children read from has to be in
        // initialState so child components (EditorShellComponent reads
        // `document`, SelectionInspectorComponent reads `selection`, etc.)
        // don't crash before the test overrides anything. Selector values
        // are preset for direct assertion.
        initialState: {
          document: initialDocumentState(),
          selection: initialSelectionState(),
        },
        selectors: [
          { selector: selectScene, value: initialScene },
          { selector: selectDisplayTitle, value: 'Untitled' },
          { selector: selectStatus, value: 'idle' as const },
          { selector: selectRecentFiles, value: [] },
          { selector: selectHasPendingDraft, value: false },
          { selector: selectPendingDraft, value: null },
          { selector: selectLastError, value: null },
          { selector: selectSelectedIds, value: [] },
          { selector: selectHasSelection, value: false },
          { selector: selectCanUndo, value: false },
          { selector: selectCanRedo, value: false },
        ],
      }),
      // F11.4 — LivestockSimulationService subscribes to
      // `LivestockPulseActions.feedTank` via @ngrx/effects' `Actions`. Tests
      // that boot AppComponent must provide an Actions stream (even an
      // empty one) so the service constructor's `inject(Actions)` resolves
      // — `optional: true` is not enough, because Actions is registered
      // root-providedIn and its factory crashes without ScannedActionsSubject.
      provideMockActions(() => EMPTY),
    ],
  });
}

describe('AppComponent', () => {
  it('attaches the renderer and renders once when the store emits', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(renderer.attach).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    const surface = renderer.attach.mock.calls[0]?.[0];
    expect(surface).toBeDefined();
    // Stage 10 F10.3 — apps/web ships two stacked canvases. The 2D
    // renderer paints into the FIRST one (the [aria-label] suffix is
    // the load-bearing identifier; querySelector('canvas') would also
    // pick the 2D canvas since it's first in the template, but the
    // attribute selector is more explicit and survives template churn).
    expect(surface!.canvas).toBe(
      (fixture.nativeElement as HTMLElement).querySelector(
        'canvas[aria-label="Aquascape design canvas (2D)"]',
      ) as HTMLCanvasElement,
    );
    expect(surface!.devicePixelRatio).toBeGreaterThan(0);

    const viewport = renderer.render.mock.calls[0]?.[1];
    expect(viewport).toBeDefined();
    expect(viewport!.center).toEqual({ x: 300, y: 180 });
    expect(viewport!.rotation).toBe(0);
  });

  it('re-renders when the ResizeObserver fires', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const shimClass = (globalThis as unknown as { __ResizeObserverShim__: MockResizeObserverClass })
      .__ResizeObserverShim__;
    expect(shimClass.lastInstance).not.toBeNull();

    renderer.attach.mockClear();
    renderer.render.mockClear();

    shimClass.lastInstance!.trigger();

    expect(renderer.attach).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('disposes the renderer on component destroy', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(renderer.dispose).not.toHaveBeenCalled();
    fixture.destroy();
    expect(renderer.dispose).toHaveBeenCalled();
    // The 3D renderer was never attached (default view mode is '2d'),
    // so its dispose isn't called on the destroy path either.
    expect(renderer3d.dispose).not.toHaveBeenCalled();
  });

  it('re-renders with new tank dimensions when the scene updates', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const store = TestBed.inject(MockStore);
    const grown: Scene = {
      ...defaultScene(),
      tank: { ...defaultScene().tank, width: 1200, height: 450, depth: 450 },
    };
    store.overrideSelector(selectScene, grown);
    store.refreshState();

    const lastCall = renderer.render.mock.calls.at(-1);
    expect(lastCall).toBeDefined();
    const [emittedScene, viewport] = lastCall!;
    expect(emittedScene.tank.width).toBe(1200);
    // Viewport centre moves with the larger tank.
    expect(viewport.center).toEqual({ x: 600, y: 225 });
  });
});

// ─── Stage 3.x — pointer-drag flows ──────────────────────────────────────

import { SceneActions, SelectionActions } from '@aquascape/state';
import { asLayerId, asObjectId } from '@aquascape/domain/scene-model';
import type { ObjectId } from '@aquascape/domain/scene-model';

// jsdom doesn't ship PointerEvent natively — same polyfill as the
// hardscape-tool spec.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  (globalThis as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

function sceneWithObject(id: string, position = { x: 180, y: 110, z: 0 }): Scene {
  const base = defaultScene();
  return {
    ...base,
    layers: [
      {
        id: asLayerId('layer-1'),
        name: 'L',
        opacity: 1,
        visible: true,
        locked: false,
        objects: [
          {
            kind: 'hardscape' as const,
            id: asObjectId(id),
            ref: { catalog: 'core', id: 'rock.seiryu.large', version: 1 },
            transform: {
              position,
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              flipX: false,
              flipY: false,
            },
          },
        ],
      },
    ],
  };
}

function dispatchSpy() {
  const store = TestBed.inject(MockStore);
  return jest.spyOn(store, 'dispatch');
}

describe('AppComponent — Stage 3.x pointer drags', () => {
  it('pointerdown on a body of an unselected object dispatches replaceSelection', () => {
    const renderer = new MockSceneRenderer();
    const scene = sceneWithObject('a');
    configure(renderer, scene);
    renderer.hitTest.mockReturnValue({ objectId: asObjectId('a'), layerId: asLayerId('layer-1') });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }));
    const actions = spy.mock.calls.map((c) => c[0]);
    expect(actions[0]).toEqual(SelectionActions.replaceSelection({ ids: [asObjectId('a')] }));
  });

  it('move drag dispatches a single MoveObject on pointerup', () => {
    const renderer = new MockSceneRenderer();
    const scene = sceneWithObject('a');
    const store = TestBed;
    configure(renderer, scene);
    // Pre-select the object so the click doesn't dispatch replaceSelection too.
    store
      .inject(MockStore)
      .overrideSelector(selectSelectedIds, [asObjectId('a')] as readonly ObjectId[]);
    renderer.hitTest.mockReturnValue({ objectId: asObjectId('a'), layerId: asLayerId('layer-1') });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 300 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 300 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    const moveActions = dispatched.filter(
      (a) =>
        (a as ReturnType<typeof SceneActions.dispatchCommand>).type ===
        '[Scene] Dispatch Command' &&
        (a as ReturnType<typeof SceneActions.dispatchCommand>).command.kind === 'MoveObject',
    );
    expect(moveActions.length).toBe(1);
  });

  it('handle: scaleNE → drag dispatches a single ReshapeObject', () => {
    const renderer = new MockSceneRenderer();
    const scene = sceneWithObject('a');
    configure(renderer, scene);
    TestBed.inject(MockStore).overrideSelector(
      selectSelectedIds,
      [asObjectId('a')] as readonly ObjectId[],
    );
    renderer.hitTest.mockReturnValue({
      objectId: asObjectId('a'),
      layerId: asLayerId('layer-1'),
      handle: 'scaleNE',
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 450, clientY: 250 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 480, clientY: 220 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 480, clientY: 220 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    const reshapes = dispatched.filter(
      (a) =>
        (a as ReturnType<typeof SceneActions.dispatchCommand>).type ===
        '[Scene] Dispatch Command' &&
        (a as ReturnType<typeof SceneActions.dispatchCommand>).command.kind === 'ReshapeObject',
    );
    expect(reshapes.length).toBe(1);
  });

  it('handle: rotate → drag dispatches a single ReshapeObject with updated rotation.z', () => {
    const renderer = new MockSceneRenderer();
    const scene = sceneWithObject('a');
    configure(renderer, scene);
    TestBed.inject(MockStore).overrideSelector(
      selectSelectedIds,
      [asObjectId('a')] as readonly ObjectId[],
    );
    renderer.hitTest.mockReturnValue({
      objectId: asObjectId('a'),
      layerId: asLayerId('layer-1'),
      handle: 'rotate',
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 500, clientY: 300 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400, clientY: 200 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 400, clientY: 200 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    const reshape = dispatched.find(
      (a) =>
        (a as ReturnType<typeof SceneActions.dispatchCommand>).type ===
          '[Scene] Dispatch Command' &&
        (a as ReturnType<typeof SceneActions.dispatchCommand>).command.kind === 'ReshapeObject',
    );
    expect(reshape).toBeDefined();
  });

  it('Esc during a drag cancels without dispatching the would-be command', () => {
    const renderer = new MockSceneRenderer();
    const scene = sceneWithObject('a');
    configure(renderer, scene);
    TestBed.inject(MockStore).overrideSelector(
      selectSelectedIds,
      [asObjectId('a')] as readonly ObjectId[],
    );
    renderer.hitTest.mockReturnValue({ objectId: asObjectId('a'), layerId: asLayerId('layer-1') });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 400, clientY: 300 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 300 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    // Pointer-up after cancel should now be a no-op (document listeners removed).
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 300 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    expect(
      dispatched.some(
        (a) =>
          (a as ReturnType<typeof SceneActions.dispatchCommand>).type ===
          '[Scene] Dispatch Command' &&
          (a as ReturnType<typeof SceneActions.dispatchCommand>).command.kind === 'MoveObject',
      ),
    ).toBe(false);
  });

  it('pointerdown on empty space starts a marquee drag (overlay div appears)', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer, sceneWithObject('a'));
    renderer.hitTest.mockReturnValue(null);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.marquee-overlay')).not.toBeNull();
    // Clean up.
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 200 }));
  });

  it('marquee dispatches selectByMarquee with objects whose centre is inside', () => {
    const renderer = new MockSceneRenderer();
    // Place the object at the viewport centre — picking a marquee that
    // covers the centre of the canvas should include it.
    const scene = sceneWithObject('a', { x: 180, y: 110, z: 0 });
    configure(renderer, scene);
    renderer.hitTest.mockReturnValue(null);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    // jsdom's getBoundingClientRect returns zeros by default — stub it to
    // return the canvas layout we expect for an 800×600 host.
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;
    const spy = dispatchSpy();
    // Marquee from (300, 200) to (500, 400) in CSS — straddles the canvas
    // centre (400, 300) which projects back to world (180, 110).
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 300, clientY: 200 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 400 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, clientY: 400 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    const marqueeAction = dispatched.find(
      (a): a is ReturnType<typeof SelectionActions.selectByMarquee> =>
        (a as ReturnType<typeof SelectionActions.selectByMarquee>).type ===
        '[Selection] Select By Marquee',
    );
    expect(marqueeAction).toBeDefined();
    expect(marqueeAction!.ids).toContain(asObjectId('a'));
  });

  it('zero-area marquee with no shift clears selection (matches empty click)', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    renderer.hitTest.mockReturnValue(null);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100 }));
    const dispatched = spy.mock.calls.map((c) => c[0]);
    expect(dispatched).toContainEqual(SelectionActions.clearSelection());
  });

  it('ignores non-primary-button pointerdowns', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const spy = dispatchSpy();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, clientX: 100, clientY: 100 }));
    expect(spy).not.toHaveBeenCalled();
  });

  // ─── F5.3 — composition overlays end-to-end through the app shell ──────

  it('passes the current OverlayOptions as the 6th render() argument', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const firstCall = renderer.render.mock.calls[0]!;
    // Post-refactor: render() args are (scene, viewport, options).
    // OverlayOptions lives on options.overlayOptions.
    expect(firstCall[2]?.overlayOptions).toEqual({
      goldenRatio: false,
      thirds: false,
      focalPoints: false,
    });
  });

  it('re-renders with the new overlays when a flag flips on the service', async () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    renderer.render.mockClear();

    const overlays = TestBed.inject(OverlayOptionsService);
    overlays.setGoldenRatio(true);
    fixture.detectChanges();
    // Effect runs synchronously in TestBed; the call must have happened.
    expect(renderer.render).toHaveBeenCalled();
    const lastArgs = renderer.render.mock.calls.at(-1)!;
    expect(lastArgs[2]?.overlayOptions).toEqual({
      goldenRatio: true,
      thirds: false,
      focalPoints: false,
    });

    // Flip thirds + focalPoints: another render with updated flags.
    renderer.render.mockClear();
    overlays.setThirds(true);
    overlays.setFocalPoints(true);
    fixture.detectChanges();
    const finalArgs = renderer.render.mock.calls.at(-1)!;
    expect(finalArgs[2]?.overlayOptions).toEqual({
      goldenRatio: true,
      thirds: true,
      focalPoints: true,
    });
  });

  // ─── Stage 5.x — user-controlled viewport zoom ─────────────────────────

  it('re-renders with composed zoom when ViewportService.setZoomMult fires', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const beforeZoom = renderer.render.mock.calls.at(-1)![1].zoom;

    renderer.render.mockClear();
    const viewport = TestBed.inject(ViewportService);
    viewport.setZoomMult(2);
    fixture.detectChanges();

    expect(renderer.render).toHaveBeenCalled();
    const afterZoom = renderer.render.mock.calls.at(-1)![1].zoom;
    expect(afterZoom).toBeCloseTo(beforeZoom * 2, 6);
  });

  it('Fit (reset) restores the original fit-to-window zoom', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const originalZoom = renderer.render.mock.calls.at(-1)![1].zoom;

    const viewport = TestBed.inject(ViewportService);
    viewport.setZoomMult(3);
    fixture.detectChanges();
    expect(renderer.render.mock.calls.at(-1)![1].zoom).toBeCloseTo(originalZoom * 3, 6);

    viewport.reset();
    fixture.detectChanges();
    expect(renderer.render.mock.calls.at(-1)![1].zoom).toBeCloseTo(originalZoom, 6);
  });

  it('Cmd-wheel on canvas updates ViewportService and re-renders', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const viewport = TestBed.inject(ViewportService);
    expect(viewport.userZoomMult()).toBeNull();

    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;

    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100, // scroll up = zoom in
        clientX: 400,
        clientY: 300,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();

    expect(viewport.userZoomMult()).not.toBeNull();
    expect(viewport.userZoomMult()!).toBeGreaterThan(1);
  });

  // ─── Stage 5.x — wall background ────────────────────────────────────────

  it('passes the current WallBackground as the 7th render() argument', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const firstCall = renderer.render.mock.calls[0]!;
    // Post-refactor: WallBackground lives on options.wallBackground.
    expect(firstCall[2]?.wallBackground).toEqual({
      enabled: false,
      color: expect.stringMatching(/^#[0-9a-f]{6,8}$/i),
      widthMm: expect.any(Number),
      heightMm: expect.any(Number),
    });
  });

  // ─── Stage 5 F5.4 — snap guides arg ────────────────────────────────────

  it('passes undefined for snapGuides on initial render (no drag in flight)', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const args = renderer.render.mock.calls[0]!;
    // Post-refactor: SnapGuides lives on options.snapGuides.
    expect(args[2]?.snapGuides).toBeUndefined();
  });

  it('re-renders with the new wall config when the service updates', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    renderer.render.mockClear();
    const wall = TestBed.inject(WallBackgroundService);
    wall.setEnabled(true);
    wall.setColor('#112233');
    wall.setWidthMm(900);
    wall.setHeightMm(450);
    fixture.detectChanges();

    expect(renderer.render).toHaveBeenCalled();
    const finalArgs = renderer.render.mock.calls.at(-1)!;
    expect(finalArgs[2]?.wallBackground).toEqual({
      enabled: true,
      color: '#112233',
      widthMm: 900,
      heightMm: 450,
    });
  });

  it('plain wheel (no Cmd/Ctrl) does NOT touch zoom — page-scroll preserved', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const viewport = TestBed.inject(ViewportService);
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;

    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 400,
        clientY: 300,
        ctrlKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();

    expect(viewport.userZoomMult()).toBeNull();
  });
});

// ─── Stage 10 F10.3 — 2D ↔ 3D renderer swap ─────────────────────────────

describe('AppComponent — 2D / 3D view mode', () => {
  function selectCanvas(
    fixture: ReturnType<typeof TestBed.createComponent<AppComponent>>,
    label: '2D' | '3D',
  ): HTMLCanvasElement | null {
    return fixture.nativeElement.querySelector(
      `canvas[aria-label="Aquascape design canvas (${label})"]`,
    ) as HTMLCanvasElement | null;
  }

  it('renders both 2D and 3D canvases regardless of mode (only [hidden] toggles)', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(selectCanvas(fixture, '2D')).not.toBeNull();
    expect(selectCanvas(fixture, '3D')).not.toBeNull();
  });

  it('defaults to 2D mode — 2D canvas visible, 3D canvas hidden', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const c2 = selectCanvas(fixture, '2D')!;
    const c3 = selectCanvas(fixture, '3D')!;
    expect(c2.hidden).toBe(false);
    expect(c3.hidden).toBe(true);
  });

  it('flipping mode to 3D hides the 2D canvas and reveals the 3D canvas', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    expect(selectCanvas(fixture, '2D')!.hidden).toBe(true);
    expect(selectCanvas(fixture, '3D')!.hidden).toBe(false);
  });

  it('flipping to 3D attaches the 3D renderer and renders into the 3D canvas', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(renderer3d.attach).not.toHaveBeenCalled();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    expect(renderer3d.attach).toHaveBeenCalled();
    expect(renderer3d.render).toHaveBeenCalled();
    const surface = renderer3d.attach.mock.calls.at(-1)?.[0];
    expect(surface).toBeDefined();
    expect(surface!.canvas).toBe(selectCanvas(fixture, '3D'));
  });

  it('flipping to 3D disposes the previously-active 2D renderer', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(renderer.dispose).not.toHaveBeenCalled();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('the selection inspector is NOT rendered in 3D mode', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('aquascape-selection-inspector')).not.toBeNull();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('aquascape-selection-inspector')).toBeNull();
  });

  it('component destroy disposes BOTH renderers if both were attached during the session', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();
    // The 2D renderer was disposed on the swap; only the 3D renderer is
    // currently attached.
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer3d.dispose).not.toHaveBeenCalled();

    fixture.destroy();
    expect(renderer3d.dispose).toHaveBeenCalledTimes(1);
  });

  // ─── Stage 11 F11.1 Wave 4 — livestockWorld propagation ─────────────────

  it('does NOT pass options.livestockWorld in 2D mode (2D ignores fish)', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    // Seed a scene with livestock so the simulation service builds a
    // world; the 2D render call must STILL omit livestockWorld.
    const sceneWithFish: Scene = {
      ...defaultScene(),
      livestock: [
        {
          id: asObjectId('e1'),
          ref: { catalog: 'core', id: 'livestock.fish.neon-tetra', version: 1 },
          quantity: 4,
        },
      ],
    };
    configure(renderer, sceneWithFish, renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const firstCall = renderer.render.mock.calls[0]!;
    expect(firstCall[2]?.livestockWorld).toBeUndefined();
  });

  it('passes options.livestockWorld in 3D mode when the scene has livestock', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    const sceneWithFish: Scene = {
      ...defaultScene(),
      livestock: [
        {
          id: asObjectId('e1'),
          ref: { catalog: 'core', id: 'livestock.fish.neon-tetra', version: 1 },
          quantity: 6,
        },
      ],
    };
    configure(renderer, sceneWithFish, renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    const lastCall = renderer3d.render.mock.calls.at(-1)!;
    const world = lastCall[2]?.livestockWorld;
    expect(world).toBeDefined();
    // The world should already carry the spawned entities.
    expect(world!.snapshot(0).entityCount).toBe(6);
  });

  it('passes no livestockWorld in 3D when the scene has no livestock', () => {
    const renderer = new MockSceneRenderer();
    const renderer3d = new MockSceneRenderer();
    // Default scene has no livestock.
    configure(renderer, defaultScene(), renderer3d);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const vm = TestBed.inject(ViewModeService);
    vm.setMode('3d');
    fixture.detectChanges();

    const lastCall = renderer3d.render.mock.calls.at(-1)!;
    expect(lastCall[2]?.livestockWorld).toBeUndefined();
  });
});
