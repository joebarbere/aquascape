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
      expect(validateCatalogEntry({ ...validLivestock, behavior: { territory: null } }).ok).toBe(
        true,
      );
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
      expect(validateCatalogEntry({ ...validLivestock, behavior: { nipping: null } }).ok).toBe(
        true,
      );
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
      expect(validateCatalogEntry({ ...validLivestock, behavior: { fear: null } }).ok).toBe(false);
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
      expect(validateCatalogEntry({ ...validLivestock, behavior: { feeding: null } }).ok).toBe(
        false,
      );
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
      expect(validateCatalogEntry({ ...validLivestock, behavior: { curiosity: null } }).ok).toBe(
        false,
      );
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

  // ─── F11.5 flow + airRateMl (additive, no schemaVersion bump) ─────────────
  describe('flow + airRateMl (Stage 11 F11.5)', () => {
    it('accepts an equipment entry with no flow / airRateMl (forward-compat with v2/v3 manifests)', () => {
      expect(validateCatalogEntry(validEquipment).ok).toBe(true);
    });

    it('accepts an empty flow block', () => {
      expect(validateCatalogEntry({ ...validEquipment, flow: {} }).ok).toBe(true);
    });

    it('accepts a fully-specified flow block', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          flow: {
            outflowPos: { x: 550, y: 320, z: 40 },
            outflowVec: { x: -1, y: 0, z: 0 },
            intakePos: { x: 50, y: 80, z: 40 },
            flowRate: 700,
          },
        }).ok,
      ).toBe(true);
    });

    it('accepts a partial flow block (just flowRate)', () => {
      expect(validateCatalogEntry({ ...validEquipment, flow: { flowRate: 200 } }).ok).toBe(true);
    });

    it('accepts flowRate = 0 (sentinel for an equipped-but-off filter)', () => {
      expect(validateCatalogEntry({ ...validEquipment, flow: { flowRate: 0 } }).ok).toBe(true);
    });

    it('rejects a negative flowRate', () => {
      expect(validateCatalogEntry({ ...validEquipment, flow: { flowRate: -10 } }).ok).toBe(false);
    });

    it('rejects a typo at the top of the flow block (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          // typo: should be outflowVec
          flow: { outflowVc: { x: 0, y: 0, z: 1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a Vec3 with a missing axis on flow.outflowPos', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          flow: { outflowPos: { x: 0, y: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects extra keys inside a flow Vec3 (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          flow: { outflowPos: { x: 0, y: 0, z: 0, w: 1 } },
        }).ok,
      ).toBe(false);
    });

    it('rejects a non-numeric Vec3 axis on flow.outflowVec', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          flow: { outflowVec: { x: 'left', y: 0, z: 0 } },
        }).ok,
      ).toBe(false);
    });

    it('accepts airRateMl alongside flow', () => {
      expect(
        validateCatalogEntry({
          ...validEquipment,
          flow: { flowRate: 200 },
          airRateMl: 500,
        }).ok,
      ).toBe(true);
    });

    it('accepts airRateMl = 0 (sentinel for an air-stone with no visible bubbles)', () => {
      expect(validateCatalogEntry({ ...validEquipment, airRateMl: 0 }).ok).toBe(true);
    });

    it('rejects a negative airRateMl', () => {
      expect(validateCatalogEntry({ ...validEquipment, airRateMl: -50 }).ok).toBe(false);
    });

    it('rejects a non-numeric airRateMl', () => {
      expect(validateCatalogEntry({ ...validEquipment, airRateMl: 'lots' }).ok).toBe(false);
    });
  });

  // ─── light block (overhead equipment lighting; additive, no schemaVersion bump) ──
  describe('light (3D overhead equipment lighting)', () => {
    const validLight = {
      ...validEquipment,
      id: 'equipment.light.test',
      category: 'light',
    };

    it('accepts an equipment entry with no light block (forward-compat with older manifests)', () => {
      expect(validateCatalogEntry(validLight).ok).toBe(true);
    });

    it('accepts an empty light block (every subfield optional — renderer supplies defaults)', () => {
      expect(validateCatalogEntry({ ...validLight, light: {} }).ok).toBe(true);
    });

    it('accepts a fully-specified light block', () => {
      expect(
        validateCatalogEntry({
          ...validLight,
          light: { lumens: 2350, colorTempK: 6500, beamAngleDeg: 120, fixtureLengthMm: 610 },
        }),
      ).toEqual({ ok: true });
    });

    it('accepts a partial light block (lumens-omitted PAR-only vendor shape)', () => {
      expect(
        validateCatalogEntry({
          ...validLight,
          light: { colorTempK: 7500, beamAngleDeg: 130, fixtureLengthMm: 110 },
        }).ok,
      ).toBe(true);
    });

    it('rejects a typo inside the light block (additionalProperties: false)', () => {
      expect(
        validateCatalogEntry({
          ...validLight,
          // typo: should be colorTempK. Must NOT be silently accepted.
          light: { colourTempK: 6500 },
        }).ok,
      ).toBe(false);
    });

    it('rejects lumens <= 0 (exclusiveMinimum 0)', () => {
      expect(validateCatalogEntry({ ...validLight, light: { lumens: 0 } }).ok).toBe(false);
      expect(validateCatalogEntry({ ...validLight, light: { lumens: -100 } }).ok).toBe(false);
    });

    it('rejects colorTempK below 1000', () => {
      expect(validateCatalogEntry({ ...validLight, light: { colorTempK: 999 } }).ok).toBe(false);
    });

    it('rejects colorTempK above 20000', () => {
      expect(validateCatalogEntry({ ...validLight, light: { colorTempK: 20001 } }).ok).toBe(false);
    });

    it('accepts colorTempK at both bounds (1000 and 20000)', () => {
      expect(validateCatalogEntry({ ...validLight, light: { colorTempK: 1000 } }).ok).toBe(true);
      expect(validateCatalogEntry({ ...validLight, light: { colorTempK: 20000 } }).ok).toBe(true);
    });

    it('rejects beamAngleDeg <= 0 and > 180', () => {
      expect(validateCatalogEntry({ ...validLight, light: { beamAngleDeg: 0 } }).ok).toBe(false);
      expect(validateCatalogEntry({ ...validLight, light: { beamAngleDeg: 181 } }).ok).toBe(false);
    });

    it('accepts beamAngleDeg = 180 (inclusive upper bound)', () => {
      expect(validateCatalogEntry({ ...validLight, light: { beamAngleDeg: 180 } }).ok).toBe(true);
    });

    it('rejects fixtureLengthMm <= 0 (exclusiveMinimum 0)', () => {
      expect(validateCatalogEntry({ ...validLight, light: { fixtureLengthMm: 0 } }).ok).toBe(false);
    });

    it('rejects a non-numeric light subfield', () => {
      expect(validateCatalogEntry({ ...validLight, light: { lumens: 'bright' } }).ok).toBe(false);
    });

    it('accepts light alongside photoperiodHours (the F11.7 + overhead-lighting combo)', () => {
      expect(
        validateCatalogEntry({
          ...validLight,
          photoperiodHours: 8,
          light: { lumens: 4500, colorTempK: 4750, beamAngleDeg: 110, fixtureLengthMm: 613 },
        }).ok,
      ).toBe(true);
    });
  });

  // ─── F11.7 photoperiodHours (additive, no schemaVersion bump) ─────────────
  describe('photoperiodHours (Stage 11 F11.7)', () => {
    it('accepts an equipment entry with no photoperiodHours (forward-compat)', () => {
      expect(validateCatalogEntry(validEquipment).ok).toBe(true);
    });

    it('accepts a photoperiodHours value within [0, 24]', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: 10 }).ok).toBe(true);
    });

    it('accepts photoperiodHours = 0 (sentinel for lights-off cycle)', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: 0 }).ok).toBe(true);
    });

    it('accepts photoperiodHours = 24 (always-on cycle)', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: 24 }).ok).toBe(true);
    });

    it('rejects photoperiodHours below 0', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: -1 }).ok).toBe(false);
    });

    it('rejects photoperiodHours above 24', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: 25 }).ok).toBe(false);
    });

    it('rejects a non-numeric photoperiodHours', () => {
      expect(validateCatalogEntry({ ...validEquipment, photoperiodHours: 'all-day' }).ok).toBe(
        false,
      );
    });
  });
});

describe('validateCatalogEntry (decor — GLB-modelled ornaments, additive, no schemaVersion bump)', () => {
  const validDecor = {
    catalog: 'core',
    id: 'decor.test',
    version: 1,
    name: 'Test ornament',
    kind: 'decor',
    category: 'wreck',
    naturalSize: { width: 150, height: 120, depth: 110 },
    color: '#7a5230',
    silhouette: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
    model: 'treasure-chest.glb',
  };

  it('accepts a well-formed decor entry', () => {
    expect(validateCatalogEntry(validDecor)).toEqual({ ok: true });
  });

  it('accepts an optional subcategory field', () => {
    expect(validateCatalogEntry({ ...validDecor, subcategory: 'pirate' })).toEqual({ ok: true });
  });

  it('accepts every category enum value', () => {
    for (const category of ['wreck', 'ruin', 'bones', 'structure']) {
      expect(validateCatalogEntry({ ...validDecor, category }).ok).toBe(true);
    }
  });

  it('rejects a decor entry missing the REQUIRED model ref', () => {
    const { model: _model, ...rest } = validDecor;
    const result = validateCatalogEntry(rest);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown category enum value', () => {
    expect(validateCatalogEntry({ ...validDecor, category: 'spooky' }).ok).toBe(false);
  });

  it('rejects a model ref with a non-glb extension', () => {
    expect(validateCatalogEntry({ ...validDecor, model: 'treasure-chest.gltf' }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validDecor, model: 'treasure-chest.png' }).ok).toBe(false);
  });

  it('rejects an uppercase / whitespace / empty model ref (pattern guard)', () => {
    expect(validateCatalogEntry({ ...validDecor, model: 'Treasure-Chest.glb' }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validDecor, model: 'treasure chest.glb' }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validDecor, model: '' }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validDecor, model: '.glb' }).ok).toBe(false);
  });

  it('accepts a subdirectory-qualified model ref (pattern allows "/")', () => {
    expect(validateCatalogEntry({ ...validDecor, model: 'community/treasure-chest.glb' }).ok).toBe(
      true,
    );
  });

  it('rejects a non-string model ref', () => {
    expect(validateCatalogEntry({ ...validDecor, model: 42 }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad model ref', () => {
    const result = validateCatalogEntry({ ...validDecor, model: 'bad.gltf' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('model'))).toBe(true);
  });

  it('rejects a silhouette with fewer than 3 points', () => {
    expect(
      validateCatalogEntry({
        ...validDecor,
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
        ...validDecor,
        naturalSize: { width: 0, height: 120, depth: 110 },
      }).ok,
    ).toBe(false);
  });

  it('accepts coverScore in [0, 1] and rejects out-of-range values', () => {
    expect(validateCatalogEntry({ ...validDecor, coverScore: 0 }).ok).toBe(true);
    expect(validateCatalogEntry({ ...validDecor, coverScore: 0.7 }).ok).toBe(true);
    expect(validateCatalogEntry({ ...validDecor, coverScore: 1 }).ok).toBe(true);
    expect(validateCatalogEntry({ ...validDecor, coverScore: -0.1 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validDecor, coverScore: 1.5 }).ok).toBe(false);
  });

  it('rejects a textures block on decor (the GLB carries its own authored PBR materials)', () => {
    expect(
      validateCatalogEntry({
        ...validDecor,
        textures: { albedo: 'stone-gray.albedo.png' },
      }).ok,
    ).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validDecor, surprise: true }).ok).toBe(false);
  });
});

describe('validateCatalogEntry (textures — 3D-fidelity Bucket 2, additive, no schemaVersion bump)', () => {
  const fullTextures = {
    albedo: 'stone-gray.albedo.png',
    normal: 'stone-gray.normal.png',
    roughness: 'stone-gray.roughness.png',
  };

  const validSubstrate = {
    catalog: 'core',
    id: 'substrate.x.y',
    version: 1,
    name: 'X',
    kind: 'substrate',
    material: 'soil',
    color: '#abcdef',
  };

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

  const validEquipment = {
    catalog: 'core',
    id: 'equipment.filter.test',
    version: 1,
    name: 'Test filter',
    kind: 'equipment',
    category: 'filter',
    color: '#abcdef',
  };

  // ─── accepted on substrate / hardscape / plant ────────────────────────────
  it('accepts a full textures block on a substrate entry', () => {
    expect(validateCatalogEntry({ ...validSubstrate, textures: fullTextures })).toEqual({
      ok: true,
    });
  });

  it('accepts a full textures block on a hardscape entry', () => {
    expect(validateCatalogEntry({ ...validHardscape, textures: fullTextures })).toEqual({
      ok: true,
    });
  });

  it('accepts a full textures block on a plant entry', () => {
    expect(validateCatalogEntry({ ...validPlant, textures: fullTextures })).toEqual({ ok: true });
  });

  it('accepts a partial textures block (albedo only)', () => {
    expect(
      validateCatalogEntry({
        ...validSubstrate,
        textures: { albedo: 'soil-dark.albedo.png' },
      }).ok,
    ).toBe(true);
  });

  it('accepts an empty textures block (all maps optional)', () => {
    expect(validateCatalogEntry({ ...validHardscape, textures: {} }).ok).toBe(true);
  });

  it('accepts a subdirectory-qualified ref (pattern allows "/")', () => {
    expect(
      validateCatalogEntry({
        ...validPlant,
        textures: { albedo: 'community/leaf-fine.albedo.png' },
      }).ok,
    ).toBe(true);
  });

  it('accepts an entry without textures (procedural-only pre-Bucket-2 look)', () => {
    expect(validateCatalogEntry(validSubstrate).ok).toBe(true);
    expect(validateCatalogEntry(validHardscape).ok).toBe(true);
    expect(validateCatalogEntry(validPlant).ok).toBe(true);
  });

  // ─── rejected on livestock / equipment / tank ─────────────────────────────
  it('rejects textures on a livestock entry (deliberately excluded — InstancedMesh batching)', () => {
    expect(validateCatalogEntry({ ...validLivestock, textures: fullTextures }).ok).toBe(false);
  });

  it('rejects textures on an equipment entry', () => {
    expect(validateCatalogEntry({ ...validEquipment, textures: fullTextures }).ok).toBe(false);
  });

  it('rejects textures on a tank-kind entry (no tank branch shipped yet)', () => {
    expect(
      validateCatalogEntry({
        catalog: 'core',
        id: 'tank.test',
        version: 1,
        name: 'Test tank',
        kind: 'tank',
        textures: fullTextures,
      }).ok,
    ).toBe(false);
  });

  // ─── ref pattern ──────────────────────────────────────────────────────────
  it('rejects a non-png extension', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        textures: { albedo: 'stone-gray.albedo.jpg' },
      }).ok,
    ).toBe(false);
  });

  it('rejects an uppercase ref', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        textures: { albedo: 'Stone-Gray.albedo.png' },
      }).ok,
    ).toBe(false);
  });

  it('rejects an empty-string ref (bare ".png" needs at least one name char)', () => {
    expect(validateCatalogEntry({ ...validHardscape, textures: { albedo: '' } }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validHardscape, textures: { albedo: '.png' } }).ok).toBe(
      false,
    );
  });

  it('rejects a ref with whitespace', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        textures: { normal: 'stone gray.normal.png' },
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-string ref', () => {
    expect(validateCatalogEntry({ ...validHardscape, textures: { roughness: 42 } }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad ref', () => {
    const result = validateCatalogEntry({
      ...validSubstrate,
      textures: { albedo: 'soil-dark.albedo.jpeg' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('textures'))).toBe(true);
  });

  // ─── typo guard ───────────────────────────────────────────────────────────
  it('rejects a typo inside textures (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validPlant,
        // typo: should be `albedo`. Must NOT be silently accepted.
        textures: { albdeo: 'leaf-fine.albedo.png' },
      }).ok,
    ).toBe(false);
  });

  it('rejects an unknown extra map key inside textures', () => {
    expect(
      validateCatalogEntry({
        ...validHardscape,
        textures: { ...fullTextures, displacement: 'stone-gray.displacement.png' },
      }).ok,
    ).toBe(false);
  });
});

describe('validateCatalogEntry (nutrient — Nutrients & additives + dosing, F-A)', () => {
  const validDisclosed = {
    catalog: 'core',
    id: 'nutrient.macro.kno3',
    version: 1,
    name: 'Potassium Nitrate (KNO3)',
    kind: 'nutrient',
    category: 'macro-salt',
    brand: 'DIY dry salt',
    form: 'dry',
    formula: 'KNO3',
    dose: { amount: 0.3, unit: 'g', perLitres: 37.85 },
    contributes: { no3: 4.84, k: 3.1 },
    disclosed: true,
    affects: ['no3', 'k'],
    source: 'https://rotalabutterfly.com/rex-grigg/dosing.htm',
    color: '#e8e4d8',
    shrimpSafe: true,
  };

  const validProprietary = {
    catalog: 'core',
    id: 'nutrient.aio.easy-green',
    version: 1,
    name: 'Easy Green',
    kind: 'nutrient',
    category: 'all-in-one',
    brand: 'Aquarium Co-Op',
    form: 'liquid',
    dose: { amount: 1, unit: 'ml', perLitres: 37.85 },
    disclosed: false,
    affects: ['no3', 'po4', 'k', 'fe', 'traces'],
    color: '#4f9a5e',
  };

  it('accepts a well-formed disclosed (dry-salt) nutrient entry', () => {
    expect(validateCatalogEntry(validDisclosed)).toEqual({ ok: true });
  });

  it('accepts a well-formed proprietary (no-contributes) nutrient entry', () => {
    expect(validateCatalogEntry(validProprietary)).toEqual({ ok: true });
  });

  it('accepts every category enum value', () => {
    for (const category of [
      'macro-salt',
      'micro-trace',
      'all-in-one',
      'liquid-carbon',
      'conditioner',
      'remineralizer',
      'buffer',
      'bacteria',
    ]) {
      expect(validateCatalogEntry({ ...validProprietary, category }).ok).toBe(true);
    }
  });

  it('accepts every affects enum value', () => {
    for (const effect of [
      'no3',
      'po4',
      'k',
      'fe',
      'traces',
      'gh',
      'kh',
      'ph',
      'ammoniaDetox',
      'carbon',
      'bacteriaSeed',
      'dechlorinate',
    ]) {
      expect(validateCatalogEntry({ ...validProprietary, affects: [effect] }).ok).toBe(true);
    }
  });

  it('accepts a full contributes block (all eight axes)', () => {
    expect(
      validateCatalogEntry({
        ...validDisclosed,
        contributes: { no3: 5, po4: 1, k: 4, fe: 0.1, mg: 0.4, ca: 4, gh: 3, kh: 1 },
      }).ok,
    ).toBe(true);
  });

  // ─── required fields ──────────────────────────────────────────────────────
  it('rejects a missing category', () => {
    const { category: _c, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing brand', () => {
    const { brand: _b, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing form', () => {
    const { form: _f, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing dose', () => {
    const { dose: _d, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing disclosed flag', () => {
    const { disclosed: _d, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing affects list', () => {
    const { affects: _a, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects an empty affects array (minItems 1)', () => {
    expect(validateCatalogEntry({ ...validProprietary, affects: [] }).ok).toBe(false);
  });

  it('rejects a missing color', () => {
    const { color: _c, ...rest } = validProprietary;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  // ─── enum + value guards ──────────────────────────────────────────────────
  it('rejects an unknown category enum value', () => {
    expect(validateCatalogEntry({ ...validProprietary, category: 'root-tab' }).ok).toBe(false);
  });

  it('rejects an unknown affects enum value', () => {
    expect(validateCatalogEntry({ ...validProprietary, affects: ['silicate'] }).ok).toBe(false);
  });

  it('rejects an unknown form enum value', () => {
    expect(validateCatalogEntry({ ...validProprietary, form: 'gel' }).ok).toBe(false);
  });

  it('rejects an unknown dose.unit enum value', () => {
    expect(
      validateCatalogEntry({ ...validProprietary, dose: { amount: 1, unit: 'tsp', perLitres: 40 } })
        .ok,
    ).toBe(false);
  });

  it('rejects a zero / negative dose.amount (exclusiveMinimum 0)', () => {
    expect(
      validateCatalogEntry({ ...validProprietary, dose: { amount: 0, unit: 'ml', perLitres: 40 } })
        .ok,
    ).toBe(false);
  });

  it('rejects a zero / negative dose.perLitres', () => {
    expect(
      validateCatalogEntry({ ...validProprietary, dose: { amount: 1, unit: 'ml', perLitres: 0 } })
        .ok,
    ).toBe(false);
  });

  it('rejects a missing axis inside dose', () => {
    expect(validateCatalogEntry({ ...validProprietary, dose: { amount: 1, unit: 'ml' } }).ok).toBe(
      false,
    );
  });

  it('rejects extra keys inside dose (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validProprietary,
        dose: { amount: 1, unit: 'ml', perLitres: 40, frequency: 'weekly' },
      }).ok,
    ).toBe(false);
  });

  it('rejects a negative contributes value', () => {
    expect(validateCatalogEntry({ ...validDisclosed, contributes: { no3: -1 } }).ok).toBe(false);
  });

  it('rejects a typo inside contributes (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validDisclosed,
        // typo: should be no3
        contributes: { n03: 4.84 },
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-boolean disclosed flag', () => {
    expect(validateCatalogEntry({ ...validProprietary, disclosed: 'yes' }).ok).toBe(false);
  });

  it('rejects extraneous top-level properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validProprietary, surprise: true }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad contributes value', () => {
    const result = validateCatalogEntry({ ...validDisclosed, contributes: { fe: -0.1 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('contributes'))).toBe(true);
  });
});

describe('validateCatalogEntry (food — Stage 13 F13.4 husbandry sim)', () => {
  const validFood = {
    catalog: 'core',
    id: 'food.flake.test',
    version: 1,
    name: 'Test flake',
    kind: 'food',
    type: 'flake',
    brand: 'Tetra',
    proteinPct: 46,
    wasteFactor: 0.4,
    color: '#c97f3a',
    source: 'https://example.com',
  };

  // A whole live food with no published protein label (proteinPct omitted).
  const validLiveFood = {
    catalog: 'core',
    id: 'food.live.test',
    version: 1,
    name: 'Test live food',
    kind: 'food',
    type: 'live',
    brand: 'DIY / frozen',
    wasteFactor: 0.15,
    color: '#a3242b',
  };

  it('accepts a well-formed food entry with a published proteinPct', () => {
    expect(validateCatalogEntry(validFood)).toEqual({ ok: true });
  });

  it('accepts a live food entry with proteinPct omitted (no standardized label)', () => {
    expect(validateCatalogEntry(validLiveFood)).toEqual({ ok: true });
  });

  it('accepts every food type enum value', () => {
    for (const type of ['flake', 'pellet', 'wafer', 'live']) {
      expect(validateCatalogEntry({ ...validFood, type }).ok).toBe(true);
    }
  });

  it('rejects an unknown food type enum value', () => {
    expect(validateCatalogEntry({ ...validFood, type: 'gel' }).ok).toBe(false);
  });

  it('rejects a missing type', () => {
    const { type: _t, ...rest } = validFood;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing brand', () => {
    const { brand: _b, ...rest } = validFood;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing wasteFactor (required source term for Stage 14)', () => {
    const { wasteFactor: _w, ...rest } = validFood;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a missing color', () => {
    const { color: _c, ...rest } = validFood;
    expect(validateCatalogEntry(rest).ok).toBe(false);
  });

  it('rejects a wasteFactor outside [0, 1]', () => {
    expect(validateCatalogEntry({ ...validFood, wasteFactor: -0.1 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validFood, wasteFactor: 1.5 }).ok).toBe(false);
  });

  it('accepts wasteFactor at both bounds (0 and 1)', () => {
    expect(validateCatalogEntry({ ...validFood, wasteFactor: 0 }).ok).toBe(true);
    expect(validateCatalogEntry({ ...validFood, wasteFactor: 1 }).ok).toBe(true);
  });

  it('rejects a proteinPct outside [0, 100]', () => {
    expect(validateCatalogEntry({ ...validFood, proteinPct: -1 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validFood, proteinPct: 101 }).ok).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validFood, surprise: true }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad wasteFactor', () => {
    const result = validateCatalogEntry({ ...validFood, wasteFactor: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('wasteFactor'))).toBe(true);
  });
});

describe('validateCatalogEntry (algae — Stage 13 F13.4 husbandry sim)', () => {
  const validAlgae = {
    catalog: 'core',
    id: 'algae.test',
    version: 1,
    name: 'Test algae',
    kind: 'algae',
    type: 'hair',
    growthRate: 0.85,
    lightDependence: 0.85,
    grazers: ['shrimp', 'siamese-algae-eater'],
    color: '#6fae45',
  };

  it('accepts a well-formed algae entry', () => {
    expect(validateCatalogEntry(validAlgae)).toEqual({ ok: true });
  });

  it('accepts every algae type enum value (must match water-sim AlgaeType)', () => {
    for (const type of ['green-spot', 'hair', 'black-beard', 'diatom']) {
      expect(validateCatalogEntry({ ...validAlgae, type }).ok).toBe(true);
    }
  });

  it('rejects an unknown algae type enum value', () => {
    expect(validateCatalogEntry({ ...validAlgae, type: 'staghorn' }).ok).toBe(false);
  });

  it('accepts every grazer enum value', () => {
    for (const grazer of [
      'oto',
      'shrimp',
      'nerite-snail',
      'siamese-algae-eater',
      'pleco',
      'nobody',
    ]) {
      expect(validateCatalogEntry({ ...validAlgae, grazers: [grazer] }).ok).toBe(true);
    }
  });

  it('rejects an unknown grazer enum value', () => {
    expect(validateCatalogEntry({ ...validAlgae, grazers: ['hippo'] }).ok).toBe(false);
  });

  it('rejects an empty grazers array (minItems 1)', () => {
    expect(validateCatalogEntry({ ...validAlgae, grazers: [] }).ok).toBe(false);
  });

  it('rejects a growthRate of 0 (exclusiveMinimum 0) or above 1', () => {
    expect(validateCatalogEntry({ ...validAlgae, growthRate: 0 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validAlgae, growthRate: 1.2 }).ok).toBe(false);
  });

  it('accepts growthRate = 1 (the fastest-in-set bound)', () => {
    expect(validateCatalogEntry({ ...validAlgae, growthRate: 1 }).ok).toBe(true);
  });

  it('rejects a lightDependence outside [0, 1]', () => {
    expect(validateCatalogEntry({ ...validAlgae, lightDependence: -0.1 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validAlgae, lightDependence: 1.5 }).ok).toBe(false);
  });

  it('accepts lightDependence = 0 (shade-tolerant extreme)', () => {
    expect(validateCatalogEntry({ ...validAlgae, lightDependence: 0 }).ok).toBe(true);
  });

  it('rejects a missing required field (type / growthRate / grazers / color)', () => {
    for (const key of ['type', 'growthRate', 'lightDependence', 'grazers', 'color']) {
      const rest = { ...validAlgae };
      delete (rest as Record<string, unknown>)[key];
      expect(validateCatalogEntry(rest).ok).toBe(false);
    }
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validAlgae, surprise: true }).ok).toBe(false);
  });
});

describe('validateCatalogEntry (water-test-kit — Stage 13 F13.4 husbandry sim)', () => {
  const validKit = {
    catalog: 'core',
    id: 'water-test-kit.test',
    version: 1,
    name: 'Test kit',
    kind: 'water-test-kit',
    brand: 'API',
    method: 'liquid',
    reads: [
      { parameter: 'ammonia', min: 0, max: 8, unit: 'ppm' },
      { parameter: 'nitrate', min: 0, max: 160, unit: 'ppm' },
    ],
    color: '#2f6fb0',
    source: 'https://example.com',
  };

  it('accepts a well-formed water-test-kit entry', () => {
    expect(validateCatalogEntry(validKit)).toEqual({ ok: true });
  });

  it('accepts every method enum value', () => {
    for (const method of ['liquid', 'strip', 'drop-checker']) {
      expect(validateCatalogEntry({ ...validKit, method }).ok).toBe(true);
    }
  });

  it('rejects an unknown method enum value', () => {
    expect(validateCatalogEntry({ ...validKit, method: 'refractometer' }).ok).toBe(false);
  });

  it('accepts every water parameter enum value', () => {
    for (const parameter of [
      'ammonia',
      'nitrite',
      'nitrate',
      'ph',
      'kh',
      'gh',
      'phosphate',
      'co2',
    ]) {
      expect(
        validateCatalogEntry({
          ...validKit,
          reads: [{ parameter, min: 0, max: 10, unit: 'ppm' }],
        }).ok,
      ).toBe(true);
    }
  });

  it('rejects an unknown parameter enum value inside a reading', () => {
    expect(
      validateCatalogEntry({
        ...validKit,
        reads: [{ parameter: 'silicate', min: 0, max: 10, unit: 'ppm' }],
      }).ok,
    ).toBe(false);
  });

  it('accepts every reading unit enum value', () => {
    for (const unit of ['ppm', 'dKH', 'dGH', 'pH', 'other']) {
      expect(
        validateCatalogEntry({
          ...validKit,
          reads: [{ parameter: 'ph', min: 6, max: 8, unit }],
        }).ok,
      ).toBe(true);
    }
  });

  it('rejects an unknown reading unit enum value', () => {
    expect(
      validateCatalogEntry({
        ...validKit,
        reads: [{ parameter: 'nitrate', min: 0, max: 160, unit: 'mg-per-litre' }],
      }).ok,
    ).toBe(false);
  });

  it('rejects an empty reads array (minItems 1)', () => {
    expect(validateCatalogEntry({ ...validKit, reads: [] }).ok).toBe(false);
  });

  it('rejects a reading missing a required field', () => {
    for (const key of ['parameter', 'min', 'max', 'unit']) {
      const reading: Record<string, unknown> = {
        parameter: 'nitrate',
        min: 0,
        max: 160,
        unit: 'ppm',
      };
      delete reading[key];
      expect(validateCatalogEntry({ ...validKit, reads: [reading] }).ok).toBe(false);
    }
  });

  it('rejects extra keys inside a reading (additionalProperties: false)', () => {
    expect(
      validateCatalogEntry({
        ...validKit,
        reads: [{ parameter: 'nitrate', min: 0, max: 160, unit: 'ppm', accuracy: 5 }],
      }).ok,
    ).toBe(false);
  });

  it('rejects a missing required top-level field (brand / method / reads / color)', () => {
    for (const key of ['brand', 'method', 'reads', 'color']) {
      const rest = { ...validKit };
      delete (rest as Record<string, unknown>)[key];
      expect(validateCatalogEntry(rest).ok).toBe(false);
    }
  });

  it('rejects extraneous top-level properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validKit, surprise: true }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad reading unit', () => {
    const result = validateCatalogEntry({
      ...validKit,
      reads: [{ parameter: 'nitrate', min: 0, max: 160, unit: 'bad' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('reads'))).toBe(true);
  });
});

describe('validateCatalogEntry (cleaning-tool — Stage 16 F16.5a cleaner game mode)', () => {
  const validScraper = {
    catalog: 'core',
    id: 'cleaning-tool.scraper.test',
    version: 1,
    name: 'Test scraper',
    kind: 'cleaning-tool',
    type: 'scraper',
    brand: 'Mag-Float',
    surfaces: ['glass'],
    targetAlgae: ['green-spot'],
    effectiveness: 0.7,
    reachMm: 90,
    color: '#3f6fa0',
  };

  const validBrush = {
    catalog: 'core',
    id: 'cleaning-tool.brush.test',
    version: 1,
    name: 'Test brush',
    kind: 'cleaning-tool',
    type: 'brush',
    surfaces: ['hardscape'],
    targetAlgae: ['black-beard', 'hair'],
    effectiveness: 0.55,
    color: '#5c8c52',
  };

  const validSiphon = {
    catalog: 'core',
    id: 'cleaning-tool.siphon.test',
    version: 1,
    name: 'Test siphon',
    kind: 'cleaning-tool',
    type: 'siphon',
    surfaces: ['substrate'],
    targetAlgae: [],
    effectiveness: 0.7,
    removesWaste: true,
    color: '#7a6a4f',
  };

  it('accepts a well-formed scraper entry', () => {
    expect(validateCatalogEntry(validScraper)).toEqual({ ok: true });
  });

  it('accepts a well-formed brush entry (one representative per type)', () => {
    expect(validateCatalogEntry(validBrush)).toEqual({ ok: true });
  });

  it('accepts a well-formed siphon entry with removesWaste + an empty targetAlgae list', () => {
    expect(validateCatalogEntry(validSiphon)).toEqual({ ok: true });
  });

  it('accepts every tool type enum value', () => {
    for (const type of ['scraper', 'brush', 'siphon']) {
      expect(validateCatalogEntry({ ...validScraper, type }).ok).toBe(true);
    }
  });

  it('rejects an unknown tool type enum value', () => {
    expect(validateCatalogEntry({ ...validScraper, type: 'pressure-washer' }).ok).toBe(false);
  });

  it('accepts every surface enum value', () => {
    for (const surface of ['glass', 'hardscape', 'substrate']) {
      expect(validateCatalogEntry({ ...validScraper, surfaces: [surface] }).ok).toBe(true);
    }
  });

  it('rejects an unknown surface enum value', () => {
    expect(validateCatalogEntry({ ...validScraper, surfaces: ['ceiling'] }).ok).toBe(false);
  });

  it('rejects an empty surfaces array (minItems 1)', () => {
    expect(validateCatalogEntry({ ...validScraper, surfaces: [] }).ok).toBe(false);
  });

  it('accepts every targetAlgae enum value (must match water-sim AlgaeType)', () => {
    for (const algae of ['green-spot', 'hair', 'black-beard', 'diatom']) {
      expect(validateCatalogEntry({ ...validScraper, targetAlgae: [algae] }).ok).toBe(true);
    }
  });

  it('rejects an unknown targetAlgae enum value', () => {
    expect(validateCatalogEntry({ ...validScraper, targetAlgae: ['staghorn'] }).ok).toBe(false);
  });

  it('accepts an empty targetAlgae array (a pure waste tool)', () => {
    expect(validateCatalogEntry({ ...validScraper, targetAlgae: [] }).ok).toBe(true);
  });

  it('rejects an effectiveness of 0 (exclusiveMinimum 0) or above 1', () => {
    expect(validateCatalogEntry({ ...validScraper, effectiveness: 0 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validScraper, effectiveness: 1.2 }).ok).toBe(false);
  });

  it('accepts effectiveness = 1 (single-pass clear bound)', () => {
    expect(validateCatalogEntry({ ...validScraper, effectiveness: 1 }).ok).toBe(true);
  });

  it('rejects a reachMm of 0 or negative (exclusiveMinimum 0)', () => {
    expect(validateCatalogEntry({ ...validScraper, reachMm: 0 }).ok).toBe(false);
    expect(validateCatalogEntry({ ...validScraper, reachMm: -10 }).ok).toBe(false);
  });

  it('accepts an entry with no reachMm (game uses the per-type default)', () => {
    const { reachMm: _reachMm, ...rest } = validScraper;
    expect(validateCatalogEntry(rest).ok).toBe(true);
  });

  it('accepts removesWaste as a boolean and rejects a non-boolean', () => {
    expect(validateCatalogEntry({ ...validScraper, removesWaste: false }).ok).toBe(true);
    expect(validateCatalogEntry({ ...validScraper, removesWaste: 'yes' }).ok).toBe(false);
  });

  it('rejects a missing required field (type / surfaces / targetAlgae / effectiveness / color)', () => {
    for (const key of ['type', 'surfaces', 'targetAlgae', 'effectiveness', 'color']) {
      const rest = { ...validScraper };
      delete (rest as Record<string, unknown>)[key];
      expect(validateCatalogEntry(rest).ok).toBe(false);
    }
  });

  it('rejects an invalid color', () => {
    expect(validateCatalogEntry({ ...validScraper, color: 'not-a-color' }).ok).toBe(false);
  });

  it('rejects extraneous properties (additionalProperties: false)', () => {
    expect(validateCatalogEntry({ ...validScraper, surprise: true }).ok).toBe(false);
  });

  it('surfaces the offending path on a bad targetAlgae value', () => {
    const result = validateCatalogEntry({ ...validScraper, targetAlgae: ['bad'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('targetAlgae'))).toBe(true);
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
