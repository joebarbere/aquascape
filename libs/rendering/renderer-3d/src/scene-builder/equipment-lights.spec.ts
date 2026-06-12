import type { Catalog, CatalogEntry, CatalogKind } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';
import { Mesh, MeshStandardMaterial, SpotLight } from 'three';

import {
  DEFAULT_BEAM_ANGLE_DEG,
  DEFAULT_COLOR_TEMP_K,
  MAX_EQUIPMENT_SPOTLIGHTS,
  buildEquipmentLights,
  equipmentLightsTag,
  kelvinToColor,
} from './equipment-lights';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeCatalog(entries: CatalogEntry[]): Catalog {
  return {
    entries,
    get({ catalog, id }) {
      return entries.find((e) => e.catalog === catalog && e.id === id) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K): readonly Extract<CatalogEntry, { kind: K }>[] {
      return entries.filter((e): e is Extract<CatalogEntry, { kind: K }> => e.kind === kind);
    },
  };
}

const LIGHT_ENTRY: CatalogEntry = {
  catalog: 'core',
  id: 'equipment.light.test',
  version: 1,
  name: 'Test LED Bar',
  kind: 'equipment',
  category: 'light',
  color: '#fff2c0',
  light: { lumens: 2000, colorTempK: 7500, beamAngleDeg: 120, fixtureLengthMm: 500 },
};

const BARE_LIGHT_ENTRY: CatalogEntry = {
  catalog: 'core',
  id: 'equipment.light.bare',
  version: 1,
  name: 'Bare Light (no light block)',
  kind: 'equipment',
  category: 'light',
  color: '#ffffff',
};

const HEATER_ENTRY: CatalogEntry = {
  catalog: 'core',
  id: 'equipment.heater.test',
  version: 1,
  name: 'Test Heater',
  kind: 'equipment',
  category: 'heater',
  color: '#333333',
};

function sceneWith(equipmentRefIds: string[]): Scene {
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 300,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
    equipment: equipmentRefIds.map((id, i) => ({
      id: `eq-${i}`,
      ref: { catalog: 'core', id, version: 1 },
    })),
  };
}

function spotsOf(group: { children: readonly unknown[] }): SpotLight[] {
  return group.children.filter((c): c is SpotLight => (c as SpotLight).isSpotLight === true);
}

function housingsOf(group: { children: readonly unknown[] }): Mesh[] {
  return group.children.filter((c): c is Mesh => (c as Mesh).isMesh === true);
}

// ─── kelvinToColor ────────────────────────────────────────────────────────

describe('kelvinToColor', () => {
  it('3000 K is warm — red channel dominates blue', () => {
    const c = kelvinToColor(3000);
    expect(c.r).toBeGreaterThan(c.b);
    expect(c.r).toBeCloseTo(1, 5);
  });

  it('6500 K is near-white — all channels high and close', () => {
    const c = kelvinToColor(6500);
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.g).toBeGreaterThan(0.9);
    expect(c.b).toBeGreaterThan(0.9);
  });

  it('12000 K is cool — blue channel dominates red', () => {
    const c = kelvinToColor(12000);
    expect(c.b).toBeGreaterThan(c.r);
    expect(c.b).toBeCloseTo(1, 5);
  });

  it('clamps out-of-range inputs instead of producing NaN', () => {
    for (const k of [0, -500, 1e9]) {
      const c = kelvinToColor(k);
      expect(Number.isFinite(c.r)).toBe(true);
      expect(Number.isFinite(c.g)).toBe(true);
      expect(Number.isFinite(c.b)).toBe(true);
    }
  });
});

// ─── buildEquipmentLights ─────────────────────────────────────────────────

describe('buildEquipmentLights', () => {
  const catalog = makeCatalog([LIGHT_ENTRY, BARE_LIGHT_ENTRY, HEATER_ENTRY]);

  it('returns null when the scene has no equipment', () => {
    expect(buildEquipmentLights(sceneWith([]), catalog)).toBeNull();
  });

  it('returns null when no attached equipment is a light (heaters skipped)', () => {
    expect(buildEquipmentLights(sceneWith(['equipment.heater.test']), catalog)).toBeNull();
  });

  it('returns null without a catalog (nothing to resolve against)', () => {
    expect(buildEquipmentLights(sceneWith(['equipment.light.test']), undefined)).toBeNull();
  });

  it('one attached light builds one SpotLight + one fixture housing above the rim', () => {
    const handle = buildEquipmentLights(sceneWith(['equipment.light.test']), catalog);
    expect(handle).not.toBeNull();
    const spots = spotsOf(handle!.group);
    const housings = housingsOf(handle!.group);
    expect(spots).toHaveLength(1);
    expect(housings).toHaveLength(1);
    expect(handle!.spotCount).toBe(1);
    // Centred on the tank width, hung above the 360 mm rim.
    expect(spots[0]!.position.x).toBeCloseTo(300);
    expect(spots[0]!.position.y).toBeGreaterThan(360);
    // Aims straight down at the substrate.
    expect(spots[0]!.target.position.y).toBe(0);
    // No second shadow caster — the directional key owns shadows.
    expect(spots[0]!.castShadow).toBe(false);
    handle!.dispose();
  });

  it('uses the catalog light block — colour temp, beam angle, lumens scaling', () => {
    const handle = buildEquipmentLights(sceneWith(['equipment.light.test']), catalog)!;
    const bright = spotsOf(handle.group)[0]!;
    const handleBare = buildEquipmentLights(sceneWith(['equipment.light.bare']), catalog)!;
    const bare = spotsOf(handleBare.group)[0]!;
    // 2000 lm reads brighter than the 1200 lm default.
    expect(bright.intensity).toBeGreaterThan(bare.intensity);
    // 7500 K (cool) vs the 6500 K default — bluer.
    expect(bright.color.b).toBeGreaterThanOrEqual(bare.color.b);
    // 120° full beam → 60° half-angle in radians.
    expect(bright.angle).toBeCloseTo((120 / 2) * (Math.PI / 180), 5);
    expect(bare.angle).toBeCloseTo((DEFAULT_BEAM_ANGLE_DEG / 2) * (Math.PI / 180), 5);
    // Defaulted colour temp resolves to the documented constant's colour.
    const defaultColor = kelvinToColor(DEFAULT_COLOR_TEMP_K);
    expect(bare.color.getHex()).toBe(defaultColor.getHex());
    handle.dispose();
    handleBare.dispose();
  });

  it('distributes n fixtures evenly along the tank width in document order', () => {
    const handle = buildEquipmentLights(
      sceneWith(['equipment.light.test', 'equipment.light.bare']),
      catalog,
    )!;
    const spots = spotsOf(handle.group);
    expect(spots).toHaveLength(2);
    expect(spots[0]!.position.x).toBeCloseTo(150); // slot 1 of 2 on a 600 mm tank
    expect(spots[1]!.position.x).toBeCloseTo(450);
    handle.dispose();
  });

  it(`caps SpotLights at ${MAX_EQUIPMENT_SPOTLIGHTS} but keeps every fixture housing`, () => {
    const six = Array.from({ length: 6 }, () => 'equipment.light.bare');
    const handle = buildEquipmentLights(sceneWith(six), catalog)!;
    expect(handle.spotCount).toBe(MAX_EQUIPMENT_SPOTLIGHTS);
    expect(spotsOf(handle.group)).toHaveLength(MAX_EQUIPMENT_SPOTLIGHTS);
    expect(housingsOf(handle.group)).toHaveLength(6);
    handle.dispose();
  });

  it('setLevel scales spot intensity + fixture emissive; 0 turns lights off', () => {
    const handle = buildEquipmentLights(sceneWith(['equipment.light.test']), catalog)!;
    const spot = spotsOf(handle.group)[0]!;
    const housing = housingsOf(handle.group)[0]!;
    const mat = housing.material as MeshStandardMaterial;
    const fullIntensity = spot.intensity;
    handle.setLevel(0.5);
    expect(spot.intensity).toBeCloseTo(fullIntensity * 0.5, 5);
    handle.setLevel(0);
    expect(spot.intensity).toBe(0);
    expect(mat.emissiveIntensity).toBe(0);
    // Clamped — overdrive doesn't exceed the authored base.
    handle.setLevel(5);
    expect(spot.intensity).toBeCloseTo(fullIntensity, 5);
    handle.dispose();
  });

  it('dispose is idempotent and clears the group', () => {
    const handle = buildEquipmentLights(sceneWith(['equipment.light.test']), catalog)!;
    handle.dispose();
    expect(handle.group.children).toHaveLength(0);
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.setLevel(1)).not.toThrow(); // no-op after dispose
  });
});

// ─── equipmentLightsTag ───────────────────────────────────────────────────

describe('equipmentLightsTag', () => {
  it('is stable for the same scene and changes with the equipment set or tank', () => {
    const a = sceneWith(['equipment.light.test']);
    expect(equipmentLightsTag(a)).toBe(equipmentLightsTag(sceneWith(['equipment.light.test'])));
    expect(equipmentLightsTag(a)).not.toBe(equipmentLightsTag(sceneWith([])));
    expect(equipmentLightsTag(a)).not.toBe(
      equipmentLightsTag(sceneWith(['equipment.light.test', 'equipment.light.bare'])),
    );
    const resized = { ...a, tank: { ...a.tank, width: 900 } };
    expect(equipmentLightsTag(a)).not.toBe(equipmentLightsTag(resized));
  });
});
