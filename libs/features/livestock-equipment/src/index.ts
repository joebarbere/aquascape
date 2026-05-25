// Public API for @aquascape/features/livestock-equipment. Plan Stage 7.
//
// F7.1 ships the livestock-tool UI — a paginated catalog browser + an
// inventory list. F7.3 will add a sibling `EquipmentToolComponent` in the
// same lib (intentional grouping: both are "stock the tank" planning
// concerns that ride on top of the spatial scene model).

export {
  LIVESTOCK_TOOL_COLLAPSED_KEY,
  LIVESTOCK_TOOL_PAGE_SIZE,
  LivestockToolComponent,
} from './lib/livestock-tool.component';
