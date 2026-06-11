import { Mesh, MeshStandardMaterial } from 'three';
import type { Catalog, CatalogEntry, CatalogKind, SubstrateEntry } from '@aquascape/domain/catalog';
import type { Scene, SubstrateRegion } from '@aquascape/domain/scene-model';
import { buildSubstrateMeshes } from './substrate-mesh';

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

function aquaSoil(color = '#2a2520'): SubstrateEntry {
  return {
    catalog: 'core',
    id: 'substrate.aquasoil.test',
    version: 1,
    name: 'Test Aquasoil',
    kind: 'substrate',
    material: 'soil',
    color,
  };
}

function region(over: Partial<SubstrateRegion> = {}): SubstrateRegion {
  return {
    id: 'r1',
    material: { catalog: 'core', id: 'substrate.aquasoil.test', version: 1 },
    fromX: 0,
    toX: 1,
    profile: [
      { x: 0, y: 30 },
      { x: 0.5, y: 50 },
      { x: 1, y: 30 },
    ],
    ...over,
  };
}

function makeScene(regions: SubstrateRegion[]): Scene {
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 300,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions },
    layers: [],
    seed: 1,
  };
}

describe('substrate-mesh builder', () => {
  it('produces one mesh per region using the catalog colour', () => {
    const catalog = makeCatalog([aquaSoil('#112233')]);
    const group = buildSubstrateMeshes(makeScene([region()]), catalog);
    expect(group.children.length).toBe(1);
    const mesh = group.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    const mat = mesh.material as MeshStandardMaterial;
    // Three.js Color stores as floats — compare via getHexString.
    expect(mat.color.getHexString()).toBe('112233');
  });

  it('falls back to the default colour when no catalog is supplied', () => {
    const group = buildSubstrateMeshes(makeScene([region()]), undefined);
    const mesh = group.children[0] as Mesh;
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('7b6a4a');
  });

  it('falls back to the default colour when the catalog entry is missing', () => {
    const catalog = makeCatalog([]);
    const group = buildSubstrateMeshes(makeScene([region()]), catalog);
    const mat = (group.children[0] as Mesh).material as MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('7b6a4a');
  });

  it('skips zero-width regions', () => {
    const group = buildSubstrateMeshes(
      makeScene([region({ fromX: 0.5, toX: 0.5 })]),
      undefined,
    );
    expect(group.children.length).toBe(0);
  });

  it('skips empty scenes', () => {
    const group = buildSubstrateMeshes(makeScene([]), undefined);
    expect(group.children.length).toBe(0);
  });

  it('skips scenes with degenerate tank dimensions', () => {
    const scene = makeScene([region()]);
    scene.tank = { ...scene.tank, width: 0 };
    const group = buildSubstrateMeshes(scene, undefined);
    expect(group.children.length).toBe(0);
  });

  it('receives shadows but does not cast them (fidelity pass)', () => {
    const group = buildSubstrateMeshes(makeScene([region()]), undefined);
    const mesh = group.children[0] as Mesh;
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.castShadow).toBe(false);
  });

  it('patches region materials with caustics and exposes them on group userData', () => {
    const group = buildSubstrateMeshes(makeScene([region()]), undefined);
    const mats = group.userData['aquascape:causticMaterials'] as MeshStandardMaterial[];
    expect(Array.isArray(mats)).toBe(true);
    expect(mats.length).toBe(1);
    expect(mats[0]!.userData['causticUniforms']).toBeDefined();
  });
});
