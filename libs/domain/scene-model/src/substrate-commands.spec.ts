import { applyCommand, invertCommand } from './commands';
import {
  addSubstrateRegion,
  applySubstrateCommand,
  asRegionId,
  invertSubstrateCommand,
  removeSubstrateRegion,
  setSubstrateRegionExtent,
  setSubstrateRegionMaterial,
  setSubstrateRegionProfile,
  validateSubstrateRegion,
} from './substrate-commands';
import type { CatalogRef, Scene, SubstrateRegion } from './types';

// ── Test fixtures ───────────────────────────────────────────────────────

const SAND: CatalogRef = { catalog: 'core', id: 'substrate.sand.silica', version: 1 };
const SOIL: CatalogRef = { catalog: 'core', id: 'substrate.aquasoil.amazonia', version: 1 };

function emptyScene(): Scene {
  return {
    tank: {
      width: 600,
      height: 360,
      depth: 360,
      style: { frame: 'rimless', background: { kind: 'none' } },
    },
    substrate: { regions: [] },
    layers: [],
    seed: 0,
  };
}

function region(overrides: Partial<SubstrateRegion> = {}): SubstrateRegion {
  return {
    id: asRegionId('region-1'),
    material: SAND,
    fromX: 0,
    toX: 1,
    profile: [
      { x: 0, y: 40 },
      { x: 1, y: 40 },
    ],
    ...overrides,
  };
}

// ── validateSubstrateRegion ──────────────────────────────────────────────

describe('validateSubstrateRegion', () => {
  it('accepts a well-formed region', () => {
    expect(validateSubstrateRegion(region())).toBeNull();
  });

  it('rejects empty id', () => {
    expect(validateSubstrateRegion(region({ id: '' as never }))).toMatch(/id/);
  });

  it('rejects bad catalog ref', () => {
    expect(
      validateSubstrateRegion(region({ material: { catalog: '', id: '', version: 0 } as never })),
    ).toMatch(/material/);
  });

  it('rejects fromX outside [0, 1]', () => {
    expect(validateSubstrateRegion(region({ fromX: -0.1 }))).toMatch(/fromX/);
    expect(validateSubstrateRegion(region({ fromX: 1.5 }))).toMatch(/fromX/);
  });

  it('rejects toX outside [0, 1]', () => {
    expect(validateSubstrateRegion(region({ toX: -1 }))).toMatch(/toX/);
    expect(validateSubstrateRegion(region({ toX: 2 }))).toMatch(/toX/);
  });

  it('rejects fromX > toX', () => {
    expect(validateSubstrateRegion(region({ fromX: 0.7, toX: 0.2 }))).toMatch(/fromX.*toX/);
  });

  it('rejects negative blend', () => {
    expect(validateSubstrateRegion(region({ blend: -1 }))).toMatch(/blend/);
  });

  it('accepts a region without blend', () => {
    expect(validateSubstrateRegion(region())).toBeNull();
  });

  it('rejects profile with < 2 points', () => {
    expect(validateSubstrateRegion(region({ profile: [{ x: 0, y: 10 }] }))).toMatch(/profile/);
  });

  it('rejects profile.x out of [0, 1]', () => {
    expect(
      validateSubstrateRegion(
        region({
          profile: [
            { x: -0.1, y: 10 },
            { x: 1, y: 20 },
          ],
        }),
      ),
    ).toMatch(/profile\[0\].x/);
  });

  it('rejects profile.y negative', () => {
    expect(
      validateSubstrateRegion(
        region({
          profile: [
            { x: 0, y: -5 },
            { x: 1, y: 10 },
          ],
        }),
      ),
    ).toMatch(/profile\[0\].y/);
  });

  it('rejects profile not sorted ascending by x', () => {
    expect(
      validateSubstrateRegion(
        region({
          profile: [
            { x: 0, y: 10 },
            { x: 0.5, y: 20 },
            { x: 0.3, y: 30 },
          ],
        }),
      ),
    ).toMatch(/sorted/);
  });
});

// ── applySubstrateCommand ───────────────────────────────────────────────

describe('AddSubstrateRegion', () => {
  it('appends a region by default', () => {
    const cmd = addSubstrateRegion(region({ id: asRegionId('r-1') }));
    const result = applySubstrateCommand(emptyScene(), cmd);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions.map((r) => r.id)).toEqual(['r-1']);
  });

  it('inserts at the given index', () => {
    const a = region({ id: asRegionId('a') });
    const b = region({ id: asRegionId('b') });
    const c = region({ id: asRegionId('c') });
    let scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(a)).scene as Scene;
    scene = applySubstrateCommand(scene, addSubstrateRegion(b)).scene as Scene;
    scene = applySubstrateCommand(scene, addSubstrateRegion(c, 1)).scene as Scene;
    expect(scene.substrate.regions.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('rejects an invalid region', () => {
    const result = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ fromX: 1.5 })),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      message: expect.stringMatching(/AddSubstrateRegion/),
    });
  });

  it('rejects a duplicate id', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('dup') })),
    ).scene as Scene;
    const result = applySubstrateCommand(
      scene,
      addSubstrateRegion(region({ id: asRegionId('dup') })),
    );
    expect(result.ok).toBe(false);
  });

  it('clamps an out-of-range insertion index to append', () => {
    const a = region({ id: asRegionId('a') });
    const b = region({ id: asRegionId('b') });
    let scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(a)).scene as Scene;
    scene = applySubstrateCommand(scene, addSubstrateRegion(b, 99)).scene as Scene;
    expect(scene.substrate.regions.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('RemoveSubstrateRegion', () => {
  it('removes a known region', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x') })),
    ).scene as Scene;
    const result = applySubstrateCommand(scene, removeSubstrateRegion(asRegionId('x')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions).toEqual([]);
  });

  it('reports not-found for unknown id', () => {
    const result = applySubstrateCommand(emptyScene(), removeSubstrateRegion(asRegionId('nope')));
    expect(result).toEqual({
      ok: false,
      reason: 'not-found',
      message: expect.stringMatching(/RemoveSubstrateRegion/),
    });
  });
});

describe('SetSubstrateRegionMaterial', () => {
  it('replaces the material', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), material: SAND })),
    ).scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionMaterial(asRegionId('x'), SOIL),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions[0]?.material).toEqual(SOIL);
  });

  it('rejects a bad catalog ref shape', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionMaterial(asRegionId('x'), { catalog: '', id: '', version: 0 } as never),
    );
    expect(result.ok).toBe(false);
  });

  it('reports not-found for unknown id', () => {
    expect(
      applySubstrateCommand(emptyScene(), setSubstrateRegionMaterial(asRegionId('nope'), SAND)).ok,
    ).toBe(false);
  });
});

describe('SetSubstrateRegionExtent', () => {
  it('updates fromX / toX, preserves blend by default', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), blend: 5 })),
    ).scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0.1, toX: 0.4 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions[0]?.fromX).toBe(0.1);
    expect(result.scene.substrate.regions[0]?.toX).toBe(0.4);
    expect(result.scene.substrate.regions[0]?.blend).toBe(5);
  });

  it('updates blend when supplied as a number', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0, toX: 1, blend: 12 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions[0]?.blend).toBe(12);
  });

  it('removes blend when passed null', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), blend: 5 })),
    ).scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0, toX: 1, blend: null }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('blend' in result.scene.substrate.regions[0]!).toBe(false);
  });

  it('rejects fromX > toX', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0.8, toX: 0.2 }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects negative blend', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0, toX: 1, blend: -1 }),
    );
    expect(result.ok).toBe(false);
  });

  it('reports not-found for unknown id', () => {
    expect(
      applySubstrateCommand(
        emptyScene(),
        setSubstrateRegionExtent({ regionId: asRegionId('nope'), fromX: 0, toX: 1 }),
      ).ok,
    ).toBe(false);
  });
});

describe('SetSubstrateRegionProfile', () => {
  it('replaces the profile', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionProfile(asRegionId('x'), [
        { x: 0, y: 10 },
        { x: 0.5, y: 80 },
        { x: 1, y: 30 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.substrate.regions[0]?.profile.length).toBe(3);
  });

  it('rejects an invalid profile', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const result = applySubstrateCommand(
      scene,
      setSubstrateRegionProfile(asRegionId('x'), [{ x: 0, y: 10 }]),
    );
    expect(result.ok).toBe(false);
  });

  it('reports not-found for unknown id', () => {
    expect(
      applySubstrateCommand(
        emptyScene(),
        setSubstrateRegionProfile(asRegionId('nope'), [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]),
      ).ok,
    ).toBe(false);
  });
});

// ── invertSubstrateCommand ──────────────────────────────────────────────

describe('invertSubstrateCommand', () => {
  it('AddSubstrateRegion inverts to RemoveSubstrateRegion', () => {
    const cmd = addSubstrateRegion(region({ id: asRegionId('x') }));
    const inv = invertSubstrateCommand(emptyScene(), cmd);
    expect(inv).toEqual({ kind: 'RemoveSubstrateRegion', regionId: 'x' });
  });

  it('RemoveSubstrateRegion inverts to AddSubstrateRegion at the prior index', () => {
    let scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('a') })),
    ).scene as Scene;
    scene = applySubstrateCommand(scene, addSubstrateRegion(region({ id: asRegionId('b') })))
      .scene as Scene;
    const inv = invertSubstrateCommand(scene, removeSubstrateRegion(asRegionId('b')));
    expect(inv).toMatchObject({ kind: 'AddSubstrateRegion', index: 1 });
  });

  it('RemoveSubstrateRegion of unknown id inverts to Noop', () => {
    const inv = invertSubstrateCommand(emptyScene(), removeSubstrateRegion(asRegionId('nope')));
    expect(inv).toEqual({ kind: 'Noop' });
  });

  it('SetSubstrateRegionMaterial inverts back to previous material', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), material: SAND })),
    ).scene as Scene;
    const cmd = setSubstrateRegionMaterial(asRegionId('x'), SOIL);
    const inv = invertSubstrateCommand(scene, cmd);
    expect(inv).toMatchObject({
      kind: 'SetSubstrateRegionMaterial',
      regionId: 'x',
      material: SAND,
    });
  });

  it('SetSubstrateRegionMaterial of unknown id inverts to Noop', () => {
    expect(invertSubstrateCommand(emptyScene(), setSubstrateRegionMaterial(asRegionId('nope'), SAND))).toEqual({
      kind: 'Noop',
    });
  });

  it('SetSubstrateRegionExtent inverts back to previous extent (with blend present)', () => {
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), fromX: 0.1, toX: 0.4, blend: 5 })),
    ).scene as Scene;
    const cmd = setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0, toX: 1 });
    const inv = invertSubstrateCommand(scene, cmd);
    expect(inv).toMatchObject({
      kind: 'SetSubstrateRegionExtent',
      regionId: 'x',
      fromX: 0.1,
      toX: 0.4,
      blend: 5,
    });
  });

  it('SetSubstrateRegionExtent inverts with blend=null when no prior blend', () => {
    const scene = applySubstrateCommand(emptyScene(), addSubstrateRegion(region({ id: asRegionId('x') })))
      .scene as Scene;
    const cmd = setSubstrateRegionExtent({ regionId: asRegionId('x'), fromX: 0, toX: 1, blend: 10 });
    const inv = invertSubstrateCommand(scene, cmd);
    expect(inv).toMatchObject({ kind: 'SetSubstrateRegionExtent', blend: null });
  });

  it('SetSubstrateRegionExtent of unknown id inverts to Noop', () => {
    expect(
      invertSubstrateCommand(
        emptyScene(),
        setSubstrateRegionExtent({ regionId: asRegionId('nope'), fromX: 0, toX: 1 }),
      ),
    ).toEqual({ kind: 'Noop' });
  });

  it('SetSubstrateRegionProfile inverts back to previous profile', () => {
    const oldProfile = [
      { x: 0, y: 10 },
      { x: 1, y: 10 },
    ];
    const scene = applySubstrateCommand(
      emptyScene(),
      addSubstrateRegion(region({ id: asRegionId('x'), profile: oldProfile })),
    ).scene as Scene;
    const newProfile = [
      { x: 0, y: 50 },
      { x: 1, y: 50 },
    ];
    const cmd = setSubstrateRegionProfile(asRegionId('x'), newProfile);
    const inv = invertSubstrateCommand(scene, cmd);
    expect(inv).toMatchObject({
      kind: 'SetSubstrateRegionProfile',
      regionId: 'x',
      profile: oldProfile,
    });
  });

  it('SetSubstrateRegionProfile of unknown id inverts to Noop', () => {
    expect(
      invertSubstrateCommand(
        emptyScene(),
        setSubstrateRegionProfile(asRegionId('nope'), [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]),
      ),
    ).toEqual({ kind: 'Noop' });
  });
});

// ── End-to-end via applyCommand / invertCommand (the public dispatchers) ─

describe('substrate commands through applyCommand/invertCommand', () => {
  it('Add then invert restores the empty substrate', () => {
    const scene = emptyScene();
    const cmd = addSubstrateRegion(region({ id: asRegionId('x') }));
    const applied = applyCommand(scene, cmd);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const inv = invertCommand(scene, cmd);
    const back = applyCommand(applied.scene, inv);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.scene.substrate.regions).toEqual([]);
  });

  it('SetMaterial round-trip is identity', () => {
    let scene = emptyScene();
    scene = (applyCommand(scene, addSubstrateRegion(region({ id: asRegionId('x'), material: SAND })))
      .scene as unknown) as Scene;
    const cmd = setSubstrateRegionMaterial(asRegionId('x'), SOIL);
    const before = scene;
    const after = applyCommand(scene, cmd);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const inv = invertCommand(before, cmd);
    const restored = applyCommand(after.scene, inv);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.scene).toEqual(before);
  });
});
