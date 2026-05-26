import {
  BOTTOM_PRESET,
  MID_PRESET,
  TOP_PRESET,
  depthBandForSpecies,
  resolveBehavior,
  type BehaviorResolutionInput,
  type ResolvedBehavior,
} from '../index';

// Keys we expect every preset / resolved bundle to populate.
const SCHOOLING_KEYS: ReadonlyArray<keyof ResolvedBehavior['schooling']> = [
  'ZOR',
  'ZOO',
  'ZOA',
  'blindAngle',
  'vPref',
  'vMax',
  'turnMax',
  'wSep',
  'wAli',
  'wCoh',
  'noise',
];
const DEPTH_KEYS: ReadonlyArray<keyof ResolvedBehavior['depth']> = [
  'preferredY',
  'bandWidth',
  'returnForce',
];
const ANIMATION_KEYS: ReadonlyArray<keyof ResolvedBehavior['animation']> = [
  'tailBeatFreq',
  'ampHead',
  'ampTail',
  'envelopeExp',
];

function expectFullyPopulated(bundle: ResolvedBehavior): void {
  for (const k of SCHOOLING_KEYS) {
    expect(bundle.schooling[k]).toBeDefined();
    expect(Number.isFinite(bundle.schooling[k])).toBe(true);
  }
  for (const k of DEPTH_KEYS) {
    expect(bundle.depth[k]).toBeDefined();
    expect(Number.isFinite(bundle.depth[k])).toBe(true);
  }
  for (const k of ANIMATION_KEYS) {
    expect(bundle.animation[k]).toBeDefined();
    expect(Number.isFinite(bundle.animation[k])).toBe(true);
  }
}

describe('presets', () => {
  it('TOP_PRESET is fully populated with surface-fish defaults', () => {
    expectFullyPopulated(TOP_PRESET);
    expect(TOP_PRESET.depth.preferredY).toBeCloseTo(0.92);
    expect(TOP_PRESET.depth.returnForce).toBe(180);
    expect(TOP_PRESET.schooling.vPref).toBe(40);
    expect(TOP_PRESET.schooling.blindAngle).toBeCloseTo(0.25 * Math.PI);
    expect(TOP_PRESET.animation.envelopeExp).toBe(2.5);
  });

  it('MID_PRESET is fully populated with tetra-class schooler defaults', () => {
    expectFullyPopulated(MID_PRESET);
    expect(MID_PRESET.depth.preferredY).toBeCloseTo(0.55);
    expect(MID_PRESET.depth.bandWidth).toBeCloseTo(0.25);
    expect(MID_PRESET.schooling.vPref).toBe(55);
    expect(MID_PRESET.schooling.wAli).toBe(1.5);
    expect(MID_PRESET.animation.tailBeatFreq).toBeCloseTo(4.5);
  });

  it('BOTTOM_PRESET is fully populated with substrate-hugger defaults', () => {
    expectFullyPopulated(BOTTOM_PRESET);
    expect(BOTTOM_PRESET.depth.preferredY).toBeCloseTo(0.05);
    expect(BOTTOM_PRESET.depth.returnForce).toBe(220);
    expect(BOTTOM_PRESET.schooling.vPref).toBe(30);
    expect(BOTTOM_PRESET.schooling.noise).toBeCloseTo(0.1);
    expect(BOTTOM_PRESET.animation.tailBeatFreq).toBeCloseTo(3.5);
  });

  it('the three presets are visually distinct (preferredY ordering)', () => {
    expect(BOTTOM_PRESET.depth.preferredY).toBeLessThan(MID_PRESET.depth.preferredY);
    expect(MID_PRESET.depth.preferredY).toBeLessThan(TOP_PRESET.depth.preferredY);
  });
});

describe('depthBandForSpecies', () => {
  it('honours an explicit depth:top tag', () => {
    expect(depthBandForSpecies({ tags: ['depth:top'], group: 'fish', id: 'cory-trick' })).toBe('top');
  });

  it('honours an explicit depth:mid tag', () => {
    expect(depthBandForSpecies({ tags: ['unrelated', 'depth:mid'] })).toBe('mid');
  });

  it('honours an explicit depth:bottom tag over an id hint', () => {
    expect(depthBandForSpecies({ tags: ['depth:bottom'], id: 'pearl-gourami' })).toBe('bottom');
  });

  it('routes shrimp to bottom via the group shortcut', () => {
    expect(depthBandForSpecies({ group: 'shrimp', id: 'neocaridina-davidi' })).toBe('bottom');
  });

  it('routes snail to bottom via the group shortcut', () => {
    expect(depthBandForSpecies({ group: 'snail', id: 'nerite' })).toBe('bottom');
  });

  it('matches a top-band id substring case-insensitively', () => {
    expect(depthBandForSpecies({ group: 'fish', id: 'Marbled-Hatchet' })).toBe('top');
    expect(depthBandForSpecies({ group: 'fish', id: 'Dwarf-Gourami' })).toBe('top');
    expect(depthBandForSpecies({ group: 'fish', id: 'BLUE-PENCILFISH' })).toBe('top');
  });

  it('matches a bottom-band id substring case-insensitively', () => {
    expect(depthBandForSpecies({ group: 'fish', id: 'Bronze-Cory' })).toBe('bottom');
    expect(depthBandForSpecies({ group: 'fish', id: 'Kuhli-Loach' })).toBe('bottom');
    expect(depthBandForSpecies({ group: 'fish', id: 'Bristlenose-Pleco' })).toBe('bottom');
    expect(depthBandForSpecies({ group: 'fish', id: 'Otocinclus' })).toBe('bottom');
  });

  it('falls back to mid for a fish with no other signal', () => {
    expect(depthBandForSpecies({ group: 'fish', id: 'cardinal-tetra' })).toBe('mid');
  });

  it('falls back to mid for a row with no group + no signal at all', () => {
    expect(depthBandForSpecies({})).toBe('mid');
    expect(depthBandForSpecies({ tags: ['peaceful'] })).toBe('mid');
  });

  it('ignores an empty tags array gracefully', () => {
    expect(depthBandForSpecies({ tags: [], group: 'fish', id: 'cory' })).toBe('bottom');
  });
});

describe('resolveBehavior — preset selection', () => {
  it('returns the top preset for a hatchetfish id', () => {
    const r = resolveBehavior({ group: 'fish', id: 'marbled-hatchet' });
    expect(r.depth.preferredY).toBeCloseTo(TOP_PRESET.depth.preferredY);
    expect(r.schooling.vPref).toBe(TOP_PRESET.schooling.vPref);
  });

  it('returns the mid preset for an unknown fish', () => {
    const r = resolveBehavior({ group: 'fish', id: 'cardinal-tetra' });
    expect(r).toEqual(MID_PRESET);
  });

  it('returns the bottom preset for a snail via group-shortcut', () => {
    const r = resolveBehavior({ group: 'snail', id: 'nerite' });
    expect(r).toEqual(BOTTOM_PRESET);
  });

  it('returns the mid preset for an unknown-group entry with no tags', () => {
    const r = resolveBehavior({ id: 'mystery-fish' });
    expect(r).toEqual(MID_PRESET);
  });

  it('returns the mid preset for a totally empty entry', () => {
    expect(resolveBehavior({})).toEqual(MID_PRESET);
  });
});

describe('resolveBehavior — override merging', () => {
  it('passes the preset through unchanged when no overrides are supplied', () => {
    const r = resolveBehavior({ group: 'fish', id: 'tetra' });
    expect(r).toEqual(MID_PRESET);
  });

  it('merges a partial schooling override over the preset', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'tetra',
      behavior: { schooling: { vPref: 999 } },
    });
    expect(r.schooling.vPref).toBe(999);
    // Every other schooling field falls through to the preset default.
    expect(r.schooling.ZOR).toBe(MID_PRESET.schooling.ZOR);
    expect(r.schooling.ZOO).toBe(MID_PRESET.schooling.ZOO);
    expect(r.schooling.ZOA).toBe(MID_PRESET.schooling.ZOA);
    expect(r.schooling.wAli).toBe(MID_PRESET.schooling.wAli);
    expect(r.schooling.noise).toBe(MID_PRESET.schooling.noise);
    // Depth + animation untouched.
    expect(r.depth).toEqual(MID_PRESET.depth);
    expect(r.animation).toEqual(MID_PRESET.animation);
  });

  it('merges partial depth + animation overrides independently', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'hatchet',
      behavior: {
        depth: { preferredY: 0.99 },
        animation: { tailBeatFreq: 7 },
      },
    });
    expect(r.depth.preferredY).toBeCloseTo(0.99);
    expect(r.depth.bandWidth).toBeCloseTo(TOP_PRESET.depth.bandWidth);
    expect(r.animation.tailBeatFreq).toBe(7);
    expect(r.animation.ampTail).toBeCloseTo(TOP_PRESET.animation.ampTail);
  });

  it('does not mutate the shared preset constant when overrides are applied', () => {
    const before = JSON.parse(JSON.stringify(MID_PRESET));
    resolveBehavior({
      group: 'fish',
      id: 'tetra',
      behavior: { schooling: { vPref: 1234, ZOR: 999 }, depth: { preferredY: 0.1 } },
    });
    expect(MID_PRESET).toEqual(before);
  });

  it('returns a fresh object — mutating it does not contaminate the next call', () => {
    const first = resolveBehavior({ group: 'fish', id: 'tetra' });
    // Cast away readonly-ish intent purely for the mutation test.
    (first.schooling as { vPref: number }).vPref = -1;
    (first.depth as { preferredY: number }).preferredY = -1;
    (first.animation as { tailBeatFreq: number }).tailBeatFreq = -1;
    const second = resolveBehavior({ group: 'fish', id: 'tetra' });
    expect(second.schooling.vPref).toBe(MID_PRESET.schooling.vPref);
    expect(second.depth.preferredY).toBe(MID_PRESET.depth.preferredY);
    expect(second.animation.tailBeatFreq).toBe(MID_PRESET.animation.tailBeatFreq);
  });

  it('is deterministic — same input yields equal output across calls', () => {
    const input: BehaviorResolutionInput = {
      group: 'fish',
      id: 'kuhli-loach',
      behavior: { schooling: { vPref: 33 } },
    };
    expect(resolveBehavior(input)).toEqual(resolveBehavior(input));
  });
});
