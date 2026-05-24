// Component test for AppComponent. Stage 0 F0.6.
//
// Asserts:
//   1. The renderer is `attach`ed and `render`ed once after view init.
//   2. A ResizeObserver callback re-attaches and re-renders.
//   3. `dispose` is called on component destruction.
//
// The Canvas2DRenderer is swapped out via the SCENE_RENDERER token so the
// spec runs entirely against an in-memory mock — no real canvas / DOM 2D
// context dependency.

import { TestBed } from '@angular/core/testing';
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

function configure(mockRenderer: MockSceneRenderer): void {
  const platform = createWebPlatform();
  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      { provide: SCENE_RENDERER, useValue: mockRenderer },
      { provide: FILE_SERVICE, useValue: platform.fileService },
      { provide: DIALOG_SERVICE, useValue: platform.dialogService },
      { provide: STORAGE_SERVICE, useValue: platform.storageService },
      { provide: RENDER_EXPORT_SERVICE, useValue: platform.renderExportService },
    ],
  });
}

describe('AppComponent', () => {
  it('attaches the renderer and renders once on view init', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(renderer.attach).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // The attached surface points at the same canvas the template rendered.
    const surface = renderer.attach.mock.calls[0]?.[0];
    expect(surface).toBeDefined();
    expect(surface!.canvas).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('canvas') as HTMLCanvasElement,
    );
    expect(surface!.devicePixelRatio).toBeGreaterThan(0);

    // The viewport is centered on the default 600x360 mm tank.
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

  it('does not mutate the scene between renders', () => {
    const renderer = new MockSceneRenderer();
    configure(renderer);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const sceneOnFirstRender = renderer.render.mock.calls[0]?.[0];
    expect(sceneOnFirstRender).toBeDefined();
    const sceneSnapshot = JSON.parse(JSON.stringify(sceneOnFirstRender));

    const shimClass = (globalThis as unknown as { __ResizeObserverShim__: MockResizeObserverClass })
      .__ResizeObserverShim__;
    shimClass.lastInstance!.trigger();

    const sceneOnSecondRender = renderer.render.mock.calls[1]?.[0];
    expect(sceneOnSecondRender).toBe(sceneOnFirstRender);
    expect(sceneOnSecondRender).toEqual(sceneSnapshot);
  });
});
