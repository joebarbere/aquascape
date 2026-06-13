// Shared scene-mutation helpers for the demo control HUD + console.
//
// Both surfaces add random items, resolve species by fuzzy token, and stock
// livestock through the same NgRx + Command pipeline. Centralising the logic
// here keeps them consistent and the dispatch shapes in one place.

import type { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import {
  addLayer,
  addLivestockEntry,
  addObject,
  identityTransform,
  newLayerId,
  newObjectId,
  type DecorObject,
  type HardscapeObject,
  type Layer,
  type LayerId,
  type LivestockEntry,
  type PlantObject,
  type Scene,
  type SceneObject,
} from '@aquascape/domain/scene-model';
import { SceneActions } from '@aquascape/state';

export type ItemKind = 'rock' | 'wood' | 'plant' | 'decor';

/** Catalog id → display name, for fuzzy species resolution + labels. */
export const NAME_BY_ID: ReadonlyMap<string, string> = new Map(
  coreCatalog.entries.map((e) => [e.id, e.name]),
);

/** A `core`-catalog ref at version 1 (every shipped manifest is v1). */
function ref(id: string) {
  return { catalog: 'core', id, version: 1 } as const;
}

function pickRandom<T>(pool: readonly T[]): T | undefined {
  return pool.length === 0 ? undefined : pool[Math.floor(Math.random() * pool.length)];
}

/** A non-crypto pseudo-id is fine for runtime user actions (not the seeded
 *  scene). Prefer crypto.randomUUID where present (browsers / Electron). */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `demo-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

/** Build a random catalog-backed object of `kind` at a random in-tank spot. */
export function buildRandomObject(kind: ItemKind, scene: Scene): SceneObject | null {
  const { width, depth } = scene.tank;
  const x = Math.round(width * (0.12 + Math.random() * 0.76));
  const z = Math.round(depth * (0.18 + Math.random() * 0.64));
  const transform = { ...identityTransform(), position: { x, y: 80, z } };

  if (kind === 'rock' || kind === 'wood') {
    const entry = pickRandom(coreCatalog.byKind('hardscape').filter((e) => e.category === kind));
    if (entry === undefined) return null;
    const obj: HardscapeObject = {
      kind: 'hardscape',
      id: newObjectId(),
      ref: ref(entry.id),
      category: kind,
      transform,
    };
    return obj;
  }
  if (kind === 'plant') {
    const entry = pickRandom(coreCatalog.byKind('plant'));
    if (entry === undefined) return null;
    const obj: PlantObject = {
      kind: 'plant',
      id: newObjectId(),
      ref: ref(entry.id),
      growth: { ageWeeks: 20, vigor: 1 },
      transform,
    };
    return obj;
  }
  const entry = pickRandom(coreCatalog.byKind('decor'));
  if (entry === undefined) return null;
  const obj: DecorObject = { kind: 'decor', id: newObjectId(), ref: ref(entry.id), transform };
  return obj;
}

/** Pick a sensible existing layer for `kind`, else the last one, else mint one
 *  (dispatching the AddLayer command for the new layer). */
export function ensureTargetLayer(store: Store, scene: Scene, kind: ItemKind): LayerId {
  const wanted =
    kind === 'plant'
      ? ['plant', 'midground', 'carpet']
      : kind === 'decor'
        ? ['decor']
        : ['hardscape'];
  const match = scene.layers.find((l) => wanted.some((w) => l.name.toLowerCase().includes(w)));
  if (match !== undefined) return match.id;
  const last = scene.layers[scene.layers.length - 1];
  if (last !== undefined) return last.id;
  const layer: Layer = {
    id: newLayerId(),
    name: 'Demo additions',
    opacity: 1,
    visible: true,
    locked: false,
    objects: [],
  };
  store.dispatch(SceneActions.dispatchCommand({ command: addLayer(layer) }));
  return layer.id;
}

/** Add a random item of `kind`; returns the created object (or null if none). */
export function addRandomItem(store: Store, scene: Scene, kind: ItemKind): SceneObject | null {
  const object = buildRandomObject(kind, scene);
  if (object === null) return null;
  const layerId = ensureTargetLayer(store, scene, kind);
  store.dispatch(SceneActions.dispatchCommand({ command: addObject(layerId, object) }));
  return object;
}

/** Add a livestock species (catalog id) at `quantity`. */
export function addSpecies(
  store: Store,
  catalogId: string,
  quantity: number,
  makeId: () => string,
): void {
  const entry: LivestockEntry = { id: makeId(), ref: ref(catalogId), quantity };
  store.dispatch(SceneActions.dispatchCommand({ command: addLivestockEntry(entry) }));
}

export type SpeciesMatch =
  | { readonly status: 'found'; readonly id: string; readonly name: string }
  | { readonly status: 'ambiguous'; readonly candidates: readonly string[] }
  | { readonly status: 'none' };

/**
 * Fuzzy-resolve a user token to exactly one catalog id from `candidateIds`.
 * Tries, in order: exact id, id-ends-with, then substring of id OR name. A
 * single hit ⇒ found; several ⇒ ambiguous (with display names); zero ⇒ none.
 */
export function matchSpecies(token: string, candidateIds: readonly string[]): SpeciesMatch {
  const t = token.trim().toLowerCase();
  if (t === '') return { status: 'none' };

  const exact = candidateIds.find((id) => id.toLowerCase() === t);
  if (exact !== undefined)
    return { status: 'found', id: exact, name: NAME_BY_ID.get(exact) ?? exact };

  const endsWith = candidateIds.filter(
    (id) => id.toLowerCase().endsWith(`.${t}`) || id.toLowerCase().endsWith(t),
  );
  const pool = endsWith.length > 0 ? endsWith : candidateIds;

  const hits = pool.filter(
    (id) => id.toLowerCase().includes(t) || (NAME_BY_ID.get(id) ?? '').toLowerCase().includes(t),
  );
  const only = hits.length === 1 ? hits[0] : undefined;
  if (only !== undefined) return { status: 'found', id: only, name: NAME_BY_ID.get(only) ?? only };
  if (hits.length > 1) {
    return { status: 'ambiguous', candidates: hits.map((id) => NAME_BY_ID.get(id) ?? id) };
  }
  return { status: 'none' };
}
