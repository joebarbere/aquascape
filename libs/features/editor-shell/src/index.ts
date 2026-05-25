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
