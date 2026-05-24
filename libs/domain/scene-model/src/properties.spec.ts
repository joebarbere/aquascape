/**
 * Property tests for `domain/scene-model`.
 *
 * The big invariants:
 *  1. Scenes round-trip through JSON.
 *  2. Commands round-trip through JSON.
 *  3. For any accepted command c on scene s,
 *     applyCommand(applyCommand(s, c).scene, invertCommand(s, c)).scene == s.
 *  4. History invariant: any sequence of push/undo/redo lands at the same
 *     scene as replaying the live commands from the empty scene.
 */

import fc from 'fast-check';

import {
  addLayer,
  addObject,
  applyCommand,
  composite,
  invertCommand,
  moveObject,
  noop,
  removeLayer,
  removeObject,
  renameLayer,
  reorderLayers,
  reshapeObject,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility,
  setTankDimensions,
} from './commands';
import type { Command } from './commands';
import { createHistory } from './history';
import { getObjectWithLayer } from './selectors';
import { arbScene, arbSceneObject, arbTransform, makeLayer, makeScene } from './test-fixtures';
import type { LayerId, ObjectId, Scene } from './types';

// Bound fast-check by default to keep CI snappy.
fc.configureGlobal({ numRuns: 50 });

/**
 * Double arbitrary that never emits `-0`. `JSON.stringify(-0)` produces
 * `"0"`, which would make a strict `toEqual` round-trip fail. See
 * test-fixtures.ts for the same trick on the shared `finite()` helper.
 */
const jsonSafeDouble = (max: number): fc.Arbitrary<number> =>
  fc.double({ min: -max, max, noNaN: true }).map((n) => (Object.is(n, -0) ? 0 : n));

// ─── Helpers ──────────────────────────────────────────────────────────────

function unlockAll(scene: Scene): Scene {
  return {
    ...scene,
    layers: scene.layers.map((l) => ({ ...l, locked: false })),
  };
}

function replay(initial: Scene, commands: Command[]): Scene {
  let s = initial;
  for (const c of commands) {
    const r = applyCommand(s, c);
    if (!r.ok) throw new Error(`replay failed: ${r.reason}: ${r.message}`);
    s = r.scene;
  }
  return s;
}

// ─── Scene serialization round-trip ───────────────────────────────────────

describe('Scene JSON round-trip', () => {
  it('arbitrary scene survives JSON.parse(JSON.stringify(scene))', () => {
    fc.assert(
      fc.property(arbScene(), (scene) => {
        const round = JSON.parse(JSON.stringify(scene)) as Scene;
        expect(round).toEqual(scene);
      }),
    );
  });
});

// ─── Command serialization round-trip ─────────────────────────────────────

describe('Command JSON round-trip', () => {
  // Build a command arbitrary keyed off an arbitrary scene so the targets
  // exist (where applicable). For "free-form" commands (Noop, AddLayer,
  // AddObject) we don't need a scene.

  const arbCmdAgainstScene = (scene: Scene): fc.Arbitrary<Command> => {
    const layerIds: LayerId[] = scene.layers.map((l) => l.id);
    const allObjects = scene.layers.flatMap((l) => l.objects);
    const objectIds: ObjectId[] = allObjects.map((o) => o.id);

    const choices: Array<fc.Arbitrary<Command>> = [
      fc.constant(noop()),
      fc
        .record({
          id: fc.uuid({ version: 4 }),
          name: fc.string({ minLength: 1, maxLength: 10 }),
        })
        .map(({ id, name }) => addLayer(makeLayer(id, name))),
    ];

    if (layerIds.length > 0) {
      choices.push(fc.constantFrom(...layerIds).map((id) => removeLayer(id)));
      choices.push(
        fc
          .record({ id: fc.constantFrom(...layerIds), name: fc.string({ maxLength: 10 }) })
          .map(({ id, name }) => renameLayer(id, name)),
      );
      choices.push(
        fc
          .record({
            id: fc.constantFrom(...layerIds),
            opacity: fc.double({ min: 0, max: 1, noNaN: true }),
          })
          .map(({ id, opacity }) => setLayerOpacity(id, opacity)),
      );
      choices.push(
        fc
          .record({ id: fc.constantFrom(...layerIds), v: fc.boolean() })
          .map(({ id, v }) => setLayerVisibility(id, v)),
      );
      choices.push(
        fc
          .record({ id: fc.constantFrom(...layerIds), v: fc.boolean() })
          .map(({ id, v }) => setLayerLocked(id, v)),
      );
      choices.push(
        fc
          .shuffledSubarray(layerIds, {
            minLength: layerIds.length,
            maxLength: layerIds.length,
          })
          .map((order) => reorderLayers([...order])),
      );
      choices.push(
        fc
          .record({ layerId: fc.constantFrom(...layerIds), object: arbSceneObject() })
          .map(({ layerId, object }) => addObject(layerId, object)),
      );
    }
    if (objectIds.length > 0) {
      choices.push(fc.constantFrom(...objectIds).map((id) => removeObject(id)));
      choices.push(
        fc
          .record({
            id: fc.constantFrom(...objectIds),
            pos: fc.record({
              x: jsonSafeDouble(1000),
              y: jsonSafeDouble(1000),
              z: jsonSafeDouble(1000),
            }),
          })
          .map(({ id, pos }) => moveObject(id, pos)),
      );
      choices.push(
        fc
          .record({ id: fc.constantFrom(...objectIds), t: arbTransform() })
          .map(({ id, t }) => reshapeObject(id, t)),
      );
    }

    // SetTankDimensions is always valid against any scene; include it
    // unconditionally so the round-trip coverage exercises every command kind.
    choices.push(
      fc
        .record({
          width: fc.integer({ min: 100, max: 3000 }),
          height: fc.integer({ min: 100, max: 3000 }),
          depth: fc.integer({ min: 100, max: 3000 }),
        })
        .map((dims) => setTankDimensions(dims)),
    );

    return fc.oneof(...choices);
  };

  it('arbitrary commands survive JSON round-trip', () => {
    fc.assert(
      fc.property(arbScene(), (scene) => {
        // Build a command against this scene then round-trip it.
        return fc.assert(
          fc.property(arbCmdAgainstScene(scene), (cmd) => {
            const round = JSON.parse(JSON.stringify(cmd)) as Command;
            expect(round).toEqual(cmd);
          }),
          { numRuns: 10 },
        );
      }),
    );
  });

  it('a deeply nested composite round-trips', () => {
    const scene = makeScene();
    const cmd = composite([
      noop(),
      composite([renameLayer(scene.layers[0]!.id, 'A'), setLayerOpacity(scene.layers[0]!.id, 0.5)]),
      moveObject(scene.layers[0]!.objects[0]!.id, { x: 1, y: 2, z: 3 }),
    ]);
    expect(JSON.parse(JSON.stringify(cmd))).toEqual(cmd);
  });
});

// ─── apply ∘ invert = id ──────────────────────────────────────────────────

describe('apply ∘ invert = id (per-command, on unlocked scenes)', () => {
  // For each command kind we generate one targeted at a random scene, apply
  // it, then apply its inverse, and check we land back at the original.

  const checkRoundTrip = (cmd: Command, scene: Scene): void => {
    const inv = invertCommand(scene, cmd);
    const a = applyCommand(scene, cmd);
    if (!a.ok) {
      // If the command would be rejected on this scene, the inverse must be
      // Noop, and applying Noop to the unchanged scene yields the scene.
      expect(inv).toEqual({ kind: 'Noop' });
      return;
    }
    const b = applyCommand(a.scene, inv);
    if (!b.ok) throw new Error(`inverse rejected: ${b.reason}`);
    expect(b.scene).toEqual(scene);
  };

  it('Noop', () => {
    fc.assert(
      fc.property(arbScene(), (scene) => {
        checkRoundTrip(noop(), unlockAll(scene));
      }),
    );
  });

  it('AddLayer', () => {
    fc.assert(
      fc.property(
        arbScene(),
        fc.uuid({ version: 4 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (sceneIn, layerId, name) => {
          const scene = unlockAll(sceneIn);
          // Skip if the random id collides.
          if (scene.layers.some((l) => l.id === layerId)) return;
          checkRoundTrip(addLayer(makeLayer(layerId, name)), scene);
        },
      ),
    );
  });

  it('RemoveLayer', () => {
    fc.assert(
      fc.property(arbScene(), (sceneIn) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        const id = scene.layers[0]!.id;
        checkRoundTrip(removeLayer(id), scene);
      }),
    );
  });

  it('RenameLayer', () => {
    fc.assert(
      fc.property(arbScene(), fc.string({ maxLength: 10 }), (sceneIn, name) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        const id = scene.layers[0]!.id;
        checkRoundTrip(renameLayer(id, name), scene);
      }),
    );
  });

  it('SetLayerOpacity (no clamping)', () => {
    fc.assert(
      fc.property(arbScene(), fc.double({ min: 0, max: 1, noNaN: true }), (sceneIn, opacity) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        const id = scene.layers[0]!.id;
        checkRoundTrip(setLayerOpacity(id, opacity), scene);
      }),
    );
  });

  it('SetLayerVisibility', () => {
    fc.assert(
      fc.property(arbScene(), fc.boolean(), (sceneIn, v) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        checkRoundTrip(setLayerVisibility(scene.layers[0]!.id, v), scene);
      }),
    );
  });

  it('SetLayerLocked', () => {
    fc.assert(
      fc.property(arbScene(), fc.boolean(), (sceneIn, v) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        checkRoundTrip(setLayerLocked(scene.layers[0]!.id, v), scene);
      }),
    );
  });

  it('ReorderLayers', () => {
    fc.assert(
      fc.property(arbScene(), (sceneIn) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length < 2) return;
        const order = scene.layers.map((l) => l.id).reverse();
        checkRoundTrip(reorderLayers(order), scene);
      }),
    );
  });

  it('AddObject', () => {
    fc.assert(
      fc.property(arbScene(), arbSceneObject(), (sceneIn, object) => {
        const scene = unlockAll(sceneIn);
        if (scene.layers.length === 0) return;
        // Skip if id collides.
        if (getObjectWithLayer(scene, object.id) !== null) return;
        checkRoundTrip(addObject(scene.layers[0]!.id, object), scene);
      }),
    );
  });

  it('RemoveObject', () => {
    fc.assert(
      fc.property(arbScene(), (sceneIn) => {
        const scene = unlockAll(sceneIn);
        const obj = scene.layers.flatMap((l) => l.objects)[0];
        if (!obj) return;
        checkRoundTrip(removeObject(obj.id), scene);
      }),
    );
  });

  it('MoveObject', () => {
    fc.assert(
      fc.property(
        arbScene(),
        fc.record({
          x: fc.double({ min: -1000, max: 1000, noNaN: true }),
          y: fc.double({ min: -1000, max: 1000, noNaN: true }),
          z: fc.double({ min: -1000, max: 1000, noNaN: true }),
        }),
        (sceneIn, pos) => {
          const scene = unlockAll(sceneIn);
          const obj = scene.layers.flatMap((l) => l.objects)[0];
          if (!obj) return;
          checkRoundTrip(moveObject(obj.id, pos), scene);
        },
      ),
    );
  });

  it('ReshapeObject', () => {
    fc.assert(
      fc.property(arbScene(), arbTransform(), (sceneIn, t) => {
        const scene = unlockAll(sceneIn);
        const obj = scene.layers.flatMap((l) => l.objects)[0];
        if (!obj) return;
        checkRoundTrip(reshapeObject(obj.id, t), scene);
      }),
    );
  });

  it('SetTankDimensions', () => {
    fc.assert(
      fc.property(
        arbScene(),
        fc.record({
          width: fc.integer({ min: 100, max: 3000 }),
          height: fc.integer({ min: 100, max: 3000 }),
          depth: fc.integer({ min: 100, max: 3000 }),
        }),
        (sceneIn, dims) => {
          // SetTankDimensions is a structural op; layer.locked is irrelevant
          // but unlocking keeps the test consistent with the suite.
          const scene = unlockAll(sceneIn);
          checkRoundTrip(setTankDimensions(dims), scene);
        },
      ),
    );
  });

  it('Composite of layer-property commands', () => {
    fc.assert(
      fc.property(
        arbScene(),
        fc.string({ maxLength: 8 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.boolean(),
        (sceneIn, name, opacity, vis) => {
          const scene = unlockAll(sceneIn);
          if (scene.layers.length === 0) return;
          const id = scene.layers[0]!.id;
          const cmd = composite([
            renameLayer(id, name),
            setLayerOpacity(id, opacity),
            setLayerVisibility(id, vis),
          ]);
          checkRoundTrip(cmd, scene);
        },
      ),
    );
  });
});

describe('apply ∘ invert when target missing (returns Noop inverse)', () => {
  it('inverse of a missing-target command is Noop and lands on the same scene', () => {
    fc.assert(
      fc.property(arbScene(), (sceneIn) => {
        const scene = unlockAll(sceneIn);
        const cmd = renameLayer('cccccccc-0000-4000-8000-deadbeefdead' as LayerId, 'nope');
        const inv = invertCommand(scene, cmd);
        expect(inv).toEqual({ kind: 'Noop' });
        const a = applyCommand(scene, cmd);
        // It rejects, so the scene is unchanged.
        expect(a.ok).toBe(false);
      }),
    );
  });
});

// ─── History replay invariant ─────────────────────────────────────────────

describe('History replay invariant', () => {
  it('after any push/undo/redo sequence, scene = replay(live commands)', () => {
    // Build an arbitrary sequence of operations against a deterministic
    // small scene. We use makeScene() (rather than arbScene) because the
    // operations need known layer/object ids.

    const seed = makeScene();
    const layerId = seed.layers[0]!.id;

    type Op = { kind: 'push'; cmd: Command } | { kind: 'undo' } | { kind: 'redo' };

    const arbOp: fc.Arbitrary<Op> = fc.oneof(
      fc
        .string({ minLength: 1, maxLength: 6 })
        .map((name) => ({ kind: 'push' as const, cmd: renameLayer(layerId, name) })),
      fc.constant({ kind: 'undo' as const }),
      fc.constant({ kind: 'redo' as const }),
    );

    fc.assert(
      fc.property(fc.array(arbOp, { maxLength: 20 }), (ops) => {
        let history = createHistory();
        let scene = seed;
        const live: Command[] = [];
        for (const op of ops) {
          if (op.kind === 'push') {
            const r = history.push(op.cmd, scene);
            if (!r) continue;
            history = r.history;
            scene = r.scene;
            // Mirror the history bound for live[]: if past was truncated,
            // truncate live too.
            live.push(op.cmd);
            if (live.length > history.bound) {
              live.splice(0, live.length - history.bound);
            }
          } else if (op.kind === 'undo') {
            const r = history.undo(scene);
            if (!r) continue;
            history = r.history;
            scene = r.scene;
            live.pop();
          } else {
            const r = history.redo(scene);
            if (!r) continue;
            history = r.history;
            scene = r.scene;
            const entry = history.past[history.past.length - 1];
            if (entry) live.push(entry.command);
          }
        }
        const expected = replay(seed, live);
        expect(scene).toEqual(expected);
      }),
    );
  });
});
