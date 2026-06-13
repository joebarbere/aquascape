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
//   5. Receive hardscape / plant / decor drops from the palettes via their
//      drag services: convert screen → world coords, mint a new ObjectId,
//      dispatch AddObject. The first drop also creates a default
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
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { DecorEntry, HardscapeEntry, PlantEntry } from '@aquascape/domain/catalog';
import type { Transform } from '@aquascape/domain/geometry';
import {
  addLayer,
  addObject,
  asLayerId,
  asObjectId,
  identityTransform,
  moveObject,
  reshapeObject,
  type DecorObject,
  type HardscapeObject,
  type LayerId,
  type Layer,
  type ObjectId,
  type PlantObject,
  type Scene,
  type SceneObject,
} from '@aquascape/domain/scene-model';
import {
  BackdropPanelComponent,
  BackdropService,
  CompositionOverlaysComponent,
  CursorPositionService,
  DayNightControlComponent,
  DayNightService,
  EditorShellComponent,
  OverlayOptionsService,
  PreviewTimeService,
  SelectionInspectorComponent,
  SnapOptionsService,
  SnapSettingsComponent,
  StatusBarComponent,
  Orbit3DControlsComponent,
  TimeSliderComponent,
  ViewModeService,
  ViewportService,
  WallBackgroundComponent,
  WallBackgroundService,
  ZoomControlComponent,
  ZOOM_MULT_MAX,
  ZOOM_MULT_MIN,
  clampZoomMult,
  composeViewport,
  cursorToWorld,
  gridTargets,
  guideTargets,
  mergeTargets,
  objectTargets,
  panForCursorAnchor,
  snapPosition,
  toleranceCssPxToMm,
  wheelDeltaToZoomFactor,
} from '@aquascape/features/editor-shell';
import { DecorDragService, DecorationsToolComponent } from '@aquascape/features/decorations-tool';
import { HardscapeDragService, HardscapeToolComponent } from '@aquascape/features/hardscape-tool';
import { LayersPanelComponent } from '@aquascape/features/layers-panel';
import {
  EquipmentToolComponent,
  LivestockToolComponent,
} from '@aquascape/features/livestock-equipment';
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
import { NEUTRAL_DAY_NIGHT_LOOKUP } from '@aquascape/rendering/renderer-api';
import type {
  HitResult,
  RenderSurface,
  SceneRenderer,
  SnapGuides,
  Viewport,
} from '@aquascape/rendering/renderer-api';
import { SceneActions, SelectionActions, selectScene, selectSelectedIds } from '@aquascape/state';
import { Store } from '@ngrx/store';

import { resolveAppMode } from './app-mode';
import { BehaviorDebugOverlayComponent } from './behavior-debug-overlay.component';
import { BehaviorDebugService } from './behavior-debug.service';
import { attachDebugHook, detachDebugHook } from './debug-hook';
import { SimulationConsoleComponent } from './simulation/simulation-console.component';
import { SimulationControlsComponent } from './simulation/simulation-controls.component';
import { SimulationHudComponent } from './simulation/simulation-hud.component';
import { SimulationPerfService } from './simulation/simulation-perf.service';
import { SimulationUiService } from './simulation/simulation-ui.service';
import { createShowcaseScene } from './simulation/showcase-scene';
import { defaultViewport } from './default-viewport';
import { applyMoveDrag, applyRotateDrag, applyScaleDrag } from './drag-math';
import { LivestockSimulationService } from './livestock-simulation.service';
import { SCENE_RENDERER_2D, SCENE_RENDERER_3D } from './renderer.token';
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
    BackdropPanelComponent,
    BehaviorDebugOverlayComponent,
    CommonModule,
    CompositionOverlaysComponent,
    DayNightControlComponent,
    DecorationsToolComponent,
    SimulationConsoleComponent,
    SimulationControlsComponent,
    SimulationHudComponent,
    EditorShellComponent,
    EquipmentToolComponent,
    HardscapeToolComponent,
    LayersPanelComponent,
    LivestockToolComponent,
    PlantingToolComponent,
    SelectionInspectorComponent,
    Orbit3DControlsComponent,
    SnapSettingsComponent,
    StatusBarComponent,
    SubstrateToolComponent,
    TankSetupComponent,
    TimeSliderComponent,
    WallBackgroundComponent,
    ZoomControlComponent,
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
      [class.simulation-mode]="simulationMode()"
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
              [attr.title]="breakpoint() === 'phone' ? 'Close tools panel' : 'Collapse tools panel'"
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
            <aquascape-decorations-tool></aquascape-decorations-tool>
            <aquascape-planting-tool></aquascape-planting-tool>
            <aquascape-livestock-tool></aquascape-livestock-tool>
            <aquascape-equipment-tool></aquascape-equipment-tool>
            <aquascape-composition-overlays></aquascape-composition-overlays>
            <aquascape-snap-settings></aquascape-snap-settings>
            <aquascape-wall-background></aquascape-wall-background>
            <aquascape-backdrop-panel></aquascape-backdrop-panel>
            <aquascape-day-night-control></aquascape-day-night-control>
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
          <!-- Stage 10 F10.3 — two stacked canvases, ONE always hidden.
               A canvas may only have ONE context type for its lifetime
               (getContext 2d precludes any later getContext webgl and
               vice-versa, a hard browser invariant), so the 2D vs 3D
               renderer swap requires two real canvas elements. Pointer
               listeners bind to the 2D canvas only; OrbitControls inside
               Three3DRenderer owns the 3D canvas pointer events. -->
          <canvas
            #canvas2d
            class="scene-canvas"
            aria-label="Aquascape design canvas (2D)"
            role="img"
            [hidden]="viewMode.mode() !== '2d'"
            (pointerdown)="onCanvasPointerDown($event)"
            (pointermove)="onCanvasPointerMove($event)"
            (pointerleave)="onCanvasPointerLeave()"
          ></canvas>
          <canvas
            #canvas3d
            class="scene-canvas"
            aria-label="Aquascape design canvas (3D)"
            role="img"
            [hidden]="viewMode.mode() === '2d'"
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
          @if (viewMode.mode() === '2d') {
            <aquascape-selection-inspector></aquascape-selection-inspector>
          }
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
          @if (viewMode.mode() === '2d' && dragReadout(); as r) {
            <div
              class="drag-readout"
              [style.left.px]="r.cssX"
              [style.top.px]="r.cssY"
              aria-hidden="true"
            >
              {{ r.text }}
            </div>
          }
          <div class="app-status">
            <aquascape-status-bar></aquascape-status-bar>
          </div>
          <div class="app-zoom-control">
            <aquascape-zoom-control></aquascape-zoom-control>
            <aquascape-orbit-3d-controls></aquascape-orbit-3d-controls>
          </div>
          <div class="app-timeslider">
            <aquascape-time-slider></aquascape-time-slider>
          </div>
          <!-- Showcase-demo HUDs — read-only tank spec (upper-right) + the
               interactive scene controls (upper-left) + the tilde-toggled
               console (bottom-left). Only mount in simulation launch mode; all read
               the live store scene via simulationScene; visibility is driven by
               simUi (the console's hud command). -->
          @if (simulationMode()) {
            @if (simUi.controlsVisible()) {
              <aquascape-simulation-controls
                [scene]="simulationScene()"
              ></aquascape-simulation-controls>
            }
            @if (simUi.infoVisible()) {
              <aquascape-simulation-hud
                [scene]="simulationScene()"
                [metrics]="simPerf.metrics()"
                [showClock]="simUi.clockVisible()"
                [showPerf]="simUi.perfVisible()"
              ></aquascape-simulation-hud>
            }
            <aquascape-simulation-console></aquascape-simulation-console>
          }
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

      <!-- Stage 11 F11.6 Wave 4 — dev-only behavior debug overlay. Hidden in
           production builds (gated by isDevMode inside the component) AND
           hidden until the user presses Ctrl+Shift+D. Position is fixed so
           it floats above every other layer without affecting layout. -->
      <aquascape-behavior-debug-overlay></aquascape-behavior-debug-overlay>
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
      .app-zoom-control {
        position: absolute;
        right: 12px;
        bottom: 100px;
        z-index: 3;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
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
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        touch-action: none;
      }
      /* Stage 10: when stacked inside .app-canvas-host the 2D + 3D canvases
         must overlap, not flow vertically. position: absolute does that.
         AND the [hidden] UA rule loses the specificity war to .scene-canvas
         under Angular view encapsulation, so we add an explicit rule that
         wins via the !important flag. */
      .scene-canvas[hidden] {
        display: none !important;
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
      /* F5.3 — distance / position readout shown next to the cursor during
         any move / scale / rotate drag. Positioned in CSS-px relative to
         the canvas host (not viewport-fixed like the palette ghost,
         because the readout is anchored to where the drag is happening
         inside the canvas). */
      .drag-readout {
        position: absolute;
        transform: translate(12px, -28px);
        padding: 3px 8px;
        background: rgba(32, 35, 42, 0.92);
        color: #fff;
        border-radius: 10px;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
        pointer-events: none;
        z-index: 5;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        white-space: nowrap;
      }
    `,
  ],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  // Stage 10 F10.3 — two concrete renderers, one active at a time. The
  // `activeRenderer` / `activeCanvas` accessors below resolve which pair
  // is live based on `viewMode.mode()`. Both renderers stay alive (we
  // never `dispose()` the inactive one) so a swap is cheap: the only
  // per-swap work is one `attach()` on the now-active renderer.
  private readonly renderer2d = inject<SceneRenderer>(SCENE_RENDERER_2D);
  private readonly renderer3d = inject<SceneRenderer>(SCENE_RENDERER_3D);
  readonly viewMode = inject(ViewModeService);

  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(Store);
  private readonly dragService = inject(HardscapeDragService);
  private readonly plantDragService = inject(PlantDragService);
  private readonly decorDragService = inject(DecorDragService);
  private readonly previewTime = inject(PreviewTimeService);
  private readonly overlayOptions = inject(OverlayOptionsService);
  private readonly wallBackground = inject(WallBackgroundService);
  private readonly snapOptions = inject(SnapOptionsService);
  private readonly backdropService = inject(BackdropService);
  private readonly viewportState = inject(ViewportService);
  private readonly cursorPos = inject(CursorPositionService);
  private readonly cdr = inject(ChangeDetectorRef);
  // Stage 11 F11.1 Wave 4 — owns the bitECS world for animated fish in
  // the 3D view. The service persists across 2D↔3D toggles; the renderer
  // just reads its `getWorld()` each render and steps it in the RAF tick.
  private readonly livestockSim = inject(LivestockSimulationService);
  // Stage 11 F11.6 Wave 4 — toggle flag for the behavior debug overlay.
  // Flipped by the Ctrl+Shift+D HostListener below. The overlay component
  // reads `enabled()` itself; the AppComponent just owns the chord.
  private readonly behaviorDebug = inject(BehaviorDebugService);
  // Stage 11 F11.7 Wave 3 — day-night cycle lookup the 3D renderer reads
  // per render. The service holds the phase + mode signals (the Wave 5 UI
  // mutates them); we just forward the computed `lookup()` value into
  // `RenderOptions.dayNightLookup` on each 3D render call. The 2D render
  // call deliberately omits the field — day-night is 3D-only in v1.
  //
  // REAL-TIME MODE WIRING DEFERRED. `DayNightService.tick(dt)` advances
  // phase in real-time mode, but apps/web doesn't currently own a RAF
  // loop (every render is event-driven off store + signal effects), and
  // the renderer-3d's RAF can't import from apps/web without breaking
  // the layer boundary. Manual + equipment modes work today via
  // `setPhase`. A follow-up wave can add a tick driver — likely by
  // surfacing the renderer's RAF onto a host-side `addAnimationListener`
  // (similar to the existing `addChangeListener`) so apps/web can call
  // `dayNight.tick(dt)` from there without the renderer learning about
  // the day-night service.
  private readonly dayNight = inject(DayNightService);

  private readonly fileService: FileService = inject(FILE_SERVICE);
  private readonly dialogService: DialogService = inject(DIALOG_SERVICE);
  private readonly storageService: StorageService = inject(STORAGE_SERVICE);
  private readonly renderExportService: RenderExportService = inject(RENDER_EXPORT_SERVICE);

  @ViewChild('canvas2d', { static: true })
  private canvas2dRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvas3d', { static: true })
  private canvas3dRef!: ElementRef<HTMLCanvasElement>;

  /** The renderer currently driving paints. Recomputed per call so a
   *  view-mode flip immediately picks up the right instance. Every
   *  non-'2d' mode ('3d' + 'fish-eye') uses the 3D renderer — fish-eye
   *  is a camera mode on the same renderer, not a third renderer. */
  private get activeRenderer(): SceneRenderer {
    return this.viewMode.mode() !== '2d' ? this.renderer3d : this.renderer2d;
  }

  /** The canvas the active renderer paints into. */
  private get activeCanvas(): HTMLCanvasElement {
    return this.viewMode.mode() !== '2d'
      ? this.canvas3dRef.nativeElement
      : this.canvas2dRef.nativeElement;
  }

  /**
   * The 2D canvas — pointer interactions (drag, marquee, hit-test, resize-
   * observer measurement) ONLY happen on this canvas. The 3D canvas is
   * owned by OrbitControls inside Three3DRenderer; we never bind app-
   * component listeners to it.
   */
  private get canvas2d(): HTMLCanvasElement {
    return this.canvas2dRef.nativeElement;
  }

  private currentScene: Scene | null = null;
  private currentSelection: readonly ObjectId[] = [];
  private currentViewport: Viewport | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private wheelZoomCleanup: (() => void) | null = null;
  /**
   * Per-renderer attach state. Each renderer holds its own GL / 2D context
   * once attached; we only re-attach when the surface dimensions or DPR
   * change (the existing code calls `attach` every render — that's a
   * cheap no-op for both renderers as long as the surface is the same).
   */
  private attached2d = false;
  private attached3d = false;

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
   * F5.3 — drag readout. Set during a move / scale / rotate drag to a
   * `{text, cssX, cssY}` triple that the template renders as a small pill
   * floating near the cursor. Cleared on drag end / cancel.
   */
  readonly dragReadout = signal<{ text: string; cssX: number; cssY: number } | null>(null);

  /**
   * F5.4 — currently engaged snap-alignment lines in world-mm. Passed as
   * the 8th render() arg so the renderer paints the bright magenta lines
   * indicating active snaps. Cleared on drag end / cancel.
   */
  private currentSnapGuides: SnapGuides | null = null;

  /**
   * Drag-ghost label + viewport coords for the cursor follower shown while a
   * palette tile is being dragged toward the canvas. Computed from whichever
   * drag service is currently active (hardscape, plant OR decor). Returns
   * null when idle so the template hides the overlay.
   */
  readonly paletteDragGhost = computed<{ x: number; y: number; label: string } | null>(() => {
    const hard = this.dragService.active();
    if (hard !== null) return { x: hard.clientX, y: hard.clientY, label: hard.entry.name };
    const plant = this.plantDragService.active();
    if (plant !== null) return { x: plant.clientX, y: plant.clientY, label: plant.entry.name };
    const decor = this.decorDragService.active();
    if (decor !== null) return { x: decor.clientX, y: decor.clientY, label: decor.entry.name };
    return null;
  });

  /** Signal that flips to true when the scene has no objects in any layer. */
  readonly sceneIsEmpty = signal<boolean>(true);

  /**
   * Showcase-demo state. `simulationMode` gates the `.simulation-mode` chrome-hiding
   * class + the HUD; `simulationScene` is the (static) scene the HUD describes.
   * Both stay false/null in the normal editor. Set once in `ngOnInit` when
   * `resolveAppMode()` reports `'simulation'`. See `docs/caveats/app-modes.md`.
   */
  readonly simulationMode = signal<boolean>(false);
  readonly simulationScene = signal<Scene | null>(null);

  /** Live performance sampler feeding the HUD's metrics strip (simulation only). */
  readonly simPerf = inject(SimulationPerfService);

  /** Simulation HUD/console visibility state (the console's `hud` command + `~`). */
  readonly simUi = inject(SimulationUiService);

  /** Unsubscribe thunk for the desktop "Mode" menu push channel (Electron only). */
  private modeMenuCleanup: (() => void) | null = null;

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

  ngOnInit(): void {
    // Stage 11 follow-up — wire the read-only Playwright introspection
    // hook on `window.__aquascape_debug__`. No-op in production (the
    // function early-returns when `isDevMode()` is false), so this is
    // safe in every build configuration. See `./debug-hook.ts`.
    attachDebugHook({
      store: this.store,
      livestockSim: this.livestockSim,
      viewMode: this.viewMode,
    });

    this.maybeActivateSimulationMode();
    this.subscribeToModeMenu();
  }

  /**
   * Activate the showcase at launch (`aquascape --mode simulation` / `?mode=simulation`).
   * No-op for a normal launch.
   *
   * Run here in `ngOnInit` — before `ngAfterViewInit` wires the store
   * subscription — so the scene is in the store and the mode is pinned to
   * `'3d'` by the time the first render fires; the subscription then paints
   * the populated scene straight into the 3D canvas.
   */
  private maybeActivateSimulationMode(): void {
    if (resolveAppMode() !== 'simulation') return;
    this.enterSimulationMode();
  }

  /**
   * Subscribe to runtime mode switches pushed from the desktop "Mode" menu
   * (Electron only; the bridge's `onSetMode` is absent in a browser). The
   * callback fires outside Angular's zone, so we re-enter via `ngZone.run`
   * to schedule change detection for the chrome-hiding class + HUD.
   */
  private subscribeToModeMenu(): void {
    const onSetMode =
      typeof window !== 'undefined' ? (window as Window).aquascape?.onSetMode : undefined;
    if (onSetMode === undefined) return;
    this.modeMenuCleanup = onSetMode((mode) => {
      this.ngZone.run(() => this.applyMode(mode));
    });
  }

  /** Apply a mode chosen at runtime: enter the showcase, or return to editing. */
  private applyMode(mode: 'normal' | 'simulation'): void {
    if (mode === 'simulation') {
      this.enterSimulationMode();
    } else {
      this.leaveSimulationToEditor();
    }
  }

  /**
   * Load the showcase scene, force the 3D view (winning the
   * persisted-preference hydration race via `forceMode`), and flip the
   * `simulationMode` signal so the template hides the editor chrome and mounts the
   * corner HUD. Idempotent.
   */
  private enterSimulationMode(): void {
    if (this.simulationMode()) return;
    const scene = createShowcaseScene();
    this.simulationScene.set(scene);
    this.simulationMode.set(true);
    this.simUi.resetLayout();
    this.viewMode.forceMode('3d');
    this.store.dispatch(SceneActions.setScene({ scene }));
    this.simPerf.start();
  }

  /**
   * Leave the showcase back to the editor: drop the chrome-hiding `.simulation-mode`
   * class + the HUD. The loaded scene stays in the store, so the user lands in
   * the editor looking at the tank they were just shown. Idempotent.
   */
  private leaveSimulationToEditor(): void {
    if (!this.simulationMode()) return;
    this.simulationMode.set(false);
    this.simulationScene.set(null);
    this.simPerf.stop();
  }

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
      this.installWheelZoomListener();
      combineLatest([this.store.select(selectScene), this.store.select(selectSelectedIds)])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([scene, ids]) => {
          this.currentScene = scene;
          this.currentSelection = ids;
          this.sceneIsEmpty.set(
            scene === null || scene.layers.every((l) => l.objects.length === 0),
          );
          // Keep the simulation HUDs bound to the LIVE scene so edits made through
          // the control HUD show up in the spec HUD + drive the 3D + sim. This
          // subscription runs outside Angular's zone (for the imperative
          // render), so re-enter for the signal write that the OnPush HUDs read.
          if (this.simulationMode()) {
            this.ngZone.run(() => this.simulationScene.set(scene));
          }
          this.renderCurrent();
        });

      this.dragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onHardscapeDropped(evt.entry, evt.clientX, evt.clientY));

      this.plantDragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onPlantDropped(evt.entry, evt.clientX, evt.clientY));

      this.decorDragService.dropped$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((evt) => this.onDecorDropped(evt.entry, evt.clientX, evt.clientY));
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

  // F5.3 — re-render when any composition-overlay flag flips so the user
  // sees the guide appear/disappear immediately on toggle. Same pattern as
  // `previewTimeEffect` above: skip the synchronous first invocation (no
  // scene yet — the combineLatest below fires the initial render), then
  // call `renderCurrent()` for any subsequent change.
  private overlayOptionsFirstRun = true;
  private readonly overlayOptionsEffect = effect(() => {
    // Read the signal so Angular tracks the dependency.
    void this.overlayOptions.overlays();
    if (this.overlayOptionsFirstRun) {
      this.overlayOptionsFirstRun = false;
      return;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  // Stage 5.x — re-render when the user adjusts zoom or pan (via the
  // floating ZoomControl or Cmd/Ctrl+wheel on the canvas). Same first-run
  // guard pattern as the overlay + preview-time effects.
  private viewportStateFirstRun = true;
  private readonly viewportStateEffect = effect(() => {
    void this.viewportState.userZoomMult();
    void this.viewportState.userPan();
    if (this.viewportStateFirstRun) {
      this.viewportStateFirstRun = false;
      return;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  // Stage 5.x — re-render when any wall-background field flips so the
  // user sees the wall appear / change colour / resize immediately.
  // Mirrors the overlay + zoom effects.
  private wallBackgroundFirstRun = true;
  private readonly wallBackgroundEffect = effect(() => {
    void this.wallBackground.wall();
    if (this.wallBackgroundFirstRun) {
      this.wallBackgroundFirstRun = false;
      return;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  // Stage 6 F6.3 — re-render when the backdrop photo is enabled /
  // imported / cleared / has its opacity changed. Same first-run guard
  // pattern; the backdrop service's `backdrop` computed flips to null
  // when disabled or when no image is loaded, so the renderer no-ops in
  // those cases.
  private backdropFirstRun = true;
  private readonly backdropEffect = effect(() => {
    void this.backdropService.backdrop();
    if (this.backdropFirstRun) {
      this.backdropFirstRun = false;
      return;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  // Stage 11 F11.7 Wave 3 — re-render when the day-night lookup changes
  // so the user sees the cycle's tint / intensity shift as they scrub the
  // phase slider (Wave 5 UI) or as equipment-mode schedules tick. Same
  // first-run-guard pattern as the rest of this file. The 2D render path
  // omits the lookup, so a phase change in 2D mode produces a redundant
  // (but harmless) re-render — cheap, and the alternative ("only fire
  // when in 3D") would miss a phase change that landed during a brief
  // 2D-mode visit, leaving stale ambient on the next 3D view.
  private dayNightFirstRun = true;
  private readonly dayNightEffect = effect(() => {
    void this.dayNight.lookup();
    if (this.dayNightFirstRun) {
      this.dayNightFirstRun = false;
      return;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  // Stage 10 F10.3 — when the user flips 2D ↔ 3D, dispose the previously-
  // active renderer (so it releases its GL / 2D context) and trigger a
  // re-render against the now-active renderer + canvas. Both renderers
  // are `providedIn: 'root'`; the dispose-then-reattach cycle resets
  // their internal state via `attach()`, so swapping back later works
  // (e.g. 2D → 3D → 2D paints a clean 2D canvas).
  //
  // First-run guard: same pattern as every other view-state effect — the
  // initial dependency-registering pass would otherwise dispose-then-
  // attach the 2D renderer redundantly on cold boot before the store's
  // first emission triggers the genuine first render.
  private viewModeFirstRun = true;
  private readonly viewModeEffect = effect(() => {
    const mode = this.viewMode.mode();
    if (this.viewModeFirstRun) {
      this.viewModeFirstRun = false;
      return;
    }
    // Dispose the renderer that was active BEFORE this swap. '3d' and
    // 'fish-eye' share the 3D renderer + canvas, so a flip between those
    // two disposes NOTHING — only crossing the 2D ↔ 3D-family boundary
    // tears a renderer down (the attached flags make the no-op case safe).
    const is3dFamily = mode !== '2d';
    if (is3dFamily && this.attached2d) {
      this.renderer2d.dispose();
      this.attached2d = false;
    } else if (!is3dFamily && this.attached3d) {
      this.renderer3d.dispose();
      this.attached3d = false;
    }
    if (this.currentScene !== null) {
      this.renderCurrent();
    }
  });

  ngOnDestroy(): void {
    // Clear the Playwright debug hook BEFORE we tear down the services
    // it references — otherwise a stray e2e probe between destroy + the
    // next bootstrap would call into a disposed renderer / world.
    detachDebugHook();
    this.modeMenuCleanup?.();
    this.modeMenuCleanup = null;
    this.simPerf.stop();
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
      (this.canvas2d.ownerDocument?.querySelector('aquascape-root') as HTMLElement | null) ?? null;
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
      (this.canvas2d.ownerDocument?.querySelector('aquascape-root') as HTMLElement | null) ?? null;
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

    const canvas = this.canvas2d;
    const rect = canvas.getBoundingClientRect();
    const cssPoint: Vec2 = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const previewAge = this.previewTime.previewAgeWeeks();
    // Hit-test always goes through the 2D renderer. The 3D canvas is
    // `[hidden]` in 3D mode (its pointer events don't fire), and even if
    // a stray event reached this handler, Three3DRenderer.hitTest returns
    // null — there's no scene-model interaction in 3D for v1.
    const hit = this.renderer2d.hitTest(cssPoint, scene, viewport, {
      catalog: coreCatalog,
      selection: this.currentSelection,
      ...(previewAge !== null ? { previewAgeWeeks: previewAge } : {}),
    });

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
    const rect = this.canvas2d.getBoundingClientRect();
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

  /**
   * Quake-style console toggle. The `~`/backtick key (physical `Backquote`,
   * layout-independent) opens/closes the simulation console. Handled here (not in
   * the console component) so it works while the console is closed, and
   * `preventDefault`ed so the key never types a backtick into the field.
   * Simulation-mode only.
   */
  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (event.code === 'Backquote' && this.simulationMode()) {
      event.preventDefault();
      this.simUi.toggleConsole();
    }
  }

  /** Esc closes the console, else exits the simulation, else clears selection / drag. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    // In the showcase, Esc first closes the console if it's open, otherwise
    // it leaves the simulation — both dominate over selection/drag (which don't
    // exist in simulation mode).
    if (this.simulationMode() && this.simUi.consoleOpen()) {
      this.simUi.closeConsole();
      return;
    }
    if (this.simulationMode()) {
      this.exitSimulationMode();
      return;
    }
    if (this.dragState !== null) {
      this.cancelDrag();
      // Re-render so the preview transform reverts to the store's state.
      this.renderCurrent();
      return;
    }
    this.store.dispatch(SelectionActions.clearSelection());
  }

  /**
   * Handle Esc while in the showcase:
   *
   *   - **Desktop (Electron):** the MAIN process owns Esc entirely (see
   *     `apps/desktop/src/main/main.ts`) — it quits a `--mode simulation` kiosk or
   *     switches a menu-entered simulation back to the editor (pushing `'normal'`
   *     back through `onSetMode`). The renderer must NOT touch the view here,
   *     or it would race / flash against the main-driven outcome. We detect
   *     Electron via the preload bridge and bail.
   *   - **Browser tab:** a page can't force-close a tab the user navigated
   *     to, so we try `window.close()` (works for script-opened / kiosk
   *     windows) and, when the browser refuses, fall back to revealing the
   *     editor so the user isn't trapped in the chrome-free view.
   */
  private exitSimulationMode(): void {
    if (!this.simulationMode()) return;

    const isElectron = typeof window !== 'undefined' && (window as Window).aquascape !== undefined;
    if (isElectron) return; // main process owns Esc (quit or switch-to-normal)

    try {
      window.close();
    } catch {
      /* browsers throw or no-op for non-script-opened windows — ignore */
    }
    // Fallback for browsers that ignored window.close(): reveal the editor.
    this.leaveSimulationToEditor();
  }

  /**
   * Stage 11 F11.6 Wave 4 — dev-only Ctrl+Shift+D chord toggles the
   * behavior-debug overlay. The chord covers both Windows/Linux (Ctrl)
   * and macOS (Cmd via the `meta.shift.d` alias) so a contributor on
   * either platform can flip it without reloading. The overlay component
   * itself gates on `isDevMode()` so the chord in a production build
   * just flips an invisible flag — no DOM impact, no leak risk.
   *
   * Caveat: we don't preventDefault() the chord on the keyboard event;
   * if a future browser claims `Ctrl+Shift+D` for a built-in (e.g.
   * Firefox's bookmark-bar toggle), the chord will still fire here AND
   * trigger the browser default. That's acceptable for a dev-only
   * affordance — the trade-off would be intercepting a keystroke the
   * user might want delivered to the browser.
   */
  @HostListener('document:keydown.control.shift.d', ['$event'])
  @HostListener('document:keydown.meta.shift.d', ['$event'])
  onToggleBehaviorDebug(event: KeyboardEvent): void {
    // Ignore the chord while the user is typing in a text field — same
    // policy as the selection-inspector shortcuts (see app-shell caveat).
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    event.preventDefault();
    this.behaviorDebug.toggle();
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
    const canvas = this.canvas2d;
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

    // F5.4 — apply snap to the FINAL transform too so the dispatched
    // command lands at the snapped position, not the raw cursor position.
    // The preview the user saw + the persisted state must match.
    const previewBase = this.computeFinalTransform(state);
    const scene = this.currentScene;
    const finalTransform =
      scene === null ? previewBase : this.applySnapToPreview(scene, state, previewBase).transform;

    this.dragState = null;
    // F5.3 / F5.4 — clear visual drag affordances now that the gesture
    // has resolved. The store will fire `selectScene` and renderCurrent
    // will paint without snap guides + without the readout.
    this.dragReadout.set(null);
    this.currentSnapGuides = null;

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
    // F5.3 / F5.4 — clear the readout + snap guides so they don't linger
    // past the drag they belong to.
    this.dragReadout.set(null);
    this.currentSnapGuides = null;
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
    const canvas = this.canvas2d;
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
        // Hardscape + decor participate in marquee selection (both are
        // free-standing scape furniture); plants stay excluded (their
        // visual centre is the scatter patch, not the transform origin).
        if (obj.kind !== 'hardscape' && obj.kind !== 'decor') continue;
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
    const canvas = this.canvas2d;
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

  /**
   * Decor drop — same screen→world plumbing as hardscape (decorations are
   * scape furniture: clamp-to-tank, substrate-relative mid-depth z, one
   * AddObject command + select-the-new-object). `DecorObject` carries no
   * `category` field — the catalog row owns categorisation; the scene
   * object is just a `CatalogRef` + transform.
   */
  private onDecorDropped(entry: DecorEntry, clientX: number, clientY: number): void {
    const scene = this.currentScene;
    const viewport = this.currentViewport;
    if (scene === null || viewport === null) return;
    const canvas = this.canvas2d;
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
    const newObject: DecorObject = {
      kind: 'decor',
      id: newObjectId(),
      ref: { catalog: entry.catalog, id: entry.id, version: entry.version },
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
    const canvas = this.canvas2d;
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
    // Stage 10 F10.3 — paint via the renderer the user picked. The 2D
    // canvas is always the one we read for viewport math (drag / hit-test
    // / resize-observer live there); the 3D canvas mirrors its layout via
    // the `[hidden]`-stacked CSS so both have identical CSS-pixel dims.
    const canvas = this.activeCanvas;
    const surface = this.buildSurface(canvas);
    const renderer = this.activeRenderer;
    const mode = this.viewMode.mode();
    const is3d = mode !== '2d';
    if (is3d) {
      renderer.attach(surface);
      this.attached3d = true;
    } else {
      renderer.attach(surface);
      this.attached2d = true;
    }
    const viewport = this.computeViewport(surface, scene);
    this.currentViewport = viewport;

    // Build a preview scene if a transform drag is in flight. Move / scale /
    // rotate all mutate ONE object's transform; we substitute it in place
    // and leave the rest of the scene untouched. Marquee doesn't change
    // any object — the overlay is its only visual.
    //
    // In 3D mode no drag is possible (pointer events don't fire on the 3D
    // canvas) so `buildPreviewScene` no-ops back to the unchanged scene.
    const scenePassed = this.buildPreviewScene(scene);
    const previewAge = this.previewTime.previewAgeWeeks();
    const backdrop = this.backdropService.backdrop();
    // exactOptionalPropertyTypes: only spread the nullable fields when
    // they actually have a value. Assigning `undefined` to an optional
    // field is a TS error under that flag.
    //
    // Three3DRenderer ignores `Viewport` + most `RenderOptions` fields
    // (it owns its OrbitControls camera + has no overlay / wall / snap
    // concept yet); passing them is safe. The renderer picks what it
    // wants from the options bag.
    // Stage 11 F11.1 Wave 4 — only wire the livestock world into the 3D
    // renderer (the 2D renderer ignores the field, but skipping it on
    // 2D keeps the options bag minimal in the common case). The
    // service returns `null` when the scene has no livestock; the
    // renderer's spread-skip below means the field is absent rather
    // than set to undefined.
    const livestockWorld = is3d ? this.livestockSim.getWorld() : null;
    // Stage 11 F11.7 Wave 3 / flicker fix — forward the day-night lookup in
    // 3D, and NEVER omit it on a 3D render. The 2D renderer ignores it
    // (day-night is 3D-only in v1), but on 3D the renderer single-sources its
    // lighting from this value every frame: if the host dropped the field on
    // some interaction frames, the renderer would alternate between the cycle
    // and its neutral defaults and the user would see a brightness flicker
    // while orbiting. So in 3D we always pass an explicit lookup, falling back
    // to `NEUTRAL_DAY_NIGHT_LOOKUP` if the service ever yields null.
    const dayNightLookup = is3d
      ? (this.dayNight.lookup() ?? NEUTRAL_DAY_NIGHT_LOOKUP)
      : null;
    // Fidelity pass — forward the baked tank flow field in 3D so the renderer
    // can couple plant sway to the current. Null when no filter/pump
    // equipment is present (the renderer falls back to constant sway).
    const flowField = is3d ? this.livestockSim.getFlowField() : null;
    renderer.render(scenePassed, viewport, {
      catalog: coreCatalog,
      selection: this.currentSelection,
      overlayOptions: this.overlayOptions.overlays(),
      wallBackground: this.wallBackground.wall(),
      ...(previewAge !== null ? { previewAgeWeeks: previewAge } : {}),
      ...(this.currentSnapGuides !== null ? { snapGuides: this.currentSnapGuides } : {}),
      ...(backdrop !== null ? { backdropImage: backdrop } : {}),
      ...(livestockWorld !== null ? { livestockWorld } : {}),
      ...(dayNightLookup !== null ? { dayNightLookup } : {}),
      ...(flowField !== null ? { flowField } : {}),
      // Bucket 2 — catalog texture pack base URL, 3D-only (the 2D renderer
      // ignores it; omitting on 2D keeps the options bag minimal, same
      // pattern as livestockWorld / dayNightLookup above). The pack is the
      // static-asset copy of `libs/domain/catalog/assets/textures` — see
      // the asset glob in apps/web/project.json.
      ...(is3d ? { catalogTextureBaseUrl: CATALOG_TEXTURE_BASE_URL } : {}),
      // Decorations — catalog model pack base URL, 3D-only (same opt-in
      // contract as catalogTextureBaseUrl above). The pack is the static-
      // asset copy of `libs/domain/catalog/assets/models` — see the asset
      // glob in apps/web/project.json. Omitted ⇒ the 3D renderer falls
      // back to the extruded-silhouette placeholder for decor objects.
      ...(is3d ? { catalogModelBaseUrl: CATALOG_MODEL_BASE_URL } : {}),
      // Fish-eye view — camera mode for the 3D renderer. 'fish-eye' parks
      // the camera at a live fish's eye; plain '3d' stays on OrbitControls.
      // Omitted on 2D renders (no camera in 2D).
      ...(is3d
        ? { cameraMode: mode === 'fish-eye' ? ('fish-eye' as const) : ('orbit' as const) }
        : {}),
    });
  }

  private buildPreviewScene(scene: Scene): Scene {
    if (this.dragState === null || this.dragState.kind === 'marquee') {
      // No object-drag in flight → no snap guides + no readout. Both are
      // already cleared by onDocumentPointerUp / cancelDrag; we
      // deliberately do NOT touch them here so we never write to a signal
      // inside the render path.
      return scene;
    }
    const state = this.dragState;
    const previewBase = this.computeFinalTransform(state);
    const { transform: preview, guides } = this.applySnapToPreview(scene, state, previewBase);
    this.currentSnapGuides = guides;
    this.updateDragReadout(state, preview);
    return mapObjectTransform(scene, state.objectId, preview);
  }

  /**
   * F5.4 — snap math for the in-flight move drag. The renderer paints a
   * bright magenta alignment line for each engaged target via the 8th
   * `snapGuides` render() arg. Scale + rotate drags pass through
   * untouched (snap for those gestures is a follow-up; the rotation
   * snap-to-15° increments idea is its own design call).
   */
  private applySnapToPreview(
    scene: Scene,
    state: DragState,
    previewBase: Transform,
  ): { transform: Transform; guides: SnapGuides | null } {
    if (state.kind !== 'move') return { transform: previewBase, guides: null };
    const opts = this.snapOptions.options();
    if (!opts.enabled || (!opts.toGrid && !opts.toGuides && !opts.toObjects)) {
      return { transform: previewBase, guides: null };
    }
    const viewport = this.currentViewport;
    if (viewport === null) return { transform: previewBase, guides: null };
    const toleranceMm = toleranceCssPxToMm(opts.toleranceCssPx, viewport.zoom);
    if (toleranceMm <= 0) return { transform: previewBase, guides: null };

    const targetGroups = [
      opts.toGrid ? gridTargets(scene.tank.width, scene.tank.height, opts.gridSizeMm) : null,
      opts.toGuides ? guideTargets(scene.tank.width, scene.tank.height) : null,
      opts.toObjects ? objectTargets(scene, state.objectId) : null,
    ].filter((g): g is { xs: ReadonlyArray<number>; ys: ReadonlyArray<number> } => g !== null);
    if (targetGroups.length === 0) return { transform: previewBase, guides: null };
    const targets = mergeTargets(...targetGroups);

    const snapped = snapPosition(
      { x: previewBase.position.x, y: previewBase.position.y },
      targets,
      toleranceMm,
    );

    const transform: Transform = {
      ...previewBase,
      position: { ...previewBase.position, x: snapped.position.x, y: snapped.position.y },
    };
    const guides: SnapGuides = {
      xs: snapped.snappedX === null ? [] : [snapped.snappedX],
      ys: snapped.snappedY === null ? [] : [snapped.snappedY],
    };
    return { transform, guides };
  }

  /**
   * F5.3 — drag readout. Set the small floating pill near the cursor to
   * a kind-appropriate text. Position is the cursor's CSS coords inside
   * the canvas host (computed from the drag state's `currentWorld` via
   * the inverse viewport transform).
   */
  private updateDragReadout(state: DragState, finalTransform: Transform): void {
    if (state.kind === 'marquee') {
      this.dragReadout.set(null);
      return;
    }
    const viewport = this.currentViewport;
    const canvas = this.canvas2d;
    if (viewport === null) {
      this.dragReadout.set(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    // Inverse of cursorToWorld used in zoom-math: cursorCssX =
    // (worldX - center.x) * zoom + canvasW/2; y axis is flipped (canvas
    // +y down vs world +y up).
    const cssX = (state.currentWorld.x - viewport.center.x) * viewport.zoom + rect.width / 2;
    const cssY = -(state.currentWorld.y - viewport.center.y) * viewport.zoom + rect.height / 2;

    let text: string;
    if (state.kind === 'move') {
      text = `${Math.round(finalTransform.position.x)}, ${Math.round(finalTransform.position.y)} mm`;
    } else if (state.kind === 'scale') {
      const sx = finalTransform.scale.x;
      const sy = finalTransform.scale.y;
      text = `${(sx * 100).toFixed(0)}% × ${(sy * 100).toFixed(0)}%`;
    } else {
      // rotate
      const degrees = (finalTransform.rotation.z * 180) / Math.PI;
      text = `${degrees.toFixed(0)}°`;
    }
    this.dragReadout.set({ text, cssX, cssY });
  }

  private installResizeObserver(): void {
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof Observer !== 'function') return;

    const observer = new Observer(() => {
      this.renderCurrent();
    });
    observer.observe(this.canvas2d);
    this.resizeObserver = observer;
    this.destroyRef.onDestroy(() => this.teardown());
  }

  private teardown(): void {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.wheelZoomCleanup !== null) {
      this.wheelZoomCleanup();
      this.wheelZoomCleanup = null;
    }
    // Stage 10 F10.3 — dispose both renderers we ever attached. The
    // unused renderer never had `attach()` called so its `dispose()` is
    // safe-but-redundant; we track the flags so a future renderer with
    // a stricter dispose contract doesn't blow up here.
    if (this.attached2d) {
      this.renderer2d.dispose();
      this.attached2d = false;
    }
    if (this.attached3d) {
      this.renderer3d.dispose();
      this.attached3d = false;
    }
  }

  /**
   * Cursor-anchored zoom on Cmd/Ctrl + wheel over the canvas. Bound as a
   * non-passive listener so `preventDefault()` actually stops the page
   * from scrolling. WITHOUT the modifier the listener is a no-op — the
   * user's normal page-scroll gesture is preserved.
   *
   * The wheel handler reads the live scene/viewport state, computes the
   * world point under the cursor, applies a multiplicative zoom factor
   * derived from `deltaY`, then computes the pan that keeps that world
   * point under the cursor — all via the pure helpers in `zoom-math.ts`.
   */
  private installWheelZoomListener(): void {
    const canvas = this.canvas2d;
    const handler = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return; // honour page scroll
      const scene = this.currentScene;
      if (scene === null) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const def = defaultViewport(
        { width: rect.width, height: rect.height },
        { width: scene.tank.width, height: scene.tank.height },
      );
      const currentMult = this.viewportState.userZoomMult() ?? 1;
      const currentPan = this.viewportState.userPan();
      const currentViewport = composeViewport(def, currentMult, currentPan);
      const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const worldAtCursor = cursorToWorld(cursor, currentViewport, {
        width: rect.width,
        height: rect.height,
      });

      const factor = wheelDeltaToZoomFactor(event.deltaY);
      const newMult = clampZoomMult(currentMult * factor);
      // No change at the clamp ceiling/floor — skip the pan update so the
      // cursor anchor doesn't drift on a no-op zoom.
      if (
        newMult === currentMult &&
        (currentMult === ZOOM_MULT_MAX || currentMult === ZOOM_MULT_MIN)
      ) {
        return;
      }
      const effectiveZoom = def.zoom * newMult;
      const newPan = panForCursorAnchor(
        cursor,
        worldAtCursor,
        { width: rect.width, height: rect.height },
        effectiveZoom,
        def.center,
      );
      // Run state changes inside Angular zone so the effect fires + the
      // OnPush component renders.
      this.ngZone.run(() => this.viewportState.setZoomAndPan(newMult, newPan));
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    this.wheelZoomCleanup = (): void => canvas.removeEventListener('wheel', handler);
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
    const def = defaultViewport(
      { width: surface.width, height: surface.height },
      { width: scene.tank.width, height: scene.tank.height },
    );
    return composeViewport(def, this.viewportState.userZoomMult(), this.viewportState.userPan());
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

const EPSILON_MM = 0.01;

/**
 * Bucket 2 — where the dev server / production build serves the catalog
 * texture pack (the asset glob in `apps/web/project.json` copies
 * `libs/domain/catalog/assets/textures` here). Relative (no leading slash)
 * so it resolves under any deploy base href; trailing slash because the
 * 3D renderer concatenates `baseUrl + ref` verbatim.
 */
const CATALOG_TEXTURE_BASE_URL = 'assets/catalog-textures/';

/**
 * Decorations — where the dev server / production build serves the catalog
 * model pack (the asset glob in `apps/web/project.json` copies
 * `libs/domain/catalog/assets/models` here). Same conventions as
 * CATALOG_TEXTURE_BASE_URL: relative (no leading slash) so it resolves
 * under any deploy base href; trailing slash because the 3D renderer
 * concatenates `baseUrl + ref` verbatim.
 */
const CATALOG_MODEL_BASE_URL = 'assets/catalog-models/';

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
