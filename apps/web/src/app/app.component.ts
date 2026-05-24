// Root component for apps/web — Stage 0 F0.6 + F1.1 Phase B + Stage 3 F3.3.
//
// Responsibilities:
//   1. Host a CSS-grid layout: a sidebar with tank-setup + substrate-tool +
//      hardscape-tool panels on the left, the full-height scene canvas on
//      the right.
//   2. Subscribe to the NgRx scene + selection stores; re-render the canvas
//      whenever either changes.
//   3. On host resize (ResizeObserver), recompute the viewport against the
//      current scene's tank dimensions and re-render.
//   4. Pointer events on the canvas: click → hitTest → dispatch select
//      (shift-click toggles). Click on empty space clears selection.
//   5. Receive hardscape drops from the palette via HardscapeDragService:
//      convert screen → world coords, mint a new ObjectId, dispatch
//      AddObject. The first hardscape drop also creates a default
//      "Hardscape" layer if no layer exists yet.
//   6. On destroy, dispose the renderer and disconnect the observer.
//
// The component never mutates the `Scene`. It dispatches actions; the
// effect turns them into Commands; the reducer commits a new `Scene`;
// the selector here emits, and the canvas redraws.

import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { HardscapeEntry } from '@aquascape/domain/catalog';
import {
  addLayer,
  addObject,
  asLayerId,
  asObjectId,
  identityTransform,
  type HardscapeObject,
  type LayerId,
  type ObjectId,
  type Scene,
} from '@aquascape/domain/scene-model';
import {
  EditorShellComponent,
  SelectionInspectorComponent,
} from '@aquascape/features/editor-shell';
import {
  HardscapeDragService,
  HardscapeToolComponent,
} from '@aquascape/features/hardscape-tool';
import { SubstrateToolComponent } from '@aquascape/features/substrate-tool';
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
import {
  SceneActions,
  SelectionActions,
  selectScene,
  selectSelectedIds,
} from '@aquascape/state';
import { Store } from '@ngrx/store';

import { defaultViewport } from './default-viewport';
import { SCENE_RENDERER } from './renderer.token';

@Component({
  selector: 'aquascape-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    EditorShellComponent,
    HardscapeToolComponent,
    SelectionInspectorComponent,
    SubstrateToolComponent,
    TankSetupComponent,
  ],
  template: `
    <div class="app-shell">
      <aquascape-editor-shell></aquascape-editor-shell>
      <div class="app-grid">
        <aside class="app-sidebar" aria-label="Tools">
          <aquascape-tank-setup></aquascape-tank-setup>
          <aquascape-substrate-tool></aquascape-substrate-tool>
          <aquascape-hardscape-tool></aquascape-hardscape-tool>
        </aside>
        <main class="app-canvas-host">
          <canvas
            #canvas
            class="scene-canvas"
            aria-label="Aquascape design canvas"
            role="img"
            (pointerdown)="onCanvasPointerDown($event)"
          ></canvas>
          <aquascape-selection-inspector></aquascape-selection-inspector>
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .app-shell {
        display: grid;
        grid-template-rows: auto 1fr;
        height: 100%;
      }
      .app-grid {
        display: grid;
        grid-template-columns: minmax(280px, 360px) 1fr;
        min-height: 0;
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
        cursor: crosshair;
      }
    `,
  ],
})
export class AppComponent implements AfterViewInit, OnDestroy {
  private readonly renderer = inject<SceneRenderer>(SCENE_RENDERER);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);
  private readonly dragService = inject(HardscapeDragService);

  private readonly fileService: FileService = inject(FILE_SERVICE);
  private readonly dialogService: DialogService = inject(DIALOG_SERVICE);
  private readonly storageService: StorageService = inject(STORAGE_SERVICE);
  private readonly renderExportService: RenderExportService = inject(RENDER_EXPORT_SERVICE);

  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  private currentScene: Scene | null = null;
  private currentSelection: readonly ObjectId[] = [];
  private currentViewport: Viewport | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private attached = false;

  ngAfterViewInit(): void {
    void this.fileService;
    void this.dialogService;
    void this.storageService;
    void this.renderExportService;

    this.ngZone.runOutsideAngular(() => {
      this.installResizeObserver();
      // Combine scene + selection so a change in either triggers a single
      // re-render. takeUntilDestroyed tears down on component destroy.
      combineLatest([
        this.store.select(selectScene),
        this.store.select(selectSelectedIds),
      ])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([scene, ids]) => {
          this.currentScene = scene;
          this.currentSelection = ids;
          this.renderCurrent();
        });

      // Receive palette drops: convert screen → world coords and dispatch
      // AddObject. If the scene has no layers yet, prepend a default
      // "Hardscape" layer first so AddObject has a target.
      this.dragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onHardscapeDropped(evt.entry, evt.clientX, evt.clientY));
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  // ── Pointer interactions on the canvas ────────────────────────────────

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    const hit = this.renderer.hitTest({ x: cssX, y: cssY }, scene, viewport, coreCatalog);
    if (hit === null) {
      // Clicked empty space — clear unless shift held (preserve selection
      // for shift-click-on-object multi-select that follows on subsequent
      // clicks).
      if (!event.shiftKey) {
        this.store.dispatch(SelectionActions.clearSelection());
      }
      return;
    }
    if (event.shiftKey) {
      this.store.dispatch(SelectionActions.toggleInSelection({ id: hit.objectId }));
    } else {
      this.store.dispatch(SelectionActions.replaceSelection({ ids: [hit.objectId] }));
    }
  }

  /** Esc clears the selection — matches every desktop design tool. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.store.dispatch(SelectionActions.clearSelection());
  }

  // ── Drop receive (palette → canvas) ────────────────────────────────────

  private onHardscapeDropped(entry: HardscapeEntry, clientX: number, clientY: number): void {
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    // Drops outside the canvas are no-ops.
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return;
    }
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const world = canvasCssToWorld({ x: cssX, y: cssY }, viewport, {
      width: rect.width,
      height: rect.height,
    });
    // Z defaults to half tank depth (centered front-to-back). The user
    // can edit later via the inspector (or future Stage 10 3D drag).
    const z = scene.tank.depth / 2;

    const layerId = this.ensureLayerExists(scene);
    const newObject: HardscapeObject = {
      kind: 'hardscape',
      id: newObjectId(),
      ref: { catalog: entry.catalog, id: entry.id, version: entry.version },
      category: entry.category,
      transform: {
        ...identityTransform(),
        position: { x: world.x, y: world.y, z },
      },
    };
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: addObject(layerId, newObject) }),
    );
    // Auto-select the newly-dropped object so the user immediately sees
    // its selection handles.
    this.store.dispatch(SelectionActions.replaceSelection({ ids: [newObject.id] }));
  }

  /**
   * Find a layer to drop the new hardscape into. If the scene is empty,
   * create a "Hardscape" layer first. Returns the id of the target layer.
   * Always picks the topmost (front-most) layer so subsequent drops land
   * visually on top of earlier ones.
   */
  private ensureLayerExists(scene: Scene): LayerId {
    const top = scene.layers[scene.layers.length - 1];
    if (top !== undefined) return top.id;
    const id = asLayerId(newUuid());
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: addLayer({
          id,
          name: 'Hardscape',
          opacity: 1,
          visible: true,
          locked: false,
          objects: [],
        }),
      }),
    );
    return id;
  }

  // ── Render lifecycle ───────────────────────────────────────────────────

  private renderCurrent(): void {
    const scene = this.currentScene;
    if (scene === null) return;
    const canvas = this.canvasRef.nativeElement;
    const surface = this.buildSurface(canvas);
    if (!this.attached) {
      this.renderer.attach(surface);
      this.attached = true;
    } else {
      this.renderer.attach(surface);
    }
    const viewport = this.computeViewport(surface, scene);
    this.currentViewport = viewport;
    this.renderer.render(scene, viewport, coreCatalog, this.currentSelection);
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

// ─── Local pure helpers ───────────────────────────────────────────────────

/**
 * Invert the viewport's world-to-canvas projection. Mirrors the helper
 * the renderer uses for hit-test, kept inline here so the app doesn't
 * need to import a renderer-internal utility.
 */
function canvasCssToWorld(
  pointCss: { x: number; y: number },
  viewport: Viewport,
  canvas: { width: number; height: number },
): { x: number; y: number } {
  const dxPx = pointCss.x - canvas.width / 2;
  const dyPx = pointCss.y - canvas.height / 2;
  const dxMm = dxPx / viewport.zoom;
  const dyMm = -dyPx / viewport.zoom;
  const cos = Math.cos(viewport.rotation);
  const sin = Math.sin(viewport.rotation);
  const rxMm = dxMm * cos - dyMm * sin;
  const ryMm = dxMm * sin + dyMm * cos;
  return { x: viewport.center.x + rxMm, y: viewport.center.y + ryMm };
}

/** UUID v4 with a `Math.random` fallback for jsdom test environments. */
function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function newObjectId(): ObjectId {
  return asObjectId(newUuid());
}
