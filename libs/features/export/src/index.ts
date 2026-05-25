// Public API for @aquascape/features/export. Stage 6 F6.1 + F6.2.
//
// Pure, framework-free helpers for:
//   - Tank-volume math (gross / substrate-displaced / water; L + US gal).
//   - Scene-summary aggregation (plant + hardscape lists, totals).
//   - Markdown + JSON formatters for the summary.
//   - Offscreen PNG / JPEG rendering of the scene via `Canvas2DRenderer`.
//
// The Angular dialog UI that composes these lives in
// `features/editor-shell` (where the jest Angular preset is already
// configured); this lib stays Node-jest-friendly so the math stays
// trivially testable in headless / CLI flows too.

export {
  computeVolumeBreakdown,
  type VolumeBreakdown,
} from './lib/volume';
export {
  formatSummaryJson,
  formatSummaryMarkdown,
  summarizeScene,
  type SceneSummary,
  type SummaryItem,
} from './lib/summary';
export {
  RESOLUTION_PRESETS,
  fitViewport,
  renderSceneToImageBytes,
  type CanvasLike,
  type ExportImageFormat,
  type ExportResolution,
  type OffscreenRenderRequest,
} from './lib/offscreen-render';
