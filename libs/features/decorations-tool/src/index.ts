// Public API for @aquascape/features/decorations-tool.
//
// Standalone Angular component — palette browser for decor catalog entries
// (classic aquarium ornaments) with pointer-events drag-and-drop.
// `DecorDragService` is the cross-component coordination point: the palette
// starts a drag, the canvas (in apps/web) renders a ghost and dispatches
// AddObject on drop. Mirrors @aquascape/features/hardscape-tool.

export { DecorationsToolComponent } from './lib/decorations-tool.component';
export {
  DecorDragService,
  type DecorDragSnapshot,
  type DecorDropEvent,
} from './lib/decor-drag.service';
