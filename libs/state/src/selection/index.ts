// Selection feature barrel. Stage 3 F3.3.

export { SelectionActions } from './selection.actions';
export {
  SELECTION_FEATURE_KEY,
  initialSelectionState,
  selectionFeature,
} from './selection.reducer';
export type { SelectionState } from './selection.reducer';
export { SelectionEffects } from './selection.effects';
export {
  selectFirstSelected,
  selectHasSelection,
  selectIsSelected,
  selectSelectedIds,
  selectSelectionCount,
  selectSelectionState,
} from './selection.selectors';
