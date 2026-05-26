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
