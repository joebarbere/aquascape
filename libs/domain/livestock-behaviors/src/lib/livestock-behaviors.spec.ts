import {
  BOTTOM_PRESET,
  MID_PRESET,
  TOP_PRESET,
  depthBandForSpecies,
  resolveBehavior,
  type BehaviorResolutionInput,
  type CuriosityParams,
  type FearParams,
  type FeedingCategory,
  type FeedingParams,
  type NippingParams,
  type ResolvedBehavior,
  type TerritoryParams,
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
const FEAR_KEYS: ReadonlyArray<keyof FearParams> = [
  'riskBaseline',
  'threshold',
  'coverPreference',
  'emergenceDelay',
];
const FEEDING_KEYS: ReadonlyArray<keyof FeedingParams> = [
  'hungerRatePerSec',
  'threshold',
  'category',
];
const CURIOSITY_KEYS: ReadonlyArray<keyof CuriosityParams> = [
  'boldness',
  'ratePerSec',
  'dwellSec',
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
  for (const k of FEAR_KEYS) {
    expect(bundle.fear[k]).toBeDefined();
  }
  expect(Number.isFinite(bundle.fear.riskBaseline)).toBe(true);
  expect(Number.isFinite(bundle.fear.threshold)).toBe(true);
  expect(Number.isFinite(bundle.fear.emergenceDelay)).toBe(true);
  expect(typeof bundle.fear.coverPreference).toBe('string');
  for (const k of FEEDING_KEYS) {
    expect(bundle.feeding[k]).toBeDefined();
  }
  expect(Number.isFinite(bundle.feeding.hungerRatePerSec)).toBe(true);
  expect(Number.isFinite(bundle.feeding.threshold)).toBe(true);
  expect(typeof bundle.feeding.category).toBe('string');
  for (const k of CURIOSITY_KEYS) {
    expect(bundle.curiosity[k]).toBeDefined();
    expect(Number.isFinite(bundle.curiosity[k])).toBe(true);
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

  it('every preset has territory: null + nipping: null (species-specific, not band-specific)', () => {
    expect(TOP_PRESET.territory).toBeNull();
    expect(TOP_PRESET.nipping).toBeNull();
    expect(MID_PRESET.territory).toBeNull();
    expect(MID_PRESET.nipping).toBeNull();
    expect(BOTTOM_PRESET.territory).toBeNull();
    expect(BOTTOM_PRESET.nipping).toBeNull();
  });

  it('TOP_PRESET fear: bold (riskBaseline 0.05, threshold 0.6, plants, 5s emergence)', () => {
    expect(TOP_PRESET.fear).toEqual<FearParams>({
      riskBaseline: 0.05,
      threshold: 0.6,
      coverPreference: 'plants',
      emergenceDelay: 5,
    });
  });

  it('MID_PRESET fear: average (riskBaseline 0.08, threshold 0.5, plants, 4s emergence)', () => {
    expect(MID_PRESET.fear).toEqual<FearParams>({
      riskBaseline: 0.08,
      threshold: 0.5,
      coverPreference: 'plants',
      emergenceDelay: 4,
    });
  });

  it('BOTTOM_PRESET fear: skittish (riskBaseline 0.15, threshold 0.4, wood, 8s emergence)', () => {
    expect(BOTTOM_PRESET.fear).toEqual<FearParams>({
      riskBaseline: 0.15,
      threshold: 0.4,
      coverPreference: 'wood',
      emergenceDelay: 8,
    });
  });

  it('fear ordering by band — bottom triggers earlier + stays hidden longer than top', () => {
    expect(BOTTOM_PRESET.fear.threshold).toBeLessThan(TOP_PRESET.fear.threshold);
    expect(BOTTOM_PRESET.fear.emergenceDelay).toBeGreaterThan(TOP_PRESET.fear.emergenceDelay);
    expect(BOTTOM_PRESET.fear.riskBaseline).toBeGreaterThan(TOP_PRESET.fear.riskBaseline);
  });

  it('TOP_PRESET feeding: surface category, default hunger rate + threshold', () => {
    expect(TOP_PRESET.feeding).toEqual<FeedingParams>({
      hungerRatePerSec: 1 / 120,
      threshold: 0.7,
      category: 'surface',
    });
  });

  it('MID_PRESET feeding: midwater category, default hunger rate + threshold', () => {
    expect(MID_PRESET.feeding).toEqual<FeedingParams>({
      hungerRatePerSec: 1 / 120,
      threshold: 0.7,
      category: 'midwater',
    });
  });

  it('BOTTOM_PRESET feeding: substrate category, slower hunger rate', () => {
    expect(BOTTOM_PRESET.feeding).toEqual<FeedingParams>({
      hungerRatePerSec: 1 / 180,
      threshold: 0.7,
      category: 'substrate',
    });
  });

  it('TOP_PRESET curiosity: bold (0.7), 0.06 rate, 4s dwell', () => {
    expect(TOP_PRESET.curiosity).toEqual<CuriosityParams>({
      boldness: 0.7,
      ratePerSec: 0.06,
      dwellSec: 4,
    });
  });

  it('MID_PRESET curiosity: average (0.5), 0.05 rate, 3s dwell', () => {
    expect(MID_PRESET.curiosity).toEqual<CuriosityParams>({
      boldness: 0.5,
      ratePerSec: 0.05,
      dwellSec: 3,
    });
  });

  it('BOTTOM_PRESET curiosity: shy (0.2), 0.02 rate, 2s dwell', () => {
    expect(BOTTOM_PRESET.curiosity).toEqual<CuriosityParams>({
      boldness: 0.2,
      ratePerSec: 0.02,
      dwellSec: 2,
    });
  });

  it('curiosity ordering by band — bottom species less curious than top', () => {
    expect(BOTTOM_PRESET.curiosity.boldness).toBeLessThan(MID_PRESET.curiosity.boldness);
    expect(MID_PRESET.curiosity.boldness).toBeLessThan(TOP_PRESET.curiosity.boldness);
    expect(BOTTOM_PRESET.curiosity.ratePerSec).toBeLessThan(TOP_PRESET.curiosity.ratePerSec);
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

  it('returns the bottom preset for a snail via group-shortcut (with F11.4 invertebrate overrides applied)', () => {
    const r = resolveBehavior({ group: 'snail', id: 'nerite' });
    // F11.3 fields land bottom-preset; F11.4 upgrades the snail's category to
    // 'detritivore' and its curiosity to the invertebrate temperament.
    expect(r.schooling).toEqual(BOTTOM_PRESET.schooling);
    expect(r.depth).toEqual(BOTTOM_PRESET.depth);
    expect(r.animation).toEqual(BOTTOM_PRESET.animation);
    expect(r.fear).toEqual(BOTTOM_PRESET.fear);
    expect(r.territory).toBeNull();
    expect(r.nipping).toBeNull();
    expect(r.feeding.category).toBe<FeedingCategory>('detritivore');
    expect(r.curiosity).toEqual<CuriosityParams>({
      boldness: 0.1,
      ratePerSec: 0.01,
      dwellSec: 2,
    });
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

describe('resolveBehavior — fear (always-present)', () => {
  it('top-band species carries TOP_PRESET fear by default', () => {
    const r = resolveBehavior({ group: 'fish', id: 'marbled-hatchet' });
    expect(r.fear).toEqual(TOP_PRESET.fear);
  });

  it('mid-band species carries MID_PRESET fear by default', () => {
    const r = resolveBehavior({ group: 'fish', id: 'cardinal-tetra' });
    expect(r.fear).toEqual(MID_PRESET.fear);
  });

  it('bottom-band species carries BOTTOM_PRESET fear by default', () => {
    const r = resolveBehavior({ group: 'fish', id: 'Kuhli-Loach' });
    expect(r.fear).toEqual(BOTTOM_PRESET.fear);
  });

  it('partial fear override: threshold replaced, all other fields keep preset defaults', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'tetra',
      behavior: { fear: { threshold: 0.9 } },
    });
    expect(r.fear.threshold).toBeCloseTo(0.9);
    expect(r.fear.riskBaseline).toBe(MID_PRESET.fear.riskBaseline);
    expect(r.fear.coverPreference).toBe(MID_PRESET.fear.coverPreference);
    expect(r.fear.emergenceDelay).toBe(MID_PRESET.fear.emergenceDelay);
  });

  it('partial fear override: coverPreference can be set to caves', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'kuhli-loach',
      behavior: { fear: { coverPreference: 'caves' } },
    });
    expect(r.fear.coverPreference).toBe('caves');
    // Other fear fields fall through to the bottom preset.
    expect(r.fear.threshold).toBe(BOTTOM_PRESET.fear.threshold);
    expect(r.fear.emergenceDelay).toBe(BOTTOM_PRESET.fear.emergenceDelay);
  });

  it('fear override does not mutate the shared preset', () => {
    const before = JSON.parse(JSON.stringify(MID_PRESET.fear));
    resolveBehavior({
      group: 'fish',
      id: 'tetra',
      behavior: { fear: { riskBaseline: 0.99 } },
    });
    expect(MID_PRESET.fear).toEqual(before);
  });
});

describe('resolveBehavior — territory heuristic', () => {
  // Expected defaults from the heuristic table.
  const expectedTerritory: TerritoryParams = {
    coreRadius: 80,
    displayRadius: 150,
    aggression: 100,
    fatigueRate: 0.08,
  };

  it('assigns territory to a German blue ram (cichlid id substring "ram")', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.german-ram' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('assigns territory to an apistogramma', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.apistogramma-cacatuoides' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('assigns territory to an angelfish', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.angelfish' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('assigns territory to a discus', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.discus' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('assigns territory to a generic cichlid', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.convict-cichlid' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('assigns territory to a betta', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.betta-splendens' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('substring matching is case-insensitive', () => {
    const r = resolveBehavior({ group: 'fish', id: 'CORE/LIVESTOCK.FISH.GERMAN-RAM' });
    expect(r.territory).toEqual(expectedTerritory);
  });

  it('returns territory: null for a non-territorial species', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    expect(r.territory).toBeNull();
  });

  it('returns territory: null for a shrimp', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.neocaridina-ram' });
    expect(r.territory).toBeNull();
  });

  it('returns territory: null for a snail even if id contains a hint', () => {
    const r = resolveBehavior({ group: 'snail', id: 'rambo-nerite' });
    expect(r.territory).toBeNull();
  });

  it('returns territory: null when id is missing', () => {
    const r = resolveBehavior({ group: 'fish' });
    expect(r.territory).toBeNull();
  });
});

describe('resolveBehavior — nipping heuristic', () => {
  const expectedNipping: NippingParams = {
    groupThreshold: 8,
    finFraction: 0.4,
    rate: 0.5,
  };

  it('assigns nipping to tigerbarb (no separator)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.tigerbarb' });
    expect(r.nipping).toEqual(expectedNipping);
  });

  it('assigns nipping to tiger-barb (hyphen)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.tiger-barb' });
    expect(r.nipping).toEqual(expectedNipping);
  });

  it('assigns nipping to tiger_barb (underscore)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.tiger_barb' });
    expect(r.nipping).toEqual(expectedNipping);
  });

  it('assigns nipping to a rosybarb', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.rosybarb' });
    expect(r.nipping).toEqual(expectedNipping);
  });

  it('substring matching is case-insensitive', () => {
    const r = resolveBehavior({ group: 'fish', id: 'CORE/LIVESTOCK.FISH.TIGER-BARB' });
    expect(r.nipping).toEqual(expectedNipping);
  });

  it('returns nipping: null for a non-nipper barb (cherry barb without a hint match)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.cherry-barb' });
    expect(r.nipping).toBeNull();
  });

  it('returns nipping: null for a shrimp even with a nipper-like name', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.tigerbarb-shrimp' });
    expect(r.nipping).toBeNull();
  });

  it('returns nipping: null when id is missing', () => {
    const r = resolveBehavior({ group: 'fish' });
    expect(r.nipping).toBeNull();
  });
});

describe('resolveBehavior — territory + nipping override semantics', () => {
  it('explicit opt-out: behavior.territory: null on a cichlid returns territory: null', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.german-ram',
      behavior: { territory: null },
    });
    expect(r.territory).toBeNull();
  });

  it('explicit opt-out: behavior.nipping: null on a tiger barb returns nipping: null', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.tiger-barb',
      behavior: { nipping: null },
    });
    expect(r.nipping).toBeNull();
  });

  it('partial override of an existing heuristic-derived territory keeps other fields', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.angelfish',
      behavior: { territory: { aggression: 200 } },
    });
    expect(r.territory).toEqual({
      coreRadius: 80,
      displayRadius: 150,
      aggression: 200,
      fatigueRate: 0.08,
    });
  });

  it('partial override of an existing heuristic-derived nipping keeps other fields', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.tiger-barb',
      behavior: { nipping: { rate: 1.0 } },
    });
    expect(r.nipping).toEqual({
      groupThreshold: 8,
      finFraction: 0.4,
      rate: 1.0,
    });
  });

  it('opt-in: a species with no territory heuristic can have one declared via the catalog', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.curated-territory-fish',
      behavior: { territory: { coreRadius: 50, aggression: 30 } },
    });
    expect(r.territory).toEqual({
      coreRadius: 50,
      displayRadius: 150,
      aggression: 30,
      fatigueRate: 0.08,
    });
  });

  it('opt-in: a species with no nipping heuristic can have one declared via the catalog', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.curated-nipper',
      behavior: { nipping: { groupThreshold: 4 } },
    });
    expect(r.nipping).toEqual({
      groupThreshold: 4,
      finFraction: 0.4,
      rate: 0.5,
    });
  });

  it('partial territory override does not mutate the next call', () => {
    const a = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.angelfish',
      behavior: { territory: { aggression: 9999 } },
    });
    (a.territory as TerritoryParams).aggression = -1;
    const b = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.angelfish',
    });
    expect(b.territory).toEqual({
      coreRadius: 80,
      displayRadius: 150,
      aggression: 100,
      fatigueRate: 0.08,
    });
  });
});

describe('resolveBehavior — invertebrate + non-special species sanity', () => {
  it('a neon tetra resolves to mid preset with no territory + no nipping', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    expect(r.territory).toBeNull();
    expect(r.nipping).toBeNull();
    expect(r.fear).toEqual(MID_PRESET.fear);
    expect(r.schooling).toEqual(MID_PRESET.schooling);
    expect(r.depth).toEqual(MID_PRESET.depth);
    expect(r.animation).toEqual(MID_PRESET.animation);
  });

  it('a cherry shrimp resolves to bottom preset with no territory + no nipping', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.cherry' });
    expect(r.territory).toBeNull();
    expect(r.nipping).toBeNull();
    expect(r.fear).toEqual(BOTTOM_PRESET.fear);
    expect(r.schooling).toEqual(BOTTOM_PRESET.schooling);
    expect(r.depth).toEqual(BOTTOM_PRESET.depth);
  });

  it('a nerite snail resolves to bottom preset with no territory + no nipping', () => {
    const r = resolveBehavior({ group: 'snail', id: 'core/livestock.snail.nerite' });
    expect(r.territory).toBeNull();
    expect(r.nipping).toBeNull();
    expect(r.fear).toEqual(BOTTOM_PRESET.fear);
  });
});

describe('resolveBehavior — feeding heuristic', () => {
  it('top-band species carries TOP_PRESET feeding by default (surface)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.marbled-hatchet' });
    expect(r.feeding).toEqual(TOP_PRESET.feeding);
    expect(r.feeding.category).toBe<FeedingCategory>('surface');
  });

  it('mid-band species carries MID_PRESET feeding by default (midwater)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    expect(r.feeding).toEqual(MID_PRESET.feeding);
    expect(r.feeding.category).toBe<FeedingCategory>('midwater');
  });

  it('bottom-band species carries BOTTOM_PRESET feeding by default (substrate)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.bronze-cory' });
    expect(r.feeding).toEqual(BOTTOM_PRESET.feeding);
    expect(r.feeding.category).toBe<FeedingCategory>('substrate');
  });

  it('otocinclus → algae-grazer (id substring "oto")', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.otocinclus-affinis' });
    expect(r.feeding.category).toBe<FeedingCategory>('algae-grazer');
    // Hunger rate + threshold inherit from the bottom preset (otocinclus is bottom-band).
    expect(r.feeding.hungerRatePerSec).toBeCloseTo(BOTTOM_PRESET.feeding.hungerRatePerSec);
    expect(r.feeding.threshold).toBeCloseTo(BOTTOM_PRESET.feeding.threshold);
  });

  it('pleco → algae-grazer (id substring "pleco")', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.bristlenose-pleco' });
    expect(r.feeding.category).toBe<FeedingCategory>('algae-grazer');
  });

  it('siamese algae eater → algae-grazer (id substring "siamese-algae")', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.siamese-algae-eater' });
    expect(r.feeding.category).toBe<FeedingCategory>('algae-grazer');
  });

  it('silver dollar (no separator) → plant-eater', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.silverdollar' });
    expect(r.feeding.category).toBe<FeedingCategory>('plant-eater');
  });

  it('silver-dollar (hyphen) → plant-eater', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.silver-dollar' });
    expect(r.feeding.category).toBe<FeedingCategory>('plant-eater');
  });

  it('severum → plant-eater', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.green-severum' });
    expect(r.feeding.category).toBe<FeedingCategory>('plant-eater');
  });

  it('amano shrimp → detritivore even though its band-preset is substrate', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.amano' });
    expect(r.feeding.category).toBe<FeedingCategory>('detritivore');
    // The depth band is bottom; only the category gets upgraded.
    expect(r.depth).toEqual(BOTTOM_PRESET.depth);
  });

  it('nerite snail → detritivore', () => {
    const r = resolveBehavior({ group: 'snail', id: 'core/livestock.snail.nerite' });
    expect(r.feeding.category).toBe<FeedingCategory>('detritivore');
  });

  it('group shortcut beats id substring — a shrimp named "oto-shrimp" still resolves to detritivore', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.oto-clone' });
    expect(r.feeding.category).toBe<FeedingCategory>('detritivore');
  });

  it('substring matching is case-insensitive (OTOCINCLUS in upper case)', () => {
    const r = resolveBehavior({ group: 'fish', id: 'CORE/LIVESTOCK.FISH.OTOCINCLUS' });
    expect(r.feeding.category).toBe<FeedingCategory>('algae-grazer');
  });

  it('partial feeding override: threshold replaced, category + hunger preserved', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.neon-tetra',
      behavior: { feeding: { threshold: 0.9 } },
    });
    expect(r.feeding.threshold).toBeCloseTo(0.9);
    expect(r.feeding.category).toBe<FeedingCategory>('midwater');
    expect(r.feeding.hungerRatePerSec).toBeCloseTo(MID_PRESET.feeding.hungerRatePerSec);
  });

  it('partial feeding override: category can be set explicitly', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.curated-feeder',
      behavior: { feeding: { category: 'algae-grazer' } },
    });
    expect(r.feeding.category).toBe<FeedingCategory>('algae-grazer');
  });

  it('catalog override beats heuristic: an oto with explicit category "midwater" picks midwater', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.otocinclus-affinis',
      behavior: { feeding: { category: 'midwater' } },
    });
    expect(r.feeding.category).toBe<FeedingCategory>('midwater');
  });

  it('feeding override does not mutate the shared preset', () => {
    const before = JSON.parse(JSON.stringify(MID_PRESET.feeding));
    resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.neon-tetra',
      behavior: { feeding: { hungerRatePerSec: 999 } },
    });
    expect(MID_PRESET.feeding).toEqual(before);
  });

  it('mutating the returned feeding does not contaminate the next call', () => {
    const a = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    (a.feeding as { threshold: number }).threshold = -1;
    const b = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    expect(b.feeding.threshold).toBe(MID_PRESET.feeding.threshold);
  });
});

describe('resolveBehavior — curiosity heuristic', () => {
  it('top-band species carries TOP_PRESET curiosity by default', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.marbled-hatchet' });
    expect(r.curiosity).toEqual(TOP_PRESET.curiosity);
  });

  it('mid-band species carries MID_PRESET curiosity by default', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.neon-tetra' });
    expect(r.curiosity).toEqual(MID_PRESET.curiosity);
  });

  it('kuhli loach → boldness ≈ 0.05, ratePerSec ≈ 0.005; dwellSec inherits BOTTOM_PRESET', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.kuhli-loach' });
    expect(r.curiosity.boldness).toBeCloseTo(0.05);
    expect(r.curiosity.ratePerSec).toBeCloseTo(0.005);
    // dwellSec wasn't overridden — falls through to bottom preset.
    expect(r.curiosity.dwellSec).toBe(BOTTOM_PRESET.curiosity.dwellSec);
  });

  it('shrimp → boldness 0.1, ratePerSec 0.01, dwellSec 2 (invertebrate override)', () => {
    const r = resolveBehavior({ group: 'shrimp', id: 'core/livestock.shrimp.cherry' });
    expect(r.curiosity).toEqual<CuriosityParams>({
      boldness: 0.1,
      ratePerSec: 0.01,
      dwellSec: 2,
    });
  });

  it('snail → boldness 0.1, ratePerSec 0.01, dwellSec 2 (invertebrate override)', () => {
    const r = resolveBehavior({ group: 'snail', id: 'core/livestock.snail.nerite' });
    expect(r.curiosity).toEqual<CuriosityParams>({
      boldness: 0.1,
      ratePerSec: 0.01,
      dwellSec: 2,
    });
  });

  it('id substring "shrimp" on a fish-group entry still triggers the invertebrate override', () => {
    // Defensive coverage for the id-substring branch when group is missing
    // (e.g. an entry that only carries id). Without group=shrimp/snail the
    // group shortcut doesn't fire, so id-substring matching must hold.
    const r = resolveBehavior({ id: 'core/livestock.fish.shrimpfish' });
    expect(r.curiosity).toEqual<CuriosityParams>({
      boldness: 0.1,
      ratePerSec: 0.01,
      dwellSec: 2,
    });
  });

  it('partial curiosity override: dwellSec replaced, boldness + rate preserved', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.neon-tetra',
      behavior: { curiosity: { dwellSec: 10 } },
    });
    expect(r.curiosity.dwellSec).toBe(10);
    expect(r.curiosity.boldness).toBe(MID_PRESET.curiosity.boldness);
    expect(r.curiosity.ratePerSec).toBe(MID_PRESET.curiosity.ratePerSec);
  });

  it('catalog override beats kuhli heuristic — explicit boldness 0.9 wins', () => {
    const r = resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.kuhli-loach',
      behavior: { curiosity: { boldness: 0.9 } },
    });
    expect(r.curiosity.boldness).toBeCloseTo(0.9);
  });

  it('curiosity override does not mutate the shared preset', () => {
    const before = JSON.parse(JSON.stringify(TOP_PRESET.curiosity));
    resolveBehavior({
      group: 'fish',
      id: 'core/livestock.fish.marbled-hatchet',
      behavior: { curiosity: { boldness: 0.001 } },
    });
    expect(TOP_PRESET.curiosity).toEqual(before);
  });
});

describe('resolveBehavior — F11.4 sanity (no ripple to F11.3 fields)', () => {
  it('an otocinclus still resolves bottom-band schooling + depth + fear', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.otocinclus-affinis' });
    expect(r.schooling).toEqual(BOTTOM_PRESET.schooling);
    expect(r.depth).toEqual(BOTTOM_PRESET.depth);
    expect(r.fear).toEqual(BOTTOM_PRESET.fear);
    expect(r.territory).toBeNull();
    expect(r.nipping).toBeNull();
  });

  it('a tiger barb still carries nipping AND now feeds midwater + has mid curiosity', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.tiger-barb' });
    expect(r.nipping).not.toBeNull();
    expect(r.feeding).toEqual(MID_PRESET.feeding);
    expect(r.curiosity).toEqual(MID_PRESET.curiosity);
  });

  it('a german ram still carries territory AND now feeds midwater + has mid curiosity', () => {
    const r = resolveBehavior({ group: 'fish', id: 'core/livestock.fish.german-ram' });
    expect(r.territory).not.toBeNull();
    expect(r.feeding).toEqual(MID_PRESET.feeding);
    expect(r.curiosity).toEqual(MID_PRESET.curiosity);
  });
});
