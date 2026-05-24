// Selection feature selectors. Stage 3 F3.3.

import type { ObjectId } from '@aquascape/domain/scene-model';
import { createSelector } from '@ngrx/store';

import { selectionFeature } from './selection.reducer';

export const { selectSelectionState, selectIds: selectSelectedIds } = selectionFeature;

/** True iff the selection set contains `id`. */
export const selectIsSelected = (id: ObjectId) =>
  createSelector(selectSelectedIds, (ids) => ids.includes(id));

/** First selected id, or `null` when the set is empty. */
export const selectFirstSelected = createSelector(
  selectSelectedIds,
  (ids): ObjectId | null => ids[0] ?? null,
);

/** Count of currently-selected objects. */
export const selectSelectionCount = createSelector(
  selectSelectedIds,
  (ids) => ids.length,
);

/** Convenience boolean: any selection at all. */
export const selectHasSelection = createSelector(
  selectSelectionCount,
  (count) => count > 0,
);
