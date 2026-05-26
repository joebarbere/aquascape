/**
 * Test fixtures for `domain/stocking` rule + aggregator specs.
 *
 * NOT part of the public API — co-located so specs share the same builders.
 * Hand-rolled minimal Scene + Catalog objects rather than pulling in the
 * full core catalog, because we want to (a) cover edge cases (zero tank
 * volume, missing refs, etc.) and (b) keep the tests fast + obvious.
 */

import type { CatalogRef, LivestockEntry, Scene } from '@aquascape/domain/scene-model';
import type {
  Catalog,
  CatalogEntry,
  CatalogKind,
  LivestockEntry as CatalogLivestockEntry,
} from '@aquascape/domain/catalog';

export const TANK_60L = { width: 600, depth: 300, height: 360 }; // 64.8 L
export const TANK_20L = { width: 400, depth: 200, height: 250 }; // 20.0 L
export const TANK_5L = { width: 200, depth: 200, height: 125 }; // 5.0 L

export interface LivestockSpecOverrides {
  adultSize?: number;
  temperament?: CatalogLivestockEntry['temperament'];
  temperatureRange?: { minC: number; maxC: number };
  pHRange?: { min: number; max: number };
  schoolingMin?: number;
  bioloadClass?: CatalogLivestockEntry['bioloadClass'];
  group?: CatalogLivestockEntry['group'];
  compatibilityFlags?: CatalogLivestockEntry['compatibilityFlags'];
  catalog?: string;
}

/** Build a minimal but valid catalog livestock entry. */
export function makeCatalogLivestock(
  id: string,
  name: string,
  overrides: LivestockSpecOverrides = {},
): CatalogLivestockEntry {
  return {
    catalog: overrides.catalog ?? 'core',
    id,
    version: 1,
    kind: 'livestock',
    name,
    group: overrides.group ?? 'fish',
    adultSize: overrides.adultSize ?? 30,
    temperament: overrides.temperament ?? 'peaceful',
    temperatureRange: overrides.temperatureRange ?? { minC: 22, maxC: 26 },
    pHRange: overrides.pHRange ?? { min: 6.5, max: 7.5 },
    schoolingMin: overrides.schoolingMin ?? 1,
    bioloadClass: overrides.bioloadClass ?? 'low',
    color: '#888888',
    ...(overrides.compatibilityFlags !== undefined
      ? { compatibilityFlags: overrides.compatibilityFlags }
      : {}),
  };
}

/** Build a non-livestock catalog entry (used for ref-kind-mismatch tests). */
export function makeCatalogSubstrate(id: string): CatalogEntry {
  return {
    catalog: 'core',
    id,
    version: 1,
    kind: 'substrate',
    name: 'Test soil',
    material: 'soil',
    color: '#3a261c',
  };
}

/** Build a scene livestock entry pointing at a catalog id. */
export function makeSceneEntry(
  id: string,
  catalogId: string,
  quantity = 1,
  catalogNamespace = 'core',
): LivestockEntry {
  const ref: CatalogRef = { catalog: catalogNamespace, id: catalogId, version: 1 };
  return { id, ref, quantity };
}

/** Build a minimal scene with the given tank dimensions + livestock list. */
export function makeScene(
  livestock: LivestockEntry[] | undefined,
  tank: { width: number; depth: number; height: number } = TANK_60L,
): Scene {
  return {
    tank: {
      width: tank.width,
      depth: tank.depth,
      height: tank.height,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
    ...(livestock !== undefined ? { livestock } : {}),
  };
}

/**
 * Build a minimal `Catalog` from a flat list of entries. Implements `get`
 * + `entries` + `byKind` so it's a drop-in for the real loader's return.
 */
export function makeCatalog(entries: CatalogEntry[]): Catalog {
  const byKey = new Map<string, CatalogEntry>();
  for (const e of entries) {
    byKey.set(`${e.catalog}::${e.id}`, e);
  }
  return {
    entries,
    get({ catalog, id }) {
      return byKey.get(`${catalog}::${id}`) ?? null;
    },
    byKind<K extends CatalogKind>(kind: K) {
      return entries.filter((e) => e.kind === kind) as Extract<CatalogEntry, { kind: K }>[];
    },
  };
}
