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
import { provideMockStore, MockStore } from '@ngrx/store/testing';
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
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import { defaultScene, selectScene } from '@aquascape/state';

import { AppComponent } from './app.component';
import { SCENE_RENDERER } from './renderer.token';

interface MockResizeObserverClass {
  lastInstance: { trigger(): void } | null;
}

class MockSceneRenderer implements SceneRenderer {
  readonly attach = jest.fn<void, [RenderSurface]>();
  readonly render = jest.fn<void, [Scene, Viewport]>();
  readonly hitTest = jest.fn<HitResult | null, unknown[]>(() => null);
  readonly dispose = jest.fn<void, []>();
}

function configure(mockRenderer: MockSceneRenderer, initialScene = defaultScene()) {
  const platform = createWebPlatform();
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      { provide: SCENE_RENDERER, useValue: mockRenderer },
      { provide: FILE_SERVICE, useValue: platform.fileService },
      { provide: DIALOG_SERVICE, useValue: platform.dialogService },
      { provide: STORAGE_SERVICE, useValue: platform.storageService },
      { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
      provideMockStore({
        selectors: [{ selector: selectScene, value: initialScene }],
      }),
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
    expect(surface!.canvas).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('canvas') as HTMLCanvasElement,
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
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(renderer.dispose).not.toHaveBeenCalled();
    fixture.destroy();
    expect(renderer.dispose).toHaveBeenCalled();
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
