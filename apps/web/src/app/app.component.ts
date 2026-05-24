// Root component for apps/web — Stage 0 F0.6.
//
// Responsibilities (intentionally minimal):
//   1. Host a full-window `<canvas>`.
//   2. On view init, build the default scene + viewport, attach a
//      SceneRenderer, and render once.
//   3. On host resize (ResizeObserver — preferred over window.resize for
//      accuracy across embedded surfaces), recompute the viewport and
//      re-render.
//   4. On destroy, dispose the renderer and disconnect the observer.
//
// The component never mutates the `Scene`. The scene reference produced by
// `defaultScene()` is held read-only and passed to `render` on every
// invocation; subsequent stages will replace it with state-store-driven
// scenes but the immutability contract remains.

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import type { Scene } from '@aquascape/domain/scene-model';
import {
  DIALOG_SERVICE,
  FILE_SERVICE,
  RENDER_EXPORT_SERVICE,
  STORAGE_SERVICE,
} from '@aquascape/platform/platform-api/angular';
import type {
  DialogService,
  FileService,
  RenderExportService,
  StorageService,
} from '@aquascape/platform/platform-api';
import type { RenderSurface, SceneRenderer, Viewport } from '@aquascape/rendering/renderer-api';

import { defaultScene } from './default-scene';
import { defaultViewport } from './default-viewport';
import { SCENE_RENDERER } from './renderer.token';

@Component({
  selector: 'aquascape-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas
    #canvas
    class="scene-canvas"
    aria-label="Aquascape design canvas"
    role="img"
  ></canvas>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        position: relative;
      }
      .scene-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  // ── DI (inject() idiom, Angular 18) ────────────────────────────────────
  private readonly renderer = inject<SceneRenderer>(SCENE_RENDERER);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  // Platform services aren't consumed in Stage 0 — injecting them here
  // proves the composition-root binding works. The references are kept as
  // private fields rather than `void inject(...)` so the compiler keeps the
  // DI nodes (TypeScript erases unused `void` expressions in some builds).
  private readonly fileService: FileService = inject(FILE_SERVICE);
  private readonly dialogService: DialogService = inject(DIALOG_SERVICE);
  private readonly storageService: StorageService = inject(STORAGE_SERVICE);
  private readonly renderExportService: RenderExportService = inject(RENDER_EXPORT_SERVICE);

  // ── View refs ──────────────────────────────────────────────────────────
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── Internal state ─────────────────────────────────────────────────────
  /** Immutable scene reference. Stage 1+ replaces this with store-driven scenes. */
  private scene: Scene = defaultScene();
  private resizeObserver: ResizeObserver | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────
  ngOnInit(): void {
    // Reference the platform services so they aren't tree-shaken away and
    // so a missing provider would fail loudly at boot. TODO(stage-1): wire
    // these into feature libs through the state layer.
    void this.fileService;
    void this.dialogService;
    void this.storageService;
    void this.renderExportService;
  }

  ngAfterViewInit(): void {
    // Build the surface from the current canvas client rect. We run the
    // attach + render outside Angular's zone — the renderer does its own
    // DPR / resize bookkeeping and we don't want it to trigger Angular
    // change detection cycles on every frame.
    this.ngZone.runOutsideAngular(() => {
      this.attachAndRender();
      this.installResizeObserver();
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private attachAndRender(): void {
    const canvas = this.canvasRef.nativeElement;
    const surface = this.buildSurface(canvas);
    this.renderer.attach(surface);
    this.renderer.render(this.scene, this.computeViewport(surface));
  }

  private installResizeObserver(): void {
    // Skip in environments without ResizeObserver (older browsers, some test
    // contexts). The shell still works; resize just won't auto-render.
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof Observer !== 'function') return;

    const observer = new Observer(() => {
      this.attachAndRender();
    });
    observer.observe(this.canvasRef.nativeElement);
    this.resizeObserver = observer;

    // Belt-and-braces: also clean up via DestroyRef so the observer is
    // released even if ngOnDestroy is skipped (e.g. during test teardown).
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private teardown(): void {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.renderer.dispose();
  }

  private buildSurface(canvas: HTMLCanvasElement): RenderSurface {
    const rect = canvas.getBoundingClientRect();
    // Fall back to layout-default sizes if the element has zero size (which
    // can happen during the very first AfterViewInit on some browsers). The
    // ResizeObserver will fire again once layout settles.
    const width = rect.width > 0 ? rect.width : canvas.clientWidth || 1;
    const height = rect.height > 0 ? rect.height : canvas.clientHeight || 1;
    const dpr =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1;
    return { canvas, devicePixelRatio: dpr, width, height };
  }

  private computeViewport(surface: RenderSurface): Viewport {
    return defaultViewport(
      { width: surface.width, height: surface.height },
      { width: this.scene.tank.width, height: this.scene.tank.height },
    );
  }
}
