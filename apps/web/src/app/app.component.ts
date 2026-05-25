// Root component for apps/web — Stages 0–3 + 3.x.
//
// Responsibilities:
//   1. Host a CSS-grid layout: a sidebar with tank-setup + substrate-tool +
//      hardscape-tool panels on the left, the full-height scene canvas on
//      the right + the floating selection inspector overlaying the canvas.
//   2. Subscribe to the NgRx scene + selection stores; re-render the canvas
//      whenever either (or the in-progress drag preview) changes.
//   3. On host resize (ResizeObserver), recompute the viewport against the
//      current scene's tank dimensions and re-render.
//   4. **Pointer interactions on the canvas (Stage 3.x).** Single pointer
//      down does click-or-drag based on the renderer's hit result:
//        - handle: 'rotate'       → rotate drag
//        - handle: 'scale*'       → scale drag
//        - body of a selected obj → move drag
//        - body of an unselected  → select then move drag
//        - empty space            → marquee drag (shift = additive)
//      Every drag is committed on `pointerup` as a single command, so the
//      undo stack sees one entry per gesture (intermediate pointer-move
//      ticks are LOCAL preview state — they never dispatch).
//   5. Receive hardscape drops from the palette via HardscapeDragService:
//      convert screen → world coords, mint a new ObjectId, dispatch
//      AddObject. The first hardscape drop also creates a default
//      "Hardscape" layer if no layer exists yet.
//   6. On destroy, dispose the renderer and disconnect the observer.
//
// The component never mutates the store's `Scene`. During a drag, a
// **transient previewScene** is built (the live scene with the dragged
// object's transform overridden) and handed to the renderer; the store
// only sees the final transform on pointer-up. This keeps undo clean
// (one history entry per drag) and means a Cmd+Z lands the user back at
// the pre-drag state, not at some intermediate frame.

import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { HardscapeEntry, PlantEntry } from '@aquascape/domain/catalog';
import type { Transform } from '@aquascape/domain/geometry';
import {
  addLayer,
  addObject,
  asLayerId,
  asObjectId,
  identityTransform,
  moveObject,
  reshapeObject,
  type HardscapeObject,
  type LayerId,
  type Layer,
  type ObjectId,
  type PlantObject,
  type Scene,
  type SceneObject,
} from '@aquascape/domain/scene-model';
import {
  CursorPositionService,
  EditorShellComponent,
  PreviewTimeService,
  SelectionInspectorComponent,
  StatusBarComponent,
  TimeSliderComponent,
} from '@aquascape/features/editor-shell';
import { HardscapeDragService, HardscapeToolComponent } from '@aquascape/features/hardscape-tool';
import { LayersPanelComponent } from '@aquascape/features/layers-panel';
import { PlantDragService, PlantingToolComponent } from '@aquascape/features/planting-tool';
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
import type {
  HitResult,
  RenderSurface,
  SceneRenderer,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import { SceneActions, SelectionActions, selectScene, selectSelectedIds } from '@aquascape/state';
import { Store } from '@ngrx/store';

import { defaultViewport } from './default-viewport';
import { applyMoveDrag, applyRotateDrag, applyScaleDrag } from './drag-math';
import { SCENE_RENDERER } from './renderer.token';
import {
  boundsFor,
  clampPanelWidth,
  resolveBreakpoint,
  SHELL_STORAGE_KEYS,
  type ShellBreakpoint,
} from './shell-layout';

// ─── Drag state shape ────────────────────────────────────────────────────

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Discriminated state for an in-flight pointer drag. Null when idle. */
type DragState =
  | {
      readonly kind: 'move';
      readonly objectId: ObjectId;
      readonly originalTransform: Transform;
      readonly startWorld: Vec2;
      readonly currentWorld: Vec2;
    }
  | {
      readonly kind: 'scale';
      readonly objectId: ObjectId;
      readonly originalTransform: Transform;
      readonly startWorld: Vec2;
      readonly currentWorld: Vec2;
    }
  | {
      readonly kind: 'rotate';
      readonly objectId: ObjectId;
      readonly originalTransform: Transform;
      readonly startWorld: Vec2;
      readonly currentWorld: Vec2;
    }
  | {
      readonly kind: 'marquee';
      readonly startCss: Vec2;
      readonly currentCss: Vec2;
      readonly shift: boolean;
    };

@Component({
  selector: 'aquascape-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    EditorShellComponent,
    HardscapeToolComponent,
    LayersPanelComponent,
    PlantingToolComponent,
    SelectionInspectorComponent,
    StatusBarComponent,
    SubstrateToolComponent,
    TankSetupComponent,
    TimeSliderComponent,
  ],
  template: `
    <div
      class="app-shell"
      [class.is-phone]="breakpoint() === 'phone'"
      [class.is-tablet]="breakpoint() === 'tablet'"
      [class.sidebar-collapsed]="sidebarCollapsed()"
      [class.rail-collapsed]="railCollapsed()"
      [class.sidebar-open]="phoneSidebarOpen()"
      [class.rail-open]="phoneRailOpen()"
    >
      <aquascape-editor-shell></aquascape-editor-shell>

      <!-- Phone-only drawer toggle bar. Hidden via CSS above 768px. -->
      <div class="app-drawer-bar" role="toolbar" aria-label="Panel toggles">
        <button
          type="button"
          class="drawer-toggle"
          [attr.aria-expanded]="phoneSidebarOpen()"
          aria-controls="app-sidebar"
          aria-label="Toggle tools panel"
          (click)="togglePhoneSidebar()"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M2 3h12M2 8h12M2 13h12"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              fill="none"
            />
          </svg>
          <span>Tools</span>
        </button>
        <button
          type="button"
          class="drawer-toggle"
          [attr.aria-expanded]="phoneRailOpen()"
          aria-controls="app-rail"
          aria-label="Toggle layers panel"
          (click)="togglePhoneRail()"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
            <path
              d="M2 4h12v3H2zM2 9h12v3H2z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
            />
          </svg>
          <span>Layers</span>
        </button>
      </div>

      <div class="app-grid">
        <!-- Re-expand strip (left). Shown when sidebar is collapsed. Hidden in
             phone mode because the drawer toggle replaces it. -->
        @if (sidebarCollapsed() && breakpoint() !== 'phone') {
          <button
            type="button"
            class="reexpand-strip reexpand-left"
            aria-label="Expand tools panel"
            title="Expand tools panel"
            (click)="setSidebarCollapsed(false)"
          >
            <svg aria-hidden="true" viewBox="0 0 12 16" width="12" height="16">
              <path
                d="M4 4l4 4-4 4"
                stroke="currentColor"
                stroke-width="1.6"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="reexpand-strip__label">Tools</span>
          </button>
        }

        <aside
          id="app-sidebar"
          class="app-sidebar"
          aria-label="Tools"
          [attr.aria-hidden]="breakpoint() === 'phone' && !phoneSidebarOpen() ? true : null"
        >
          <header class="pane-header">
            <button
              type="button"
              class="pane-collapse"
              [attr.aria-expanded]="
                !sidebarCollapsed() && (breakpoint() !== 'phone' || phoneSidebarOpen())
              "
              aria-controls="app-sidebar-body"
              [attr.aria-label]="
                breakpoint() === 'phone' ? 'Close tools panel' : 'Collapse tools panel'
              "
              [attr.title]="
                breakpoint() === 'phone' ? 'Close tools panel' : 'Collapse tools panel'
              "
              (click)="collapseSidebar()"
            >
              <svg aria-hidden="true" viewBox="0 0 12 16" width="12" height="16">
                <path
                  d="M8 4l-4 4 4 4"
                  stroke="currentColor"
                  stroke-width="1.6"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <span class="pane-title">Tools</span>
          </header>
          <div id="app-sidebar-body" class="pane-body">
            <aquascape-tank-setup></aquascape-tank-setup>
            <aquascape-substrate-tool></aquascape-substrate-tool>
            <aquascape-hardscape-tool></aquascape-hardscape-tool>
            <aquascape-planting-tool></aquascape-planting-tool>
          </div>
        </aside>

        <!-- Sidebar drag handle. Hidden when collapsed (no panel to size) or
             in phone mode (overlay drawer doesn't resize). -->
        @if (!sidebarCollapsed() && breakpoint() !== 'phone') {
          <div
            class="resize-handle resize-handle-sidebar"
            role="separator"
            aria-orientation="vertical"
            aria-controls="app-sidebar"
            [attr.aria-valuemin]="currentSidebarBounds().min"
            [attr.aria-valuemax]="currentSidebarBounds().max"
            [attr.aria-valuenow]="sidebarWidth()"
            aria-label="Resize tools panel"
            tabindex="0"
            (pointerdown)="onSidebarHandlePointerDown($event)"
            (keydown)="onSidebarHandleKey($event)"
          ></div>
        }

        <main class="app-canvas-host">
          <canvas
            #canvas
            class="scene-canvas"
            aria-label="Aquascape design canvas"
            role="img"
            (pointerdown)="onCanvasPointerDown($event)"
            (pointermove)="onCanvasPointerMove($event)"
            (pointerleave)="onCanvasPointerLeave()"
          ></canvas>
          @if (sceneIsEmpty()) {
            <div class="empty-hint" aria-hidden="true">
              <h3>Build your first scape</h3>
              <p>
                Pick a tank in the top-left, sculpt substrate, then drag hardscape and plants from
                the palettes onto the canvas. Scrub the bottom slider to preview plant growth over
                time.
              </p>
            </div>
          }
          @if (marqueeRect(); as r) {
            <div
              class="marquee-overlay"
              [style.left.px]="r.left"
              [style.top.px]="r.top"
              [style.width.px]="r.width"
              [style.height.px]="r.height"
              aria-hidden="true"
            ></div>
          }
          <aquascape-selection-inspector></aquascape-selection-inspector>
          @if (paletteDragGhost(); as g) {
            <div
              class="palette-drag-ghost"
              [style.left.px]="g.x"
              [style.top.px]="g.y"
              aria-hidden="true"
            >
              {{ g.label }}
            </div>
          }
          <div class="app-status">
            <aquascape-status-bar></aquascape-status-bar>
          </div>
          <div class="app-timeslider">
            <aquascape-time-slider></aquascape-time-slider>
          </div>
        </main>

        @if (!railCollapsed() && breakpoint() !== 'phone') {
          <div
            class="resize-handle resize-handle-rail"
            role="separator"
            aria-orientation="vertical"
            aria-controls="app-rail"
            [attr.aria-valuemin]="currentRailBounds().min"
            [attr.aria-valuemax]="currentRailBounds().max"
            [attr.aria-valuenow]="railWidth()"
            aria-label="Resize layers panel"
            tabindex="0"
            (pointerdown)="onRailHandlePointerDown($event)"
            (keydown)="onRailHandleKey($event)"
          ></div>
        }

        <aside
          id="app-rail"
          class="app-rail"
          aria-label="Layers"
          [attr.aria-hidden]="breakpoint() === 'phone' && !phoneRailOpen() ? true : null"
        >
          <header class="pane-header">
            <button
              type="button"
              class="pane-collapse"
              [attr.aria-expanded]="
                !railCollapsed() && (breakpoint() !== 'phone' || phoneRailOpen())
              "
              aria-controls="app-rail-body"
              [attr.aria-label]="
                breakpoint() === 'phone' ? 'Close layers panel' : 'Collapse layers panel'
              "
              [attr.title]="
                breakpoint() === 'phone' ? 'Close layers panel' : 'Collapse layers panel'
              "
              (click)="collapseRail()"
            >
              <svg aria-hidden="true" viewBox="0 0 12 16" width="12" height="16">
                <path
                  d="M4 4l4 4-4 4"
                  stroke="currentColor"
                  stroke-width="1.6"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <span class="pane-title">Layers</span>
          </header>
          <div id="app-rail-body" class="pane-body">
            <aquascape-layers-panel></aquascape-layers-panel>
          </div>
        </aside>

        @if (railCollapsed() && breakpoint() !== 'phone') {
          <button
            type="button"
            class="reexpand-strip reexpand-right"
            aria-label="Expand layers panel"
            title="Expand layers panel"
            (click)="setRailCollapsed(false)"
          >
            <svg aria-hidden="true" viewBox="0 0 12 16" width="12" height="16">
              <path
                d="M8 4l-4 4 4 4"
                stroke="currentColor"
                stroke-width="1.6"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="reexpand-strip__label">Layers</span>
          </button>
        }
      </div>

      <!-- Backdrop scrim for the phone drawers. Click to close. Pointer-events
           only active in phone mode + when a drawer is open (CSS gates this). -->
      <div class="drawer-scrim" aria-hidden="true" (click)="closePhoneDrawers()"></div>
    </div>
  `,
  styles: [
    `
      /* Component-scoped styles only — the editor-shell layout (grid columns,
         resize handles, drawer slide-ins, breakpoints) lives in the global
         styles.css because (a) those rules target classes on the
         aquascape-root host + its descendants, and (b) keeping them
         inside the component pushes the bundle over the 4kb per-component
         CSS budget. Component CSS here is only the canvas-local overlays. */
      .app-canvas-host {
        position: relative;
        overflow: hidden;
        min-width: 0;
      }
      .app-timeslider {
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: 12px;
        pointer-events: auto;
      }
      .app-status {
        position: absolute;
        right: 12px;
        bottom: 64px;
        z-index: 3;
      }
      .empty-hint {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 460px;
        padding: 18px 22px;
        background: rgba(32, 35, 42, 0.78);
        color: #f0f2f5;
        border-radius: 10px;
        text-align: center;
        pointer-events: none;
        z-index: 2;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
      }
      .empty-hint h3 {
        margin: 0 0 6px;
        font-size: 14px;
        font-weight: 600;
      }
      .empty-hint p {
        margin: 0;
        opacity: 0.92;
      }
      .scene-canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        touch-action: none;
      }
      .marquee-overlay {
        position: absolute;
        background: rgba(58, 142, 255, 0.12);
        border: 1px dashed rgba(58, 142, 255, 0.8);
        pointer-events: none;
        z-index: 4;
      }
      /* Drag preview that follows the cursor when the user is dragging a
         palette tile (hardscape or plant) toward the canvas. Positioned at
         the FIXED viewport coords from the drag service since the canvas
         host may be inset from the viewport. The pill is offset slightly
         above-right of the cursor so the actual drop point is unobscured. */
      .palette-drag-ghost {
        position: fixed;
        transform: translate(12px, -28px);
        padding: 4px 10px;
        background: rgba(32, 35, 42, 0.92);
        color: #fff;
        border-radius: 12px;
        font-size: 12px;
        line-height: 1.2;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        white-space: nowrap;
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
  private readonly plantDragService = inject(PlantDragService);
  private readonly previewTime = inject(PreviewTimeService);
  private readonly cursorPos = inject(CursorPositionService);
  private readonly cdr = inject(ChangeDetectorRef);

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

  private dragState: DragState | null = null;
  /** Document-level move/up handlers held so we can remove on cancel/end. */
  private documentMoveHandler: ((e: PointerEvent) => void) | null = null;
  private documentUpHandler: ((e: PointerEvent) => void) | null = null;

  /** Marquee rect in canvas-CSS coords for the template overlay (signal so OnPush picks it up). */
  readonly marqueeRect = signal<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  /**
   * Drag-ghost label + viewport coords for the cursor follower shown while a
   * palette tile is being dragged toward the canvas. Computed from whichever
   * drag service is currently active (hardscape OR plant). Returns null when
   * idle so the template hides the overlay.
   */
  readonly paletteDragGhost = computed<{ x: number; y: number; label: string } | null>(() => {
    const hard = this.dragService.active();
    if (hard !== null) return { x: hard.clientX, y: hard.clientY, label: hard.entry.name };
    const plant = this.plantDragService.active();
    if (plant !== null) return { x: plant.clientX, y: plant.clientY, label: plant.entry.name };
    return null;
  });

  /** Signal that flips to true when the scene has no objects in any layer. */
  readonly sceneIsEmpty = signal<boolean>(true);

  // ─── Shell layout state (Figma-style resizable + collapsible panels) ──
  //
  // Widths live as signals so the template can read `aria-valuenow`, but the
  // actual layout updates during a drag are pushed straight to the host CSS
  // variables (no per-frame ngStyle / change-detection). The signal is only
  // written on pointer-up (the commit) and on the keyboard-nudge path.

  readonly sidebarWidth = signal<number>(320);
  readonly railWidth = signal<number>(280);
  readonly sidebarCollapsed = signal<boolean>(false);
  readonly railCollapsed = signal<boolean>(false);

  /** Current viewport-derived breakpoint. Drives the layout mode + drawer toggles. */
  readonly breakpoint = signal<ShellBreakpoint>('wide');

  /** Phone-only: which drawer (if any) is currently overlaid on the canvas. */
  readonly phoneSidebarOpen = signal<boolean>(false);
  readonly phoneRailOpen = signal<boolean>(false);

  /** Memoized bounds for the current breakpoint (`computed` so the template can
   *  bind aria-valuemin / aria-valuemax against them without recomputing). */
  readonly currentSidebarBounds = computed(() => boundsFor(this.breakpoint(), 'sidebar'));
  readonly currentRailBounds = computed(() => boundsFor(this.breakpoint(), 'rail'));

  /** True only after `hydrateShellLayout()` resolves. Until then we hold off
   *  writing the persisted values back (so the initial hydration doesn't
   *  echo into storage on every boot). */
  private shellHydrated = false;

  /** Active handle drag state. */
  private handleDragState: {
    readonly panel: 'sidebar' | 'rail';
    readonly startCssX: number;
    readonly startWidth: number;
  } | null = null;
  private handleMoveHandler: ((e: PointerEvent) => void) | null = null;
  private handleUpHandler: ((e: PointerEvent) => void) | null = null;

  /** Cached MediaQueryList objects + their listeners so we can detach on destroy. */
  private mqlPhone: MediaQueryList | null = null;
  private mqlTablet: MediaQueryList | null = null;
  private mqlListener: ((e: MediaQueryListEvent) => void) | null = null;

  ngAfterViewInit(): void {
    void this.fileService;
    void this.dialogService;
    void this.renderExportService;

    // Apply the initial host CSS variables (so layout looks right before
    // hydration resolves), set up the matchMedia listener, then hydrate.
    this.applyHostWidths();
    this.initBreakpointWatcher();
    void this.hydrateShellLayout();

    this.ngZone.runOutsideAngular(() => {
      this.installResizeObserver();
      combineLatest([this.store.select(selectScene), this.store.select(selectSelectedIds)])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([scene, ids]) => {
          this.currentScene = scene;
          this.currentSelection = ids;
          this.sceneIsEmpty.set(
            scene === null || scene.layers.every((l) => l.objects.length === 0),
          );
          this.renderCurrent();
        });

      this.dragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onHardscapeDropped(evt.entry, evt.clientX, evt.clientY));

      this.plantDragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onPlantDropped(evt.entry, evt.clientX, evt.clientY));
    });
  }

  // F4.4 — re-render when the preview-age signal changes so plant scales
  // update interactively while the user scrubs the time slider. The signal
  // lives outside the NgRx store (transient UI state), so we react via an
  // Angular effect rather than rolling it into the combineLatest above.
  //
  // The first effect invocation only registers the dependency (no scene
  // yet — combineLatest fires the initial render). After that, every
  // signal change calls `renderCurrent()`, which re-reads the signal and
  // passes the new value to `renderer.render`.
  private previewTimePrevious: number | null = null;
  private previewTimeFirstRun = true;
  private readonly previewTimeEffect = effect(() => {
    const value = this.previewTime.previewAgeWeeks();
    if (this.previewTimeFirstRun) {
      this.previewTimeFirstRun = false;
      this.previewTimePrevious = value;
      return;
    }
    if (value === this.previewTimePrevious) return;
    this.previewTimePrevious = value;
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  ngOnDestroy(): void {
    this.teardown();
    this.cancelDrag(); // detach any in-flight document listeners
    this.detachHandleListeners();
    this.detachBreakpointWatcher();
  }

  // ─── Shell layout: hydration ─────────────────────────────────────────────

  /**
   * Pull persisted widths + collapsed flags out of the StorageService and
   * apply them. Tolerant of partial / corrupted state: each key is
   * read + validated independently, and any unreadable value falls back to
   * the breakpoint default (via `clampPanelWidth`).
   *
   * Marks `shellHydrated = true` only at the end so the per-commit writes
   * (`persistSidebarWidth` etc.) don't accidentally re-write the defaults
   * back into storage on a fresh boot before the user has done anything.
   */
  private async hydrateShellLayout(): Promise<void> {
    try {
      const [sw, rw, sc, rc] = await Promise.all([
        this.storageService.get<number>(SHELL_STORAGE_KEYS.sidebarWidth),
        this.storageService.get<number>(SHELL_STORAGE_KEYS.railWidth),
        this.storageService.get<boolean>(SHELL_STORAGE_KEYS.sidebarCollapsed),
        this.storageService.get<boolean>(SHELL_STORAGE_KEYS.railCollapsed),
      ]);
      const sidebarBounds = boundsFor(this.breakpoint(), 'sidebar');
      const railBounds = boundsFor(this.breakpoint(), 'rail');
      if (typeof sw === 'number') {
        this.sidebarWidth.set(
          clampPanelWidth(sw, sidebarBounds.min, sidebarBounds.max, sidebarBounds.defaultValue),
        );
      }
      if (typeof rw === 'number') {
        this.railWidth.set(
          clampPanelWidth(rw, railBounds.min, railBounds.max, railBounds.defaultValue),
        );
      }
      if (typeof sc === 'boolean') this.sidebarCollapsed.set(sc);
      if (typeof rc === 'boolean') {
        this.railCollapsed.set(rc);
      } else if (this.breakpoint() === 'tablet') {
        // Tablet default: auto-collapse the rail (the user can re-expand
        // explicitly). Only kicks in if no preference is persisted yet.
        this.railCollapsed.set(true);
      }
    } catch {
      // StorageService failures are non-fatal — leave the in-memory defaults
      // in place and continue.
    }
    this.shellHydrated = true;
    this.applyHostWidths();
    this.cdr.markForCheck();
  }

  /** Write the host's CSS custom properties for the current width signals. */
  private applyHostWidths(): void {
    const host =
      (this.canvasRef.nativeElement.ownerDocument?.querySelector(
        'aquascape-root',
      ) as HTMLElement | null) ?? null;
    if (host === null) return;
    host.style.setProperty('--sidebar-width', `${this.sidebarWidth()}px`);
    host.style.setProperty('--rail-width', `${this.railWidth()}px`);
  }

  // ─── Shell layout: breakpoint watcher ────────────────────────────────────

  private initBreakpointWatcher(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      // Test/SSR environment — leave breakpoint() at its `wide` default.
      return;
    }
    this.mqlPhone = window.matchMedia('(max-width: 767px)');
    this.mqlTablet = window.matchMedia('(min-width: 768px) and (max-width: 1199px)');
    this.recomputeBreakpoint();
    const listener = (): void => this.recomputeBreakpoint();
    this.mqlListener = listener;
    // `addEventListener('change', …)` is supported in every modern browser;
    // the older `addListener` API isn't needed for our minimum target.
    this.mqlPhone.addEventListener('change', listener);
    this.mqlTablet.addEventListener('change', listener);
  }

  private detachBreakpointWatcher(): void {
    if (this.mqlListener === null) return;
    this.mqlPhone?.removeEventListener('change', this.mqlListener);
    this.mqlTablet?.removeEventListener('change', this.mqlListener);
    this.mqlListener = null;
    this.mqlPhone = null;
    this.mqlTablet = null;
  }

  private recomputeBreakpoint(): void {
    if (typeof window === 'undefined') return;
    const bp = resolveBreakpoint(window.innerWidth);
    const previous = this.breakpoint();
    if (bp === previous) return;
    this.breakpoint.set(bp);
    // Close any open phone drawer when leaving phone mode so it doesn't
    // linger as a hidden focus-trap.
    if (bp !== 'phone') {
      this.phoneSidebarOpen.set(false);
      this.phoneRailOpen.set(false);
    }
    // Re-clamp current widths against the new bounds (don't OVERWRITE the
    // persisted preference — clamp only). This keeps a 320px sidebar wide-
    // mode preference at 320px when zooming back from tablet to wide.
    const sb = boundsFor(bp, 'sidebar');
    const rb = boundsFor(bp, 'rail');
    this.sidebarWidth.set(clampPanelWidth(this.sidebarWidth(), sb.min, sb.max, sb.defaultValue));
    this.railWidth.set(clampPanelWidth(this.railWidth(), rb.min, rb.max, rb.defaultValue));
    this.applyHostWidths();
    this.cdr.markForCheck();
  }

  // ─── Shell layout: collapse toggles ──────────────────────────────────────

  collapseSidebar(): void {
    if (this.breakpoint() === 'phone') {
      this.phoneSidebarOpen.set(false);
      return;
    }
    this.setSidebarCollapsed(true);
  }

  collapseRail(): void {
    if (this.breakpoint() === 'phone') {
      this.phoneRailOpen.set(false);
      return;
    }
    this.setRailCollapsed(true);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed.set(collapsed);
    this.persistFlag(SHELL_STORAGE_KEYS.sidebarCollapsed, collapsed);
    this.cdr.markForCheck();
  }

  setRailCollapsed(collapsed: boolean): void {
    this.railCollapsed.set(collapsed);
    this.persistFlag(SHELL_STORAGE_KEYS.railCollapsed, collapsed);
    this.cdr.markForCheck();
  }

  togglePhoneSidebar(): void {
    const next = !this.phoneSidebarOpen();
    this.phoneSidebarOpen.set(next);
    // Mutually exclusive — opening one closes the other so the canvas stays
    // visible behind the active drawer.
    if (next) this.phoneRailOpen.set(false);
    this.cdr.markForCheck();
  }

  togglePhoneRail(): void {
    const next = !this.phoneRailOpen();
    this.phoneRailOpen.set(next);
    if (next) this.phoneSidebarOpen.set(false);
    this.cdr.markForCheck();
  }

  closePhoneDrawers(): void {
    this.phoneSidebarOpen.set(false);
    this.phoneRailOpen.set(false);
    this.cdr.markForCheck();
  }

  // ─── Shell layout: resize handle pointer drag ────────────────────────────

  onSidebarHandlePointerDown(event: PointerEvent): void {
    this.startHandleDrag(event, 'sidebar');
  }

  onRailHandlePointerDown(event: PointerEvent): void {
    this.startHandleDrag(event, 'rail');
  }

  private startHandleDrag(event: PointerEvent, panel: 'sidebar' | 'rail'): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = panel === 'sidebar' ? this.sidebarWidth() : this.railWidth();
    this.handleDragState = { panel, startCssX: event.clientX, startWidth };
    document.body.classList.add('is-dragging-handle');
    const move = (e: PointerEvent): void => this.onHandlePointerMove(e);
    const up = (e: PointerEvent): void => this.onHandlePointerUp(e);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    this.handleMoveHandler = move;
    this.handleUpHandler = up;
  }

  private onHandlePointerMove(event: PointerEvent): void {
    const state = this.handleDragState;
    if (state === null) return;
    const dx = event.clientX - state.startCssX;
    // Sidebar grows when the cursor moves right; rail grows when the cursor
    // moves left. The sign flip is the only difference between the two.
    const rawWidth = state.panel === 'sidebar' ? state.startWidth + dx : state.startWidth - dx;
    const bounds =
      state.panel === 'sidebar' ? this.currentSidebarBounds() : this.currentRailBounds();
    const clamped = clampPanelWidth(rawWidth, bounds.min, bounds.max, bounds.defaultValue);
    // Write straight to the host CSS var — no signal write yet (avoids
    // change-detection per frame). The signal is committed on pointerup.
    const host =
      (this.canvasRef.nativeElement.ownerDocument?.querySelector(
        'aquascape-root',
      ) as HTMLElement | null) ?? null;
    if (host !== null) {
      host.style.setProperty(
        state.panel === 'sidebar' ? '--sidebar-width' : '--rail-width',
        `${clamped}px`,
      );
    }
  }

  private onHandlePointerUp(event: PointerEvent): void {
    const state = this.handleDragState;
    if (state === null) return;
    const dx = event.clientX - state.startCssX;
    const rawWidth = state.panel === 'sidebar' ? state.startWidth + dx : state.startWidth - dx;
    const bounds =
      state.panel === 'sidebar' ? this.currentSidebarBounds() : this.currentRailBounds();
    const clamped = clampPanelWidth(rawWidth, bounds.min, bounds.max, bounds.defaultValue);
    if (state.panel === 'sidebar') {
      this.sidebarWidth.set(clamped);
      this.persistWidth(SHELL_STORAGE_KEYS.sidebarWidth, clamped);
    } else {
      this.railWidth.set(clamped);
      this.persistWidth(SHELL_STORAGE_KEYS.railWidth, clamped);
    }
    this.detachHandleListeners();
    document.body.classList.remove('is-dragging-handle');
    this.applyHostWidths();
    this.cdr.markForCheck();
  }

  private detachHandleListeners(): void {
    if (this.handleMoveHandler !== null) {
      document.removeEventListener('pointermove', this.handleMoveHandler);
      this.handleMoveHandler = null;
    }
    if (this.handleUpHandler !== null) {
      document.removeEventListener('pointerup', this.handleUpHandler);
      this.handleUpHandler = null;
    }
    this.handleDragState = null;
  }

  // ─── Shell layout: keyboard a11y for the separators ─────────────────────

  /**
   * Per WAI-ARIA APG, a focused vertical separator responds to ArrowLeft /
   * ArrowRight with width adjustments in fixed increments. Home / End jump
   * to the bounds. The 16px step matches the visual density of the panel
   * gutters; it's intentionally coarse so a keyboard-only user can sweep
   * the full range without holding the key for ages.
   */
  onSidebarHandleKey(event: KeyboardEvent): void {
    this.handleSeparatorKey(event, 'sidebar');
  }

  onRailHandleKey(event: KeyboardEvent): void {
    this.handleSeparatorKey(event, 'rail');
  }

  private handleSeparatorKey(event: KeyboardEvent, panel: 'sidebar' | 'rail'): void {
    const step = 16;
    let delta: number | null = null;
    let absolute: 'min' | 'max' | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        delta = panel === 'sidebar' ? -step : step;
        break;
      case 'ArrowRight':
        delta = panel === 'sidebar' ? step : -step;
        break;
      case 'Home':
        absolute = 'min';
        break;
      case 'End':
        absolute = 'max';
        break;
      default:
        return;
    }
    event.preventDefault();
    const bounds = panel === 'sidebar' ? this.currentSidebarBounds() : this.currentRailBounds();
    const current = panel === 'sidebar' ? this.sidebarWidth() : this.railWidth();
    const raw =
      absolute === 'min' ? bounds.min : absolute === 'max' ? bounds.max : current + (delta ?? 0);
    const clamped = clampPanelWidth(raw, bounds.min, bounds.max, bounds.defaultValue);
    if (panel === 'sidebar') {
      this.sidebarWidth.set(clamped);
      this.persistWidth(SHELL_STORAGE_KEYS.sidebarWidth, clamped);
    } else {
      this.railWidth.set(clamped);
      this.persistWidth(SHELL_STORAGE_KEYS.railWidth, clamped);
    }
    this.applyHostWidths();
    this.cdr.markForCheck();
  }

  // ─── Shell layout: persistence ───────────────────────────────────────────

  private persistWidth(key: string, value: number): void {
    if (!this.shellHydrated) return;
    void this.storageService.set(key, value).catch(() => {
      // Persistence is best-effort — a quota error or transient failure
      // shouldn't break the UI.
    });
  }

  private persistFlag(key: string, value: boolean): void {
    if (!this.shellHydrated) return;
    void this.storageService.set(key, value).catch(() => {
      /* best-effort */
    });
  }

  // ── Pointer down on the canvas: classify the gesture ─────────────────

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const cssPoint: Vec2 = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const hit = this.renderer.hitTest(
      cssPoint,
      scene,
      viewport,
      coreCatalog,
      this.currentSelection,
      this.previewTime.previewAgeWeeks() ?? undefined,
    );

    // Common: convert the pointer position to world coords.
    const startWorld = canvasCssToWorld(cssPoint, viewport, {
      width: rect.width,
      height: rect.height,
    });

    if (hit !== null && hit.handle !== undefined && hit.handle !== 'translate') {
      // Handle drag (scale / rotate). The handle implies the object is
      // selected; no selection mutation needed.
      const obj = findObjectById(scene, hit.objectId);
      if (obj === null) return; // defensive — selection out of sync with scene
      const dragKind: 'scale' | 'rotate' = hit.handle === 'rotate' ? 'rotate' : 'scale';
      this.startDrag({
        kind: dragKind,
        objectId: hit.objectId,
        originalTransform: obj.transform,
        startWorld,
        currentWorld: startWorld,
      });
      event.preventDefault();
      return;
    }

    if (hit !== null) {
      // Body hit. If the object isn't already selected, replace selection
      // first — then start a move drag with the (now-selected) object.
      const alreadySelected = this.currentSelection.includes(hit.objectId);
      if (!alreadySelected) {
        if (event.shiftKey) {
          this.store.dispatch(SelectionActions.toggleInSelection({ id: hit.objectId }));
        } else {
          this.store.dispatch(SelectionActions.replaceSelection({ ids: [hit.objectId] }));
        }
      }
      const obj = findObjectById(scene, hit.objectId);
      if (obj === null) return;
      this.startDrag({
        kind: 'move',
        objectId: hit.objectId,
        originalTransform: obj.transform,
        startWorld,
        currentWorld: startWorld,
      });
      event.preventDefault();
      return;
    }

    // Empty space: marquee drag (shift = additive, no shift = replace).
    this.startDrag({
      kind: 'marquee',
      startCss: cssPoint,
      currentCss: cssPoint,
      shift: event.shiftKey,
    });
    event.preventDefault();
  }

  /**
   * Pointer-move over the canvas — purely for the status-bar readout.
   * Publishes the world-space cursor position to `CursorPositionService`.
   * Independent of the drag classification in `onCanvasPointerDown`; the
   * drag listeners are document-level and run alongside.
   */
  onCanvasPointerMove(event: PointerEvent): void {
    const viewport = this.currentViewport;
    if (viewport === null) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const world = canvasCssToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      viewport,
      { width: rect.width, height: rect.height },
    );
    this.cursorPos.set(world);
  }

  /** Cursor left the canvas — clear the status-bar readout. */
  onCanvasPointerLeave(): void {
    this.cursorPos.set(null);
  }

  /** Esc clears selection OR cancels an in-flight drag. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dragState !== null) {
      this.cancelDrag();
      // Re-render so the preview transform reverts to the store's state.
      this.renderCurrent();
      return;
    }
    this.store.dispatch(SelectionActions.clearSelection());
  }

  // ── Drag lifecycle ────────────────────────────────────────────────────

  private startDrag(state: DragState): void {
    this.dragState = state;
    // Bind document-level handlers so a drag that leaves the canvas
    // doesn't get lost. We pass `this` via arrow wrappers; the listeners
    // are removed on end/cancel.
    const move = (e: PointerEvent): void => this.onDocumentPointerMove(e);
    const up = (e: PointerEvent): void => this.onDocumentPointerUp(e);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    this.documentMoveHandler = move;
    this.documentUpHandler = up;
    if (state.kind === 'marquee') {
      this.updateMarqueeRect(state.startCss, state.currentCss);
    }
  }

  private onDocumentPointerMove(event: PointerEvent): void {
    if (this.dragState === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const cssPoint: Vec2 = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (this.dragState.kind === 'marquee') {
      this.dragState = { ...this.dragState, currentCss: cssPoint };
      this.updateMarqueeRect(this.dragState.startCss, cssPoint);
      return;
    }
    const viewport = this.currentViewport;
    if (viewport === null) return;
    const currentWorld = canvasCssToWorld(cssPoint, viewport, {
      width: rect.width,
      height: rect.height,
    });
    this.dragState = { ...this.dragState, currentWorld };
    this.renderCurrent();
  }

  private onDocumentPointerUp(event: PointerEvent): void {
    if (this.dragState === null) return;
    const state = this.dragState;
    // Detach listeners first so a re-render that triggers a synchronous
    // pointer event doesn't recurse.
    this.detachDocumentListeners();

    if (state.kind === 'marquee') {
      this.commitMarquee(state, event);
      this.dragState = null;
      this.marqueeRect.set(null);
      this.cdr.markForCheck();
      return;
    }

    const finalTransform = this.computeFinalTransform(state);
    this.dragState = null;
    // Dispatch ONE command per gesture so undo restores the pre-drag state.
    if (state.kind === 'move') {
      this.store.dispatch(
        SceneActions.dispatchCommand({
          command: moveObject(state.objectId, finalTransform.position),
        }),
      );
    } else {
      this.store.dispatch(
        SceneActions.dispatchCommand({
          command: reshapeObject(state.objectId, finalTransform),
        }),
      );
    }
  }

  private cancelDrag(): void {
    if (this.dragState === null) return;
    this.detachDocumentListeners();
    this.dragState = null;
    this.marqueeRect.set(null);
    this.cdr.markForCheck();
  }

  private detachDocumentListeners(): void {
    if (this.documentMoveHandler !== null) {
      document.removeEventListener('pointermove', this.documentMoveHandler);
      this.documentMoveHandler = null;
    }
    if (this.documentUpHandler !== null) {
      document.removeEventListener('pointerup', this.documentUpHandler);
      this.documentUpHandler = null;
    }
  }

  /** Drag → final Transform. Pure dispatch over the drag kind. */
  private computeFinalTransform(
    state: Extract<DragState, { kind: 'move' | 'scale' | 'rotate' }>,
  ): Transform {
    const delta: Vec2 = {
      x: state.currentWorld.x - state.startWorld.x,
      y: state.currentWorld.y - state.startWorld.y,
    };
    switch (state.kind) {
      case 'move':
        return applyMoveDrag(state.originalTransform, delta);
      case 'scale':
        return applyScaleDrag({
          original: state.originalTransform,
          cursorWorld: state.currentWorld,
          startWorld: state.startWorld,
        });
      case 'rotate':
        return applyRotateDrag({
          original: state.originalTransform,
          cursorWorld: state.currentWorld,
          startWorld: state.startWorld,
        });
    }
  }

  private updateMarqueeRect(start: Vec2, current: Vec2): void {
    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    this.marqueeRect.set({ left, top, width, height });
    this.cdr.markForCheck();
  }

  private commitMarquee(
    state: Extract<DragState, { kind: 'marquee' }>,
    _event: PointerEvent,
  ): void {
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // Convert the marquee corners to world. y-flip means the canvas-top
    // corner maps to the world-MAX y, so we normalize after conversion.
    const p1 = canvasCssToWorld(state.startCss, viewport, {
      width: rect.width,
      height: rect.height,
    });
    const p2 = canvasCssToWorld(state.currentCss, viewport, {
      width: rect.width,
      height: rect.height,
    });
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    // Degenerate marquee (zero-area) → if shift held, no change; otherwise
    // clear selection (matches click-on-empty).
    if (maxX - minX < EPSILON_MM || maxY - minY < EPSILON_MM) {
      if (!state.shift) this.store.dispatch(SelectionActions.clearSelection());
      return;
    }

    const hits: ObjectId[] = [];
    for (const layer of scene.layers) {
      if (!layer.visible) continue;
      for (const obj of layer.objects) {
        if (obj.kind !== 'hardscape') continue;
        // bbox-centre-in-marquee — the standard Sketch-style criterion.
        // Centre is the object's position (pre-rotation; centring doesn't
        // change with rotation around the object's own origin).
        const cx = obj.transform.position.x;
        const cy = obj.transform.position.y;
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
          hits.push(obj.id);
        }
      }
    }

    if (state.shift) {
      // Additive: union with existing selection (already-selected stay).
      const union = Array.from(new Set([...this.currentSelection, ...hits]));
      this.store.dispatch(SelectionActions.selectByMarquee({ ids: union }));
    } else {
      this.store.dispatch(SelectionActions.selectByMarquee({ ids: hits }));
    }
  }

  // ── Drop receive (palette → canvas) ────────────────────────────────────

  private onHardscapeDropped(entry: HardscapeEntry, clientX: number, clientY: number): void {
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
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
    const world = clampToTank(
      canvasCssToWorld({ x: cssX, y: cssY }, viewport, {
        width: rect.width,
        height: rect.height,
      }),
      scene.tank,
    );
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
    this.store.dispatch(SceneActions.dispatchCommand({ command: addObject(layerId, newObject) }));
    this.store.dispatch(SelectionActions.replaceSelection({ ids: [newObject.id] }));
  }

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

  /**
   * Plant drop — F4.1 / F4.5. Same screen→world plumbing as hardscape, but
   * branches on `entry.defaultDensity`: a non-zero density turns the drop
   * into a circular **scatter patch** at the cursor (a v1 "implicit carpet
   * brush" — the polygon UI for free-hand brushing is deferred). Without a
   * density, it's a single specimen.
   *
   * The patch polygon is a 16-sided regular polygon centred on the drop,
   * radius `SCATTER_PATCH_RADIUS_MM`. Density comes from the catalog.
   */
  private onPlantDropped(entry: PlantEntry, clientX: number, clientY: number): void {
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
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
    const world = clampToTank(
      canvasCssToWorld({ x: cssX, y: cssY }, viewport, {
        width: rect.width,
        height: rect.height,
      }),
      scene.tank,
    );
    const z = scene.tank.depth / 2;
    const layerId = this.ensureLayerExists(scene);
    const id = newObjectId();

    const isCarpet = (entry.defaultDensity ?? 0) > 0;
    const baseObject: PlantObject = {
      kind: 'plant',
      id,
      ref: { catalog: entry.catalog, id: entry.id, version: entry.version },
      zone: entry.zone,
      transform: {
        ...identityTransform(),
        position: { x: world.x, y: world.y, z },
      },
      growth: { ageWeeks: 0, vigor: 1 },
    };

    const newObject: PlantObject = isCarpet
      ? {
          ...baseObject,
          scatter: {
            polygon: scatterPatchPolygon(world.x, world.y, SCATTER_PATCH_RADIUS_MM),
            density: entry.defaultDensity ?? 30,
            seed: scene.seed,
          },
        }
      : baseObject;

    this.store.dispatch(SceneActions.dispatchCommand({ command: addObject(layerId, newObject) }));
    this.store.dispatch(SelectionActions.replaceSelection({ ids: [id] }));
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

    // Build a preview scene if a transform drag is in flight. Move / scale /
    // rotate all mutate ONE object's transform; we substitute it in place
    // and leave the rest of the scene untouched. Marquee doesn't change
    // any object — the overlay is its only visual.
    const scenePassed = this.buildPreviewScene(scene);
    const previewAge = this.previewTime.previewAgeWeeks();
    this.renderer.render(
      scenePassed,
      viewport,
      coreCatalog,
      this.currentSelection,
      previewAge ?? undefined,
    );
  }

  private buildPreviewScene(scene: Scene): Scene {
    if (this.dragState === null || this.dragState.kind === 'marquee') return scene;
    const state = this.dragState;
    const preview = this.computeFinalTransform(state);
    return mapObjectTransform(scene, state.objectId, preview);
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

// ─── Pure helpers ─────────────────────────────────────────────────────────

const EPSILON_MM = 0.01;

/**
 * Default radius (mm) for the implicit carpet brush that fires when the user
 * drops a plant whose catalog entry carries `defaultDensity`. Small enough
 * to read as a "patch" at typical tank sizes (≈30 cm of substrate width);
 * the user can edit the polygon later through the inspector.
 */
const SCATTER_PATCH_RADIUS_MM = 60;
const SCATTER_PATCH_VERTICES = 16;

/**
 * Build a regular 16-sided polygon centred at `(cx, cy)` with the given
 * radius. Returned in scene-space mm; consumed by the renderer's scatter
 * path via `scatterInPolygon`.
 */
function scatterPatchPolygon(
  cx: number,
  cy: number,
  radius: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < SCATTER_PATCH_VERTICES; i++) {
    const a = (i / SCATTER_PATCH_VERTICES) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
  }
  return out;
}

/**
 * Invert the viewport's world-to-canvas projection. Mirrors the helper
 * the renderer uses for hit-test, kept inline here so the app doesn't
 * need to import a renderer-internal utility.
 */
function canvasCssToWorld(
  pointCss: Vec2,
  viewport: Viewport,
  canvas: { width: number; height: number },
): Vec2 {
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

/**
 * Clamp a world point into the tank's interior `[0, width] × [0, height]`.
 * Used at palette-drop time so a sloppy drag that releases above / below the
 * visible tank still produces a usable placement instead of an invisible
 * object floating off-screen.
 */
function clampToTank(p: Vec2, tank: { width: number; height: number }): Vec2 {
  return {
    x: Math.max(0, Math.min(tank.width, p.x)),
    y: Math.max(0, Math.min(tank.height, p.y)),
  };
}

function findObjectById(scene: Scene, id: ObjectId): SceneObject | null {
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.id === id) return obj;
    }
  }
  return null;
}

/** Return a copy of `scene` where `objectId`'s transform is replaced. */
function mapObjectTransform(scene: Scene, objectId: ObjectId, transform: Transform): Scene {
  const layers: Layer[] = scene.layers.map((layer) => {
    if (!layer.objects.some((o) => o.id === objectId)) return layer;
    return {
      ...layer,
      objects: layer.objects.map((o) =>
        o.id === objectId ? ({ ...o, transform } as SceneObject) : o,
      ),
    };
  });
  return { ...scene, layers };
}

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

// Suppress an "imported type only used in signatures" lint warning.
void ((): HitResult | undefined => undefined);
