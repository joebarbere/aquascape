// Public API for @aquascape/features/hardscape-tool. Stage 3 F3.1 / F3.2.
//
// Standalone Angular component — palette browser for hardscape catalog
// entries with pointer-events drag-and-drop. `HardscapeDragService` is the
// cross-component coordination point: the palette starts a drag, the
// canvas (in apps/web) renders a ghost and dispatches AddObject on drop.

export { HardscapeToolComponent } from './lib/hardscape-tool.component';
export {
  HardscapeDragService,
  type HardscapeDragSnapshot,
  type HardscapeDropEvent,
} from './lib/hardscape-drag.service';
