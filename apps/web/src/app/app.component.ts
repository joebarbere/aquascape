// Root component for apps/web — Stage 0 F0.6 + F1.1 Phase B.
//
// Responsibilities:
//   1. Host a CSS-grid layout: a sidebar with the tank-setup feature on the
//      left, the full-height scene canvas on the right.
//   2. Subscribe to the NgRx scene store; re-render the canvas whenever the
//      scene changes.
//   3. On host resize (ResizeObserver), recompute the viewport against the
//      current scene's tank dimensions and re-render.
//   4. On destroy, dispose the renderer and disconnect the observer.
//
// The component never mutates the `Scene`. The feature component dispatches
// actions; the effect turns them into Commands; the reducer commits a new
// `Scene`; the selector here emits, and the canvas redraws.

import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Scene } from '@aquascape/domain/scene-model';
import { TankSetupComponent } from '@aquascape/features/tank-setup';
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
import { selectScene } from '@aquascape/state';
import { Store } from '@ngrx/store';

import { defaultViewport } from './default-viewport';
import { SCENE_RENDERER } from './renderer.token';

@Component({
  selector: 'aquascape-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TankSetupComponent],
  template: `
    <div class="app-grid">
      <aside class="app-sidebar" aria-label="Tools">
        <aquascape-tank-setup></aquascape-tank-setup>
      </aside>
      <main class="app-canvas-host">
        <canvas
          #canvas
          class="scene-canvas"
          aria-label="Aquascape design canvas"
          role="img"
        ></canvas>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .app-grid {
        display: grid;
        grid-template-columns: minmax(280px, 360px) 1fr;
        height: 100%;
      }
      .app-sidebar {
        overflow-y: auto;
        border-right: 1px solid #e0e0e0;
        background: #fafafa;
      }
      .app-canvas-host {
        position: relative;
        overflow: hidden;
      }
      .scene-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  // ── DI ──────────────────────────────────────────────────────────────────
  private readonly renderer = inject<SceneRenderer>(SCENE_RENDERER);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);

  // Platform services kept on the component so the DI graph fails loudly at
  // boot if a binding is missing. Feature libs consume them by token, not by
  // reaching through AppComponent.
  private readonly fileService: FileService = inject(FILE_SERVICE);
  private readonly dialogService: DialogService = inject(DIALOG_SERVICE);
  private readonly storageService: StorageService = inject(STORAGE_SERVICE);
  private readonly renderExportService: RenderExportService = inject(RENDER_EXPORT_SERVICE);

  // ── View refs ───────────────────────────────────────────────────────────
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── Internal state ──────────────────────────────────────────────────────
  /** Latest scene from the store. Held read-only — never mutated. */
  private currentScene: Scene | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private attached = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    void this.fileService;
    void this.dialogService;
    void this.storageService;
    void this.renderExportService;

    this.ngZone.runOutsideAngular(() => {
      this.installResizeObserver();
      // Subscribe to the store outside Angular's zone so each scene change
      // doesn't trigger a redundant CD cycle. The canvas is independent of
      // change detection.
      this.store
        .select(selectScene)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((scene) => {
          this.currentScene = scene;
          this.renderCurrent();
        });
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private renderCurrent(): void {
    const scene = this.currentScene;
    if (scene === null) return;
    const canvas = this.canvasRef.nativeElement;
    const surface = this.buildSurface(canvas);
    if (!this.attached) {
      this.renderer.attach(surface);
      this.attached = true;
    } else {
      // Re-attach for surface size changes — the renderer's `attach` is
      // idempotent and the source of truth for backing-store sizing.
      this.renderer.attach(surface);
    }
    this.renderer.render(scene, this.computeViewport(surface, scene));
  }

  private installResizeObserver(): void {
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof Observer !== 'function') return;

    const observer = new Observer(() => {
      this.renderCurrent();
    });
    observer.observe(this.canvasRef.nativeElement);
    this.resizeObserver = observer;
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private teardown(): void {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.attached) {
      this.renderer.dispose();
      this.attached = false;
    }
  }

  private buildSurface(canvas: HTMLCanvasElement): RenderSurface {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : canvas.clientWidth || 1;
    const height = rect.height > 0 ? rect.height : canvas.clientHeight || 1;
    const dpr =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1;
    return { canvas, devicePixelRatio: dpr, width, height };
  }

  private computeViewport(surface: RenderSurface, scene: Scene): Viewport {
    return defaultViewport(
      { width: surface.width, height: surface.height },
      { width: scene.tank.width, height: scene.tank.height },
    );
  }
}
