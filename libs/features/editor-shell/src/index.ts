// Public API for @aquascape/features/editor-shell. F1.4.
//
// Standalone Angular feature lib hosting the top toolbar (New / Open / Save /
// Save As / Recent), keyboard shortcuts, the F1.5 crash-recovery prompt,
// the Stage 4 time-slider, and the v1-polish theme toggle.
// Composed into apps/web as the page header above the canvas.

export { EditorShellComponent } from './lib/editor-shell.component';
export { SelectionInspectorComponent } from './lib/selection-inspector.component';
export { TimeSliderComponent } from './lib/time-slider.component';
export { PreviewTimeService } from './lib/preview-time.service';
export { ThemeToggleComponent } from './lib/theme-toggle.component';
export { ThemeService, STORAGE_KEY_THEME, type ThemePreference } from './lib/theme.service';
export { StatusBarComponent } from './lib/status-bar.component';
export {
  CursorPositionService,
  type CursorWorldPosition,
} from './lib/cursor-position.service';
export {
  CompositionOverlaysComponent,
  COMPOSITION_OVERLAYS_COLLAPSED_KEY,
} from './lib/composition-overlays.component';
export {
  OverlayOptionsService,
  STORAGE_KEY_OVERLAY_GOLDEN,
  STORAGE_KEY_OVERLAY_THIRDS,
  STORAGE_KEY_OVERLAY_FOCAL,
} from './lib/overlay-options.service';
export { ViewportService } from './lib/viewport.service';
export { ZoomControlComponent } from './lib/zoom-control.component';
export { Orbit3DService } from './lib/orbit-3d.service';
export { Orbit3DControlsComponent } from './lib/orbit-3d-controls.component';
export {
  ORBITAL_3D_CONTROLS,
  type Orbital3DControls,
} from './lib/orbital-3d-controls.token';
export {
  WallBackgroundComponent,
  WALL_BACKGROUND_COLLAPSED_KEY,
} from './lib/wall-background.component';
export {
  WallBackgroundService,
  DEFAULT_WALL_COLOR,
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_WIDTH_MM,
  MAX_WALL_DIM_MM,
  MIN_WALL_DIM_MM,
  STORAGE_KEY_WALL_COLOR,
  STORAGE_KEY_WALL_ENABLED,
  STORAGE_KEY_WALL_HEIGHT_MM,
  STORAGE_KEY_WALL_WIDTH_MM,
} from './lib/wall-background.service';
export {
  SnapSettingsComponent,
  SNAP_SETTINGS_COLLAPSED_KEY,
} from './lib/snap-settings.component';
export {
  SnapOptionsService,
  STORAGE_KEY_SNAP_ENABLED,
  STORAGE_KEY_SNAP_GRID_SIZE_MM,
  STORAGE_KEY_SNAP_TOLERANCE_CSS_PX,
  STORAGE_KEY_SNAP_TO_GRID,
  STORAGE_KEY_SNAP_TO_GUIDES,
  STORAGE_KEY_SNAP_TO_OBJECTS,
  type SnapOptions,
} from './lib/snap-options.service';
export {
  DEFAULT_GRID_SIZE_MM,
  DEFAULT_TOLERANCE_CSS_PX,
  MAX_GRID_SIZE_MM,
  MAX_TOLERANCE_CSS_PX,
  MIN_GRID_SIZE_MM,
  MIN_TOLERANCE_CSS_PX,
  gridTargets,
  guideTargets,
  mergeTargets,
  objectTargets,
  snapAxis,
  snapPosition,
  toleranceCssPxToMm,
  type AxisSnap,
  type SnapResult,
  type SnapTargets,
} from './lib/snap-math';
export {
  TemplateBrowserComponent,
  type TemplateInstantiateEvent,
} from './lib/template-browser.component';
export {
  TemplatesService,
  MAX_PERSONAL_TEMPLATES,
  STORAGE_KEY_PERSONAL_TEMPLATES,
} from './lib/templates.service';
export { ExportDialogComponent } from './lib/export-dialog.component';
export { ViewToggleComponent } from './lib/view-toggle.component';
export {
  ViewModeService,
  STORAGE_KEY_VIEW_MODE,
  type ViewMode,
} from './lib/view-mode.service';
export {
  BackdropPanelComponent,
  BACKDROP_PANEL_COLLAPSED_KEY,
} from './lib/backdrop-panel.component';
export {
  BackdropService,
  DEFAULT_BACKDROP_OPACITY,
  MAX_BACKDROP_BYTES,
  STORAGE_KEY_BACKDROP_DATA_URL,
  STORAGE_KEY_BACKDROP_ENABLED,
  STORAGE_KEY_BACKDROP_OPACITY,
  type ImageDecoder,
} from './lib/backdrop.service';
export {
  ZOOM_MULT_MAX,
  ZOOM_MULT_MIN,
  ZOOM_STEP_MULT,
  WHEEL_ZOOM_SENSITIVITY,
  clampZoomMult,
  composeViewport,
  cursorToWorld,
  formatZoomPercent,
  panForCursorAnchor,
  wheelDeltaToZoomFactor,
} from './lib/zoom-math';
