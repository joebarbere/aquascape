/**
 * F13.3 bioload → source-term tests. Pins the agreement with the live ECS
 * per-fish baseline (a medium-class fish = `FISH_BASELINE_WASTE_N_MG_PER_DAY`)
 * and the class weighting.
 */

import type { Catalog } from '@aquascape/domain/catalog';
import type { Scene } from '@aquascape/domain/scene-model';

import { FISH_BASELINE_WASTE_N_MG_PER_DAY, bioloadSourceN } from './bioload';

/** Minimal scene with a livestock list; everything else is structurally inert. */
function sceneWith(livestock: Scene['livestock']): Scene {
  return {
    tank: { width: 600, height: 400, depth: 400, style: { frame: 'rimless', background: { kind: 'none' } } },
    substrate: { regions: [] },
    layers: [],
    seed: 1,
    ...(livestock !== undefined ? { livestock } : {}),
  } as Scene;
}

/** Catalog stub returning a livestock row with the given bioload class. */
function catalogWithClass(classById: Record<string, 'low' | 'medium' | 'high'>): Catalog {
  return {
    get(ref: { id: string }) {
      const cls = classById[ref.id];
      if (cls === undefined) return null;
      return { kind: 'livestock', id: ref.id, bioloadClass: cls } as never;
    },
  } as unknown as Catalog;
}

describe('bioloadSourceN', () => {
  it('an unstocked tank has a zero source term', () => {
    expect(bioloadSourceN(sceneWith(undefined), catalogWithClass({}))).toBe(0);
    expect(bioloadSourceN(sceneWith([]), catalogWithClass({}))).toBe(0);
  });

  it('a medium-class fish contributes exactly the ECS per-fish baseline', () => {
    const scene = sceneWith([
      { id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 1 },
    ]);
    const cat = catalogWithClass({ med: 'medium' });
    expect(bioloadSourceN(scene, cat)).toBeCloseTo(FISH_BASELINE_WASTE_N_MG_PER_DAY, 10);
  });

  it('scales linearly with quantity', () => {
    const scene = sceneWith([
      { id: 'e1', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 10 },
    ]);
    const cat = catalogWithClass({ med: 'medium' });
    expect(bioloadSourceN(scene, cat)).toBeCloseTo(10 * FISH_BASELINE_WASTE_N_MG_PER_DAY, 10);
  });

  it('weights low ×0.5 and high ×2.0 around the baseline', () => {
    const scene = sceneWith([
      { id: 'lo', ref: { catalog: 'core', id: 'lo', version: 1 }, quantity: 1 },
      { id: 'hi', ref: { catalog: 'core', id: 'hi', version: 1 }, quantity: 1 },
    ]);
    const cat = catalogWithClass({ lo: 'low', hi: 'high' });
    const expected =
      FISH_BASELINE_WASTE_N_MG_PER_DAY * 0.5 + FISH_BASELINE_WASTE_N_MG_PER_DAY * 2.0;
    expect(bioloadSourceN(scene, cat)).toBeCloseTo(expected, 10);
  });

  it('treats a missing / non-livestock catalog ref as medium (flat baseline)', () => {
    const scene = sceneWith([
      { id: 'x', ref: { catalog: 'core', id: 'unknown', version: 1 }, quantity: 3 },
    ]);
    const cat = catalogWithClass({}); // every lookup returns null
    expect(bioloadSourceN(scene, cat)).toBeCloseTo(3 * FISH_BASELINE_WASTE_N_MG_PER_DAY, 10);
  });

  it('ignores non-finite / negative quantities', () => {
    const scene = sceneWith([
      { id: 'a', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: -5 },
      { id: 'b', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: Number.NaN },
    ]);
    const cat = catalogWithClass({ med: 'medium' });
    expect(bioloadSourceN(scene, cat)).toBe(0);
  });

  it('is pure — repeated calls on the same inputs agree', () => {
    const scene = sceneWith([
      { id: 'a', ref: { catalog: 'core', id: 'med', version: 1 }, quantity: 4 },
    ]);
    const cat = catalogWithClass({ med: 'medium' });
    expect(bioloadSourceN(scene, cat)).toBe(bioloadSourceN(scene, cat));
  });
});
