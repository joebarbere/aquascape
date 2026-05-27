import { CATALOG_ENTRY_JSON_SCHEMA, formatError, validateCatalogEntry } from './validator';

describe('validateCatalogEntry', () => {
  it('accepts a well-formed substrate entry', () => {
    expect(
      validateCatalogEntry({
        catalog: 'core',
        id: 'substrate.x.y',
        version: 1,
        name: 'X',
        kind: 'substrate',
        material: 'soil',
        color: '#abcdef',
        grainSize: 3,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects missing required fields', () => {
    const result = validateCatalogEntry({ catalog: 'core' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown kind (no matching oneOf branch)', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'rainbow',
      material: 'soil',
      color: '#abcdef',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid color', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'soil',
      color: 'not-a-color',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('color'))).toBe(true);
  });

  it('rejects an invalid material enum', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'lava',
      color: '#abcdef',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    const result = validateCatalogEntry({
      catalog: 'core',
      id: 'x',
      version: 1,
      name: 'X',
      kind: 'substrate',
      material: 'soil',
      color: '#abcdef',
      surprise: true,
    });
    expect(result.ok).toBe(false);
  });

  it('exposes the schema for tooling', () => {
    expect(CATALOG_ENTRY_JSON_SCHEMA).toMatchObject({ title: 'CatalogEntry' });
  });

  it('uses "<root>" as the path when AJV reports a root-level error', () => {
    // A non-object input fails at the root with an empty instancePath.
    const result = validateCatalogEntry(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '<root>')).toBe(true);
  });
});

describe('validateCatalogEntry (hardscape, Stage 3 F3.5)', () => {
  const validHardscape = {
    catalog: 'core',
    id: 'rock.test',
    version: 1,
    name: 'Test rock',
    kind: 'hardscape',
    category: 'rock',
    naturalSize: { width: 100, height: 80, depth: 60 },
    color: '#abcdef',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  };

  it('accepts a well-formed hardscape entry', () => {
    expect(validateCatalogEntry(validHardscape)).toEqual({ ok: true });
  });

  it('accepts an optional subcategory field', () => {
    expect(validateCatalogEntry({ ...validHardscape, subcategory: 'seiryu' })).toEqual({
      ok: true,
    });
  });

  it('rejects an unknown category enum value', () => {
    expect(validateCatalogEntry({ ...validHardscape, category: 'shrub' }).ok).toBe(false);
  });

  it('rejects a silhouette with fewer than 3 points', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        silhouette: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('rejects naturalSize with a zero dimension', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        naturalSize: { width: 0, height: 80, depth: 60 },
      }).ok,
    ).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validHardscape, surprise: true }).ok).toBe(false);
  });

  // ─── F11.3 coverScore (additive, no schemaVersion bump) ──────────────────
  describe('coverScore (Stage 11 F11.3 FearSystem)', () => {
    it('accepts a hardscape entry with no coverScore (loader fills the default)', () => {
      expect(validateCatalogEntry(validHardscape)).toEqual({ ok: true });
    });

    it('accepts coverScore = 0 (sentinel for non-cover decor)', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: 0 }).ok).toBe(true);
    });

    it('accepts coverScore = 1 (perfect refuge)', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: 1 }).ok).toBe(true);
    });

    it('accepts a mid-range coverScore', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: 0.5 }).ok).toBe(true);
    });

    it('rejects coverScore below 0', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: -0.1 }).ok).toBe(false);
    });

    it('rejects coverScore above 1', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: 1.5 }).ok).toBe(false);
    });

    it('rejects a non-numeric coverScore', () => {
      expect(validateCatalogEntry({ ...validHardscape, coverScore: 'high' }).ok).toBe(false);
    });
  });
});

describe('validateCatalogEntry (plant, Stage 4 F4.1)', () => {
  const validPlant = {
    catalog: 'core',
    id: 'plant.test',
    version: 1,
    name: 'Test plant',
    kind: 'plant',
    zone: 'foreground',
    lighting: 'medium',
    co2: 'low',
    difficulty: 'easy',
    color: '#abcdef',
    naturalSize: { width: 50, height: 50, depth: 50 },
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
    growth: { weeksToMature: 6, sizeAtZero: 0.3 },
  };

  it('accepts a well-formed plant entry', () => {
    expect(validateCatalogEntry(validPlant)).toEqual({ ok: true });
  });

  it('accepts an optional defaultDensity for carpet-style plants', () => {
    expect(validateCatalogEntry({ ...validPlant, defaultDensity: 40 })).toEqual({ ok: true });
  });

  it('rejects an unknown zone enum value', () => {
    expect(validateCatalogEntry({ ...validPlant, zone: 'middle' }).ok).toBe(false);
  });

  it('rejects an unknown lighting enum value', () => {
    expect(validateCatalogEntry({ ...validPlant, lighting: 'blazing' }).ok).toBe(false);
  });

  it('rejects an unknown co2 enum value', () => {
    expect(validateCatalogEntry({ ...validPlant, co2: 'occasional' }).ok).toBe(false);
  });

  it('rejects an unknown difficulty enum value', () => {
    expect(validateCatalogEntry({ ...validPlant, difficulty: 'expert' }).ok).toBe(false);
  });

  it('rejects weeksToMature <= 0', () => {
    expect(
      validateCatalogEntry({
        ...validPlant,
        growth: { weeksToMature: 0, sizeAtZero: 0.3 },
      }).ok,
    ).toBe(false);
  });

  it('rejects sizeAtZero outside [0, 1]', () => {
    expect(
      validateCatalogEntry({
        ...validPlant,
        growth: { weeksToMature: 6, sizeAtZero: 1.5 },
      }).ok,
    ).toBe(false);
    expect(
      validateCatalogEntry({
        ...validPlant,
        growth: { weeksToMature: 6, sizeAtZero: -0.1 },
      }).ok,
    ).toBe(false);
  });

  it('rejects defaultDensity <= 0', () => {
    expect(validateCatalogEntry({ ...validPlant, defaultDensity: 0 }).ok).toBe(false);
  });

  it('rejects a silhouette with fewer than 3 points', () => {
    expect(
      validateCatalogEntry({
        ...validPlant,
        silhouette: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      }).ok,
    ).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validPlant, surprise: true }).ok).toBe(false);
  });
});

describe('validateCatalogEntry (livestock, Stage 7 F7.1)', () => {
  const validLivestock = {
    catalog: 'core',
    id: 'livestock.fish.test',
    version: 1,
    name: 'Test fish',
    kind: 'livestock',
    group: 'fish',
    adultSize: 30,
    temperament: 'peaceful',
    temperatureRange: { minC: 22, maxC: 26 },
    pHRange: { min: 6.0, max: 7.5 },
    schoolingMin: 6,
    bioloadClass: 'low',
    color: '#abcdef',
  };

  it('accepts a well-formed livestock entry', () => {
    expect(validateCatalogEntry(validLivestock)).toEqual({ ok: true });
  });

  it('accepts optional compatibilityFlags', () => {
    expect(
      validateCatalogEntry({
        ...validLivestock,
        compatibilityFlags: { plantedOK: true, finNipper: false, brackish: false },
      }),
    ).toEqual({ ok: true });
  });

  it('rejects an unknown group enum value', () => {
    expect(validateCatalogEntry({ ...validLivestock, group: 'amphibian' }).ok).toBe(false);
  });

  it('rejects a negative adultSize', () => {
    expect(validateCatalogEntry({ ...validLivestock, adultSize: -5 }).ok).toBe(false);
  });

  it('rejects an unknown temperament enum value', () => {
    expect(validateCatalogEntry({ ...validLivestock, temperament: 'grumpy' }).ok).toBe(false);
  });

  it('rejects a schoolingMin below 1', () => {
    expect(validateCatalogEntry({ ...validLivestock, schoolingMin: 0 }).ok).toBe(false);
  });

  it('rejects a non-integer schoolingMin', () => {
    expect(validateCatalogEntry({ ...validLivestock, schoolingMin: 6.5 }).ok).toBe(false);
  });

  it('rejects an unknown bioloadClass enum value', () => {
    expect(validateCatalogEntry({ ...validLivestock, bioloadClass: 'apocalyptic' }).ok).toBe(false);
  });

  it('rejects a temperatureRange minC outside [0, 40]', () => {
    expect(
      validateCatalogEntry({
        ...validLivestock,
        temperatureRange: { minC: -5, maxC: 26 },
      }).ok,
    ).toBe(false);
    expect(
      validateCatalogEntry({
        ...validLivestock,
        temperatureRange: { minC: 22, maxC: 99 },
      }).ok,
    ).toBe(false);
  });

  it('rejects a pHRange outside [4.0, 9.5]', () => {
    expect(
      validateCatalogEntry({
        ...validLivestock,
        pHRange: { min: 3.0, max: 7.5 },
      }).ok,
    ).toBe(false);
    expect(
      validateCatalogEntry({
        ...validLivestock,
        pHRange: { min: 6.0, max: 12.0 },
      }).ok,
    ).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validLivestock, surprise: true }).ok).toBe(false);
  });

  it('rejects unknown keys in compatibilityFlags (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validLivestock,
        compatibilityFlags: { plantedOK: true, mystery: true },
      }).ok,
    ).toBe(false);
  });

  // ─── F11.2 behavior overrides (catalog manifest schemaVersion 3) ────────
  describe('behavior overrides (Stage 11 F11.2)', () => {
    it('accepts a livestock entry with no behavior block (forward-compat with v2 manifests)', () => {
      expect(validateCatalogEntry(validLivestock)).toEqual({ ok: true });
    });

    it('accepts an empty behavior block', () => {
      expect(validateCatalogEntry({ ...validLivestock, behavior: {} }).ok).toBe(true);
    });

    it('accepts a partial schooling override (single field)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { schooling: { wCoh: 1.5 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a partial depth override', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { depth: { preferredY: 0.88 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a partial animation override', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { animation: { tailBeatFreq: 6.0 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior block', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            schooling: {
              ZOR: 12,
              ZOO: 35,
              ZOA: 90,
              blindAngle: Math.PI * 0.25,
              vPref: 55,
              vMax: 140,
              turnMax: 2.0,
              wSep: 1.5,
              wAli: 1.5,
              wCoh: 1.0,
              noise: 0.05,
            },
            depth: { preferredY: 0.55, bandWidth: 0.25, returnForce: 60 },
            animation: { tailBeatFreq: 4.5, ampHead: 0.02, ampTail: 0.12, envelopeExp: 2.5 },
          },
        }).ok,
      ).toBe(true);
    });

    it('rejects a typo at the top of the behavior block (additionalProperties: false)', () => {
      const result = validateCatalogEntry({
        ...validLivestock,
        // typo: should be `schooling`. Must NOT be silently accepted.
        behavior: { schoolign: { wCoh: 1.5 } },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a typo inside behavior.schooling (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { schooling: { ZOR: 12, mystery: 99 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a typo inside behavior.depth (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { depth: { preferredZ: 0.5 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a typo inside behavior.animation (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { animation: { tailbeat: 4.5 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects depth.preferredY outside [0, 1]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { depth: { preferredY: 1.5 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { depth: { preferredY: -0.1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects depth.bandWidth outside [0, 1]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { depth: { bandWidth: 2 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects negative schooling weights', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { schooling: { wCoh: -1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects zero / negative schooling radii (exclusiveMinimum 0)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { schooling: { ZOR: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects animation.tailBeatFreq <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { animation: { tailBeatFreq: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects animation amplitude outside [0, 1]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { animation: { ampTail: 1.5 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects blindAngle outside [0, π]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { schooling: { blindAngle: Math.PI + 0.01 } },
        }).ok,
      ).toBe(false);
    });
  });

  // ─── F11.3 behavior extensions (additive, no schemaVersion bump) ─────────
  describe('behavior overrides (Stage 11 F11.3 — territory / nipping / fear)', () => {
    // territory ───────────────────────────────────────────────────────────
    it('accepts a partial behavior.territory object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { territory: { coreRadius: 60 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior.territory object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            territory: { coreRadius: 60, displayRadius: 120, aggression: 80, fatigueRate: 0.1 },
          },
        }).ok,
      ).toBe(true);
    });

    it('accepts an explicit null for behavior.territory (opt out)', () => {
      expect(
        validateCatalogEntry({ ...validLivestock, behavior: { territory: null } }).ok,
      ).toBe(true);
    });

    it('rejects a typo inside behavior.territory (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { territory: { coreRadius: 60, agression: 80 } }, // typo: agression
        }).ok,
      ).toBe(false);
    });

    it('rejects a zero / negative territory radius (exclusiveMinimum 0)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { territory: { coreRadius: 0 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { territory: { displayRadius: -10 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects an undefined-shaped territory (string instead of object|null)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { territory: 'high' },
        }).ok,
      ).toBe(false);
    });

    // nipping ─────────────────────────────────────────────────────────────
    it('accepts a partial behavior.nipping object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { groupThreshold: 8 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior.nipping object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            nipping: { groupThreshold: 8, finFraction: 0.3, rate: 0.05 },
          },
        }).ok,
      ).toBe(true);
    });

    it('accepts an explicit null for behavior.nipping (opt out)', () => {
      expect(
        validateCatalogEntry({ ...validLivestock, behavior: { nipping: null } }).ok,
      ).toBe(true);
    });

    it('rejects a typo inside behavior.nipping (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { groupThreshld: 8 } }, // typo
        }).ok,
      ).toBe(false);
    });

    it('rejects nipping.groupThreshold below 1', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { groupThreshold: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a non-integer nipping.groupThreshold', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { groupThreshold: 2.5 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects nipping.finFraction outside [0, 1]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { finFraction: 1.2 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { finFraction: -0.1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects nipping.rate <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { nipping: { rate: 0 } },
        }).ok,
      ).toBe(false);
    });

    // fear ────────────────────────────────────────────────────────────────
    it('accepts a partial behavior.fear object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { riskBaseline: 0.1 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior.fear object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            fear: {
              riskBaseline: 0.05,
              threshold: 0.7,
              coverPreference: 'plants',
              emergenceDelay: 8,
            },
          },
        }).ok,
      ).toBe(true);
    });

    it('rejects an explicit null for behavior.fear (no opt-out; fear is required at runtime)', () => {
      expect(
        validateCatalogEntry({ ...validLivestock, behavior: { fear: null } }).ok,
      ).toBe(false);
    });

    it('rejects a typo inside behavior.fear (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { thresold: 0.5 } }, // typo
        }).ok,
      ).toBe(false);
    });

    it('rejects fear.riskBaseline below 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { riskBaseline: -0.1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects fear.threshold <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { threshold: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects fear.emergenceDelay below 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { emergenceDelay: -1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects an unknown fear.coverPreference enum value', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { fear: { coverPreference: 'rocks' } }, // not in enum
        }).ok,
      ).toBe(false);
    });

    it('accepts every fear.coverPreference enum value', () => {
      for (const pref of ['plants', 'caves', 'wood', 'any']) {
        expect(
          validateCatalogEntry({
            ...validLivestock,
            behavior: { fear: { coverPreference: pref } },
          }).ok,
        ).toBe(true);
      }
    });

    // co-existence + forward compat ───────────────────────────────────────
    it('accepts F11.2 + F11.3 subfields together in one behavior block', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            schooling: { wCoh: 1.5 },
            depth: { preferredY: 0.4 },
            animation: { tailBeatFreq: 4 },
            territory: { coreRadius: 60 },
            nipping: null,
            fear: { riskBaseline: 0.1 },
          },
        }).ok,
      ).toBe(true);
    });
  });

  // ─── F11.4 behavior extensions (additive, no schemaVersion bump) ──────────
  describe('behavior overrides (Stage 11 F11.4 — feeding / curiosity)', () => {
    // feeding ────────────────────────────────────────────────────────────────
    it('accepts a partial behavior.feeding object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { category: 'algae-grazer' } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior.feeding object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            feeding: { hungerRatePerSec: 0.02, threshold: 0.8, category: 'midwater' },
          },
        }).ok,
      ).toBe(true);
    });

    it('accepts every feeding.category enum value', () => {
      for (const category of [
        'surface',
        'midwater',
        'substrate',
        'algae-grazer',
        'plant-eater',
        'detritivore',
      ]) {
        expect(
          validateCatalogEntry({
            ...validLivestock,
            behavior: { feeding: { category } },
          }).ok,
        ).toBe(true);
      }
    });

    it('rejects an unknown feeding.category enum value', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { category: 'invalid-category' } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a typo inside behavior.feeding (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { hungerRate: 0.02 } }, // typo: should be hungerRatePerSec
        }).ok,
      ).toBe(false);
    });

    it('rejects feeding.hungerRatePerSec <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { hungerRatePerSec: 0 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { hungerRatePerSec: -0.01 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects feeding.threshold <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { threshold: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('accepts feeding.threshold above 1 (deliberately permissive — no upper bound)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { feeding: { threshold: 1.5 } },
        }).ok,
      ).toBe(true);
    });

    it('rejects an explicit null for behavior.feeding (no opt-out; feeding is required at runtime)', () => {
      expect(
        validateCatalogEntry({ ...validLivestock, behavior: { feeding: null } }).ok,
      ).toBe(false);
    });

    // curiosity ──────────────────────────────────────────────────────────────
    it('accepts a partial behavior.curiosity object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { boldness: 0.7 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts a fully-specified behavior.curiosity object', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { boldness: 0.6, ratePerSec: 0.02, dwellSec: 5 } },
        }).ok,
      ).toBe(true);
    });

    it('accepts curiosity.ratePerSec = 0 (disables glass-surfing entirely)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { ratePerSec: 0 } },
        }).ok,
      ).toBe(true);
    });

    it('rejects a typo inside behavior.curiosity (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { bolness: 0.5 } }, // typo
        }).ok,
      ).toBe(false);
    });

    it('rejects curiosity.boldness outside [0, 1]', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { boldness: 1.5 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { boldness: -0.1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects curiosity.dwellSec <= 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { dwellSec: 0 } },
        }).ok,
      ).toBe(false);
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { dwellSec: -1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects curiosity.ratePerSec below 0', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: { curiosity: { ratePerSec: -0.01 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects an explicit null for behavior.curiosity (no opt-out at the type level)', () => {
      expect(
        validateCatalogEntry({ ...validLivestock, behavior: { curiosity: null } }).ok,
      ).toBe(false);
    });

    // co-existence ───────────────────────────────────────────────────────────
    it('accepts F11.2 + F11.3 + F11.4 subfields together in one behavior block', () => {
      expect(
        validateCatalogEntry({
          ...validLivestock,
          behavior: {
            schooling: { wCoh: 1.5 },
            depth: { preferredY: 0.4 },
            animation: { tailBeatFreq: 4 },
            territory: { coreRadius: 60 },
            nipping: null,
            fear: { riskBaseline: 0.1 },
            feeding: { category: 'midwater', hungerRatePerSec: 0.02 },
            curiosity: { boldness: 0.6, ratePerSec: 0.02, dwellSec: 5 },
          },
        }).ok,
      ).toBe(true);
    });
  });
});

describe('validateCatalogEntry (equipment, Stage 7 F7.3)', () => {
  const validEquipment = {
    catalog: 'core',
    id: 'equipment.filter.test',
    version: 1,
    name: 'Test filter',
    kind: 'equipment',
    category: 'filter',
    color: '#abcdef',
  };

  it('accepts a minimal well-formed equipment entry', () => {
    expect(validateCatalogEntry(validEquipment)).toEqual({ ok: true });
  });

  it('accepts every optional metadata field together', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        subcategory: 'canister',
        wattage: 16,
        flowRateLph: 1050,
        coverageLitres: { min: 100, max: 350 },
        defaultSettings: { flowPct: 100, label: 'main', enabled: true },
      }),
    ).toEqual({ ok: true });
  });

  it('accepts coverageLitres with only an upper bound', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        coverageLitres: { max: 30 },
      }),
    ).toEqual({ ok: true });
  });

  it('accepts coverageLitres with only a lower bound', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        coverageLitres: { min: 50 },
      }),
    ).toEqual({ ok: true });
  });

  it('accepts defaultSettings with string + number + boolean values', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        defaultSettings: {
          targetTemperatureC: 24,
          mode: 'auto',
          solenoidEnabled: true,
        },
      }),
    ).toEqual({ ok: true });
  });

  it('rejects an unknown category enum value', () => {
    expect(validateCatalogEntry({ ...validEquipment, category: 'skimmer' }).ok).toBe(false);
  });

  it('rejects a negative wattage', () => {
    expect(validateCatalogEntry({ ...validEquipment, wattage: -10 }).ok).toBe(false);
  });

  it('rejects a zero wattage (exclusiveMinimum 0)', () => {
    expect(validateCatalogEntry({ ...validEquipment, wattage: 0 }).ok).toBe(false);
  });

  it('rejects a negative flowRateLph', () => {
    expect(validateCatalogEntry({ ...validEquipment, flowRateLph: -50 }).ok).toBe(false);
  });

  it('rejects a non-integer coverageLitres.min', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        coverageLitres: { min: 50.5, max: 200 },
      }).ok,
    ).toBe(false);
  });

  it('rejects a zero coverageLitres.max', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        coverageLitres: { max: 0 },
      }).ok,
    ).toBe(false);
  });

  it('rejects a defaultSettings value with the wrong type (array)', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        defaultSettings: { schedule: [1, 2, 3] },
      }).ok,
    ).toBe(false);
  });

  it('rejects a defaultSettings value with the wrong type (object)', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        defaultSettings: { nested: { wattage: 10 } },
      }).ok,
    ).toBe(false);
  });

  it('rejects a defaultSettings value with the wrong type (null)', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        defaultSettings: { value: null },
      }).ok,
    ).toBe(false);
  });

  it('rejects a missing color', () => {
    const { color: _color, ...rest } = validEquipment;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing category', () => {
    const { category: _category, ...rest } = validEquipment;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validEquipment, surprise: true }).ok).toBe(false);
  });

  it('rejects unknown keys in coverageLitres (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validEquipment,
        coverageLitres: { min: 100, max: 300, optimal: 200 },
      }).ok,
    ).toBe(false);
  });
});

describe('formatError (defensive fallbacks)', () => {
  it('falls back to "invalid" when an AJV error lacks a message field', () => {
    const out = formatError({
      keyword: 'custom',
      instancePath: '/x',
      schemaPath: '#',
      params: {},
      // message intentionally absent
    } as never);
    expect(out.message).toBe('invalid');
    expect(out.path).toBe('/x');
  });

  it('falls back to "<root>" when instancePath is empty', () => {
    const out = formatError({
      keyword: 'type',
      instancePath: '',
      schemaPath: '#',
      params: {},
      message: 'expected object',
    } as never);
    expect(out.path).toBe('<root>');
  });
});
