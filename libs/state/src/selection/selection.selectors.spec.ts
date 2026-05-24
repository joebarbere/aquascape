// Selection feature selectors. Stage 3 F3.3.

import { initialSelectionState } from './selection.reducer';
import {
  selectFirstSelected,
  selectHasSelection,
  selectIsSelected,
  selectSelectedIds,
  selectSelectionCount,
} from './selection.selectors';

const id = (s: string) => s as unknown as Parameters<typeof selectIsSelected>[0];

const wrap = (ids: string[] = []) => ({
  selection: { ...initialSelectionState(), ids: ids.map((s) => id(s)) },
});

describe('selection selectors', () => {
  it('selectSelectedIds returns the array', () => {
    expect(selectSelectedIds(wrap(['a', 'b']))).toEqual([id('a'), id('b')]);
  });

  it('selectIsSelected(id) returns true iff the id is in the set', () => {
    expect(selectIsSelected(id('a'))(wrap(['a', 'b']))).toBe(true);
    expect(selectIsSelected(id('c'))(wrap(['a', 'b']))).toBe(false);
  });

  it('selectFirstSelected returns the first id or null', () => {
    expect(selectFirstSelected(wrap([]))).toBeNull();
    expect(selectFirstSelected(wrap(['a', 'b']))).toEqual(id('a'));
  });

  it('selectSelectionCount returns the length', () => {
    expect(selectSelectionCount(wrap([]))).toBe(0);
    expect(selectSelectionCount(wrap(['a', 'b', 'c']))).toBe(3);
  });

  it('selectHasSelection mirrors count > 0', () => {
    expect(selectHasSelection(wrap([]))).toBe(false);
    expect(selectHasSelection(wrap(['a']))).toBe(true);
  });
});
