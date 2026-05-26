import type { ResolvedBehavior } from '@aquascape/domain/livestock-behaviors';
import { MID_PRESET, TOP_PRESET, BOTTOM_PRESET } from '@aquascape/domain/livestock-behaviors';
import { NO_BEHAVIOR_HANDLE, ParamStore } from './param-store';

function clone(p: ResolvedBehavior): ResolvedBehavior {
  // Defensive structural clone — tests can mutate without leaking into the
  // shared module-level preset constants.
  return JSON.parse(JSON.stringify(p)) as ResolvedBehavior;
}

describe('ParamStore', () => {
  it('starts empty', () => {
    const s = new ParamStore();
    expect(s.size).toBe(0);
    expect(s.maxNeighbourRadius()).toBe(0);
    expect(s.get(0)).toBeNull();
  });

  it('registers a species and returns a usable handle', () => {
    const s = new ParamStore();
    const handle = s.registerSpecies(1, clone(MID_PRESET));
    expect(handle).toBe(0);
    expect(s.size).toBe(1);
    expect(s.get(handle)?.schooling.ZOA).toBe(MID_PRESET.schooling.ZOA);
  });

  it('returns the same handle for the same speciesId on re-register, updating in place', () => {
    const s = new ParamStore();
    const a = s.registerSpecies(7, clone(MID_PRESET));
    const b = s.registerSpecies(7, clone(TOP_PRESET));
    expect(a).toBe(b);
    expect(s.size).toBe(1);
    expect(s.get(a)?.schooling.ZOR).toBe(TOP_PRESET.schooling.ZOR);
  });

  it('assigns distinct sequential handles to distinct species', () => {
    const s = new ParamStore();
    const a = s.registerSpecies(1, clone(MID_PRESET));
    const b = s.registerSpecies(2, clone(TOP_PRESET));
    const c = s.registerSpecies(3, clone(BOTTOM_PRESET));
    expect([a, b, c]).toEqual([0, 1, 2]);
  });

  it('maxNeighbourRadius returns the largest of ZOR/ZOO/ZOA across all species', () => {
    const s = new ParamStore();
    s.registerSpecies(1, clone(MID_PRESET)); // ZOA=90
    s.registerSpecies(2, clone(TOP_PRESET)); // ZOA=100
    s.registerSpecies(3, clone(BOTTOM_PRESET)); // ZOA=80
    expect(s.maxNeighbourRadius()).toBe(100);
  });

  it('NO_BEHAVIOR_HANDLE always resolves to null', () => {
    const s = new ParamStore();
    s.registerSpecies(1, clone(MID_PRESET));
    expect(s.get(NO_BEHAVIOR_HANDLE)).toBeNull();
  });

  it('out-of-range handles resolve to null', () => {
    const s = new ParamStore();
    s.registerSpecies(1, clone(MID_PRESET));
    expect(s.get(99)).toBeNull();
    expect(s.get(-1)).toBeNull();
  });

  it('invalidates the cached max radius on re-register', () => {
    const s = new ParamStore();
    const handle = s.registerSpecies(1, clone(MID_PRESET));
    expect(s.maxNeighbourRadius()).toBe(MID_PRESET.schooling.ZOA);
    // Re-register with a smaller ZOA → max should drop.
    const tiny = clone(MID_PRESET);
    tiny.schooling.ZOA = 10;
    tiny.schooling.ZOO = 5;
    tiny.schooling.ZOR = 2;
    s.registerSpecies(1, tiny);
    void handle;
    expect(s.maxNeighbourRadius()).toBe(10);
  });

  it('clear() resets every state surface', () => {
    const s = new ParamStore();
    s.registerSpecies(1, clone(MID_PRESET));
    s.clear();
    expect(s.size).toBe(0);
    expect(s.maxNeighbourRadius()).toBe(0);
    expect(s.get(0)).toBeNull();
  });
});
