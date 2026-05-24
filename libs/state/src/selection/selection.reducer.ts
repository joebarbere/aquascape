// Selection feature reducer + state shape. Stage 3 F3.3.

import type { ObjectId } from '@aquascape/domain/scene-model';
import { createFeature, createReducer, on } from '@ngrx/store';

import { SelectionActions } from './selection.actions';

export const SELECTION_FEATURE_KEY = 'selection';

export interface SelectionState {
  readonly ids: readonly ObjectId[];
}

export function initialSelectionState(): SelectionState {
  return { ids: [] };
}

const reducer = createReducer<SelectionState>(
  initialSelectionState(),

  on(
    SelectionActions.replaceSelection,
    SelectionActions.selectByMarquee,
    (_state, { ids }) => ({ ids: dedupe(ids) }),
  ),

  on(SelectionActions.toggleInSelection, (state, { id }) => {
    const present = state.ids.includes(id);
    if (present) {
      const ids = state.ids.filter((x) => x !== id);
      // Identity preserved when no change — saves an OnPush re-paint.
      return ids.length === state.ids.length ? state : { ids };
    }
    return { ids: [...state.ids, id] };
  }),

  on(
    SelectionActions.clearSelection,
    SelectionActions.selectionWasReset,
    (state) => (state.ids.length === 0 ? state : { ids: [] }),
  ),
);

/** Stable order, no duplicates. Preserves first-seen order. */
function dedupe(ids: readonly ObjectId[]): readonly ObjectId[] {
  const seen = new Set<ObjectId>();
  const out: ObjectId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const selectionFeature = createFeature({
  name: SELECTION_FEATURE_KEY,
  reducer,
});
