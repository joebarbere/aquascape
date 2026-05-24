/**
 * Commands — every editor mutation flows through here.
 *
 * SHAPE CHOICE (b): commands are plain serializable objects with a `kind`
 * discriminator. `applyCommand(scene, command)` dispatches via a switch on
 * `kind`; `invertCommand(scene, command)` returns the inverse command record
 * for undo. No class instances, no closures over runtime references —
 * `JSON.parse(JSON.stringify(c))` is lossless for every command.
 *
 * (The `Command` "interface" from the F0.3 spec wording is realized here as
 * a discriminated union + two free functions. The semantic contract — pure,
 * invertible, serializable — is identical. Documented in the lib README.)
 *
 * LOCKED-LAYER GUARD:
 *  - Object-level commands (`AddObject`, `RemoveObject`, `MoveObject`,
 *    `ReshapeObject`) targeting a locked layer return an `EditRejected`
 *    result with `reason: 'locked'`.
 *  - Layer-property commands (`RenameLayer`, `SetLayerOpacity`,
 *    `SetLayerVisibility`, `SetLayerLocked`) are NOT blocked by `locked` —
 *    the lock guards content, not the layer's own metadata.
 *  - `RemoveLayer` is treated as a structural operation and is NOT blocked
 *    by `locked` on its own; the higher-level UI is expected to confirm.
 *    (If we want to lock-protect deletion later, we add it to the guard.)
 *
 * MUTATION DISCIPLINE: every `apply` returns a freshly spread / structured-
 * cloned scene. No in-place edits. v1 favours clarity over structural
 * sharing.
 */

import type { Transform } from '@aquascape/domain/geometry';
import { identityTransform } from '@aquascape/domain/geometry';

import { getLayerById, getObjectWithLayer } from './selectors';
import type { Layer, LayerId, ObjectId, Scene, SceneObject } from './types';

// ─── Result type ──────────────────────────────────────────────────────────

/**
 * Result of {@link applyCommand}. `ok: true` on success carries the new
 * scene; `ok: false` carries a typed {@link RejectReason}.
 */
export type CommandResult =
  | { ok: true; scene: Scene }
  | { ok: false; reason: RejectReason; message: string };

export type RejectReason = 'locked' | 'not-found' | 'invalid';

/** Convenience constructor for a successful result. */
function ok(scene: Scene): CommandResult {
  return { ok: true, scene };
}

/** Convenience constructor for a rejection. */
function rejected(reason: RejectReason, message: string): CommandResult {
  return { ok: false, reason, message };
}

// ─── Command record union ─────────────────────────────────────────────────

/** No-op command. Identity on the scene. Useful as a placeholder. */
export interface NoopCommand {
  kind: 'Noop';
}

/**
 * Insert a layer at `index`. If `index` is `null` or `>= layers.length`,
 * the layer is appended at the end. The `layer` field carries the full
 * layer record; mint its id via {@link newLayerId} before constructing.
 */
export interface AddLayerCommand {
  kind: 'AddLayer';
  layer: Layer;
  index: number | null;
}

/** Remove the layer with `layerId`. Rejects `not-found` if unknown. */
export interface RemoveLayerCommand {
  kind: 'RemoveLayer';
  layerId: LayerId;
}

/** Rename a layer. Not blocked by `locked` (metadata, not content). */
export interface RenameLayerCommand {
  kind: 'RenameLayer';
  layerId: LayerId;
  name: string;
}

/**
 * Set a layer's opacity. Clamped to [0,1] before storing; rejects `invalid`
 * if the value is non-finite.
 */
export interface SetLayerOpacityCommand {
  kind: 'SetLayerOpacity';
  layerId: LayerId;
  opacity: number;
}

export interface SetLayerVisibilityCommand {
  kind: 'SetLayerVisibility';
  layerId: LayerId;
  visible: boolean;
}

export interface SetLayerLockedCommand {
  kind: 'SetLayerLocked';
  layerId: LayerId;
  locked: boolean;
}

/**
 * Reorder layers via a full id-permutation. `order` must be a permutation
 * of the current layer ids (same set, no duplicates). Rejects `invalid`
 * otherwise. (Chose permutation over index-swap so reorder by drag-and-drop
 * is a single command.)
 */
export interface ReorderLayersCommand {
  kind: 'ReorderLayers';
  order: LayerId[];
}

/**
 * Add an object to `layerId` at `index`. If `index` is `null` or `>=`
 * the layer's object count, the object is appended.
 */
export interface AddObjectCommand {
  kind: 'AddObject';
  layerId: LayerId;
  object: SceneObject;
  index: number | null;
}

/** Remove the object with `objectId`. */
export interface RemoveObjectCommand {
  kind: 'RemoveObject';
  objectId: ObjectId;
}

/**
 * Move an object to an absolute world position. Chose absolute over delta
 * because invert is trivial — invert captures the previous absolute
 * position — and absolute commands are idempotent on replay.
 */
export interface MoveObjectCommand {
  kind: 'MoveObject';
  objectId: ObjectId;
  position: { x: number; y: number; z: number };
}

/** Set an object's full transform. Invert captures the previous transform. */
export interface ReshapeObjectCommand {
  kind: 'ReshapeObject';
  objectId: ObjectId;
  transform: Transform;
}

/**
 * Set the tank's interior dimensions (mm). Structural / global operation;
 * NOT blocked by `locked` on any layer — `SetTankDimensions` is treated like
 * `RemoveLayer` and `ReorderLayers`.
 *
 * APPLY SEMANTICS
 *  1. Validates `width`, `height`, `depth`: must be finite, > 0, and
 *     ≤ {@link SET_TANK_DIMENSIONS_MAX_MM} (10 000 mm). Rejects with
 *     `reason: 'invalid'` otherwise. This is the **domain-layer floor**:
 *     the UI in F1.1 phase B applies the tighter 100–3000 mm range check.
 *  2. Updates `scene.tank.{width,height,depth}` to the new values.
 *     `scene.tank.style`, `scene.tank.glassThickness` and
 *     `scene.tank.presetRef` are NOT touched.
 *  3. **`presetRef` is intentionally left alone** even when new dimensions
 *     would no longer match the preset's stored dimensions. Stage 0 has no
 *     catalog loader, so the command cannot resolve the preset. The UI in
 *     F1.1 phase B knows whether a dim change came from picking a preset
 *     vs. editing a number and dispatches a separate operation to clear
 *     `presetRef` when needed.
 *  4. Every `SceneObject.transform.position` is clamped per-axis into the
 *     new tank's interior AABB:
 *      - x ∈ [0, width]
 *      - y ∈ [0, height]
 *      - z ∈ [0, depth]
 *     **Nothing is deleted.** Even an object whose center lands exactly on a
 *     face of the new tank stays in the scene. Clamping runs regardless of
 *     `layer.locked` — `SetTankDimensions` is a structural global op, not an
 *     object-level edit.
 *  5. Substrate regions are not clamped. `SubstrateRegion.fromX` / `toX` are
 *     normalised fractions of tank width so they reinterpret automatically.
 *     Profile y-values (mm from tank floor) that exceed the new `height`
 *     are LEFT untouched for now — see the `TODO(F2.x)` in the apply
 *     handler. There is no substrate-editing UI yet, and clamping profile
 *     points would expand the `inverse` envelope; defer until F2.x adds the
 *     UI that can produce a profile point taller than the tank.
 *
 * INVERT SEMANTICS
 * `invertCommand(scene, cmd)` returns a fresh `SetTankDimensionsCommand`
 * whose `dimensions` are the pre-apply scene's tank dimensions, and whose
 * `inverse` envelope carries:
 *   - `previousDimensions`: the dimensions to restore (== pre-apply dims).
 *   - `restoredPositions`: a map of every objectId → its pre-apply
 *     position. This is populated for ALL objects, not just clamped ones
 *     (simple + correct over clever + sparse). When `applyCommand` runs a
 *     command whose `inverse.restoredPositions` is present, it uses those
 *     positions for the listed objects instead of clamping — this is what
 *     makes `apply ∘ invert = id` work even after shrinking and undoing.
 *
 * A `SetTankDimensionsCommand` built freshly from the UI omits `inverse`;
 * one built by `invertCommand` carries it. Both are JSON-serializable.
 */
export interface SetTankDimensionsCommand {
  kind: 'SetTankDimensions';
  /** New tank dimensions in mm. All three required. */
  dimensions: { width: number; height: number; depth: number };
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * typically omitted on a freshly-built command from the UI.
   *  - `previousDimensions`: the dimensions to restore on invert.
   *  - `restoredPositions`: map of objectId → previous position. When
   *    present, `applyCommand` uses these positions for listed objects
   *    instead of clamping into the new AABB.
   */
  inverse?: {
    previousDimensions: { width: number; height: number; depth: number };
    restoredPositions: Record<string, { x: number; y: number; z: number }>;
  };
}

/**
 * Upper-bound on a single tank dimension (mm). Loose physical sanity. The
 * UI in F1.1 phase B applies a tighter 100–3000 mm range; this is the
 * domain-layer floor protecting against absurd inputs from any caller.
 */
export const SET_TANK_DIMENSIONS_MAX_MM = 10_000;

/**
 * Composite command: apply children in order on `apply`, invert children
 * in reverse on `invert`. Treated as a single user action by undo/redo.
 *
 * If any child rejects, the composite rejects with the same reason and the
 * scene is left unchanged (atomic).
 */
export interface CompositeCommand {
  kind: 'Composite';
  children: Command[];
}

export type Command =
  | NoopCommand
  | AddLayerCommand
  | RemoveLayerCommand
  | RenameLayerCommand
  | SetLayerOpacityCommand
  | SetLayerVisibilityCommand
  | SetLayerLockedCommand
  | ReorderLayersCommand
  | AddObjectCommand
  | RemoveObjectCommand
  | MoveObjectCommand
  | ReshapeObjectCommand
  | SetTankDimensionsCommand
  | CompositeCommand;

// ─── Internal helpers ─────────────────────────────────────────────────────

/** Deep clone via structuredClone (Node ≥ 17). */
function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Replace a layer by id in a fresh `layers` array. Caller checks existence. */
function replaceLayer(scene: Scene, layerId: LayerId, next: Layer): Scene {
  const layers = scene.layers.map((l) => (l.id === layerId ? next : l));
  return { ...scene, layers };
}

/** Resolve an insertion index. `null` or out-of-bounds → append. */
function resolveInsertIndex(index: number | null, length: number): number {
  if (index === null || index < 0 || index > length) {
    return length;
  }
  return index;
}

// ─── apply / invert ───────────────────────────────────────────────────────

/**
 * Apply a command to a scene, returning a {@link CommandResult}.
 * Pure: no IO, no mutation of `scene`, no `Date.now()` / `Math.random()`.
 */
export function applyCommand(scene: Scene, command: Command): CommandResult {
  switch (command.kind) {
    case 'Noop':
      return ok(scene);

    case 'AddLayer': {
      // Reject if a layer with the same id already exists.
      if (scene.layers.some((l) => l.id === command.layer.id)) {
        return rejected('invalid', `AddLayer: layer id "${command.layer.id}" already exists`);
      }
      const insertAt = resolveInsertIndex(command.index, scene.layers.length);
      const layers = scene.layers.slice();
      layers.splice(insertAt, 0, clone(command.layer));
      return ok({ ...scene, layers });
    }

    case 'RemoveLayer': {
      const idx = scene.layers.findIndex((l) => l.id === command.layerId);
      if (idx < 0) {
        return rejected('not-found', `RemoveLayer: layer "${command.layerId}" not found`);
      }
      const layers = scene.layers.slice();
      layers.splice(idx, 1);
      return ok({ ...scene, layers });
    }

    case 'RenameLayer': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `RenameLayer: layer "${command.layerId}" not found`);
      }
      // Not blocked by `locked` (metadata, not content).
      return ok(replaceLayer(scene, command.layerId, { ...layer, name: command.name }));
    }

    case 'SetLayerOpacity': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `SetLayerOpacity: layer "${command.layerId}" not found`);
      }
      if (!Number.isFinite(command.opacity)) {
        return rejected('invalid', `SetLayerOpacity: opacity must be finite`);
      }
      const clamped = Math.min(1, Math.max(0, command.opacity));
      return ok(replaceLayer(scene, command.layerId, { ...layer, opacity: clamped }));
    }

    case 'SetLayerVisibility': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `SetLayerVisibility: layer "${command.layerId}" not found`);
      }
      return ok(replaceLayer(scene, command.layerId, { ...layer, visible: command.visible }));
    }

    case 'SetLayerLocked': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `SetLayerLocked: layer "${command.layerId}" not found`);
      }
      return ok(replaceLayer(scene, command.layerId, { ...layer, locked: command.locked }));
    }

    case 'ReorderLayers': {
      const have = scene.layers.map((l) => l.id);
      if (command.order.length !== have.length) {
        return rejected('invalid', `ReorderLayers: order length mismatch`);
      }
      const seen = new Set<LayerId>();
      for (const id of command.order) {
        if (seen.has(id)) {
          return rejected('invalid', `ReorderLayers: duplicate id "${id}"`);
        }
        seen.add(id);
      }
      for (const id of have) {
        if (!seen.has(id)) {
          return rejected('invalid', `ReorderLayers: missing layer id "${id}" in new order`);
        }
      }
      const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
      const layers = command.order.map((id) => byId.get(id) as Layer);
      return ok({ ...scene, layers });
    }

    case 'AddObject': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `AddObject: layer "${command.layerId}" not found`);
      }
      if (layer.locked) {
        return rejected('locked', `AddObject: layer "${command.layerId}" is locked`);
      }
      if (layer.objects.some((o) => o.id === command.object.id)) {
        return rejected(
          'invalid',
          `AddObject: object id "${command.object.id}" already exists in layer`,
        );
      }
      const insertAt = resolveInsertIndex(command.index, layer.objects.length);
      const objects = layer.objects.slice();
      objects.splice(insertAt, 0, clone(command.object));
      return ok(replaceLayer(scene, command.layerId, { ...layer, objects }));
    }

    case 'RemoveObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return rejected('not-found', `RemoveObject: object "${command.objectId}" not found`);
      }
      if (found.layer.locked) {
        return rejected('locked', `RemoveObject: layer "${found.layer.id}" is locked`);
      }
      const objects = found.layer.objects.filter((o) => o.id !== command.objectId);
      return ok(replaceLayer(scene, found.layer.id, { ...found.layer, objects }));
    }

    case 'MoveObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return rejected('not-found', `MoveObject: object "${command.objectId}" not found`);
      }
      if (found.layer.locked) {
        return rejected('locked', `MoveObject: layer "${found.layer.id}" is locked`);
      }
      if (
        !Number.isFinite(command.position.x) ||
        !Number.isFinite(command.position.y) ||
        !Number.isFinite(command.position.z)
      ) {
        return rejected('invalid', `MoveObject: non-finite position`);
      }
      const nextObject: SceneObject = {
        ...found.object,
        transform: {
          ...found.object.transform,
          position: { ...command.position },
        },
      };
      const objects = found.layer.objects.map((o) => (o.id === command.objectId ? nextObject : o));
      return ok(replaceLayer(scene, found.layer.id, { ...found.layer, objects }));
    }

    case 'ReshapeObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return rejected('not-found', `ReshapeObject: object "${command.objectId}" not found`);
      }
      if (found.layer.locked) {
        return rejected('locked', `ReshapeObject: layer "${found.layer.id}" is locked`);
      }
      const nextObject: SceneObject = {
        ...found.object,
        transform: clone(command.transform),
      };
      const objects = found.layer.objects.map((o) => (o.id === command.objectId ? nextObject : o));
      return ok(replaceLayer(scene, found.layer.id, { ...found.layer, objects }));
    }

    case 'SetTankDimensions': {
      const { width, height, depth } = command.dimensions;
      const validDim = (n: number): boolean =>
        Number.isFinite(n) && n > 0 && n <= SET_TANK_DIMENSIONS_MAX_MM;
      if (!validDim(width) || !validDim(height) || !validDim(depth)) {
        return rejected(
          'invalid',
          `SetTankDimensions: each of width/height/depth must be finite, > 0, and ` +
            `≤ ${SET_TANK_DIMENSIONS_MAX_MM} mm`,
        );
      }

      // `presetRef` is intentionally left untouched — see JSDoc on
      // SetTankDimensionsCommand. `style` and `glassThickness` likewise.
      const nextTank: Scene['tank'] = {
        ...scene.tank,
        width,
        height,
        depth,
      };

      // TODO(F2.x): clamp substrate region profile y-values that exceed the
      // new `height`. Deferred until substrate-editing UI lands; until then,
      // no caller can produce a profile point taller than the tank.

      // Per-object position clamp. If the inverse envelope carries a
      // restoration map, use those positions for listed objects instead.
      const restorations = command.inverse?.restoredPositions;
      const layers: Layer[] = scene.layers.map((layer) => {
        const objects = layer.objects.map((object) => {
          const restored = restorations ? restorations[object.id] : undefined;
          const nextPosition = restored
            ? { ...restored }
            : {
                x: Math.max(0, Math.min(width, object.transform.position.x)),
                y: Math.max(0, Math.min(height, object.transform.position.y)),
                z: Math.max(0, Math.min(depth, object.transform.position.z)),
              };
          // If nothing changed, keep the original object reference — saves
          // an allocation per untouched object.
          if (
            nextPosition.x === object.transform.position.x &&
            nextPosition.y === object.transform.position.y &&
            nextPosition.z === object.transform.position.z
          ) {
            return object;
          }
          const nextObject: SceneObject = {
            ...object,
            transform: {
              ...object.transform,
              position: nextPosition,
            },
          };
          return nextObject;
        });
        // Reuse layer reference if no object changed.
        if (objects.every((o, i) => o === layer.objects[i])) {
          return layer;
        }
        return { ...layer, objects };
      });

      return ok({ ...scene, tank: nextTank, layers });
    }

    case 'Composite': {
      let current = scene;
      for (const child of command.children) {
        const result = applyCommand(current, child);
        if (!result.ok) {
          return result; // atomic: bail out without partial state
        }
        current = result.scene;
      }
      return ok(current);
    }
  }
}

/**
 * Build the inverse command for `command` given the scene it will/did apply
 * to. The returned record, when applied to `applyCommand(scene, command).scene`,
 * restores `scene`.
 *
 * `invertCommand` is pure and reads `scene` as a snapshot — the resulting
 * command record is JSON-serializable (no closures, no references).
 *
 * If `command` would be rejected on `scene` (e.g. `RemoveLayer` of an unknown
 * id), the inverse is a `Noop` — applying nothing then inverting that
 * "nothing" is sound.
 */
export function invertCommand(scene: Scene, command: Command): Command {
  switch (command.kind) {
    case 'Noop':
      return { kind: 'Noop' };

    case 'AddLayer': {
      // Inverse removes the layer we just added.
      return { kind: 'RemoveLayer', layerId: command.layer.id };
    }

    case 'RemoveLayer': {
      const idx = scene.layers.findIndex((l) => l.id === command.layerId);
      if (idx < 0) {
        return { kind: 'Noop' };
      }
      const layer = scene.layers[idx] as Layer;
      return { kind: 'AddLayer', layer: clone(layer), index: idx };
    }

    case 'RenameLayer': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return { kind: 'Noop' };
      }
      return { kind: 'RenameLayer', layerId: command.layerId, name: layer.name };
    }

    case 'SetLayerOpacity': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return { kind: 'Noop' };
      }
      return {
        kind: 'SetLayerOpacity',
        layerId: command.layerId,
        opacity: layer.opacity,
      };
    }

    case 'SetLayerVisibility': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return { kind: 'Noop' };
      }
      return {
        kind: 'SetLayerVisibility',
        layerId: command.layerId,
        visible: layer.visible,
      };
    }

    case 'SetLayerLocked': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return { kind: 'Noop' };
      }
      return {
        kind: 'SetLayerLocked',
        layerId: command.layerId,
        locked: layer.locked,
      };
    }

    case 'ReorderLayers': {
      // Inverse: reorder back to the current order.
      return { kind: 'ReorderLayers', order: scene.layers.map((l) => l.id) };
    }

    case 'AddObject': {
      return { kind: 'RemoveObject', objectId: command.object.id };
    }

    case 'RemoveObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return { kind: 'Noop' };
      }
      const idx = found.layer.objects.findIndex((o) => o.id === command.objectId);
      return {
        kind: 'AddObject',
        layerId: found.layer.id,
        object: clone(found.object),
        index: idx,
      };
    }

    case 'MoveObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return { kind: 'Noop' };
      }
      return {
        kind: 'MoveObject',
        objectId: command.objectId,
        position: { ...found.object.transform.position },
      };
    }

    case 'ReshapeObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return { kind: 'Noop' };
      }
      return {
        kind: 'ReshapeObject',
        objectId: command.objectId,
        transform: clone(found.object.transform),
      };
    }

    case 'SetTankDimensions': {
      // Capture pre-apply state. We populate `restoredPositions` for EVERY
      // object, not just those that would be clamped — simple + correct
      // over clever + sparse. (Slight bloat, fine for v1.)
      const previousDimensions = {
        width: scene.tank.width,
        height: scene.tank.height,
        depth: scene.tank.depth,
      };
      const restoredPositions: Record<string, { x: number; y: number; z: number }> = {};
      for (const layer of scene.layers) {
        for (const object of layer.objects) {
          restoredPositions[object.id] = { ...object.transform.position };
        }
      }
      // Likewise, the inverse-of-inverse needs the original (post-apply)
      // dimensions in `inverse.previousDimensions` so a second round-trip
      // also restores cleanly. Those are the `command.dimensions` we just
      // received.
      return {
        kind: 'SetTankDimensions',
        dimensions: { ...previousDimensions },
        inverse: {
          previousDimensions: { ...command.dimensions },
          restoredPositions,
        },
      };
    }

    case 'Composite': {
      // Invert children in reverse, each against the scene state they would
      // see at undo time. That state isn't `scene` directly; it's the result
      // of applying earlier children first. Walk forward to gather states,
      // then build the inverse list in reverse.
      const intermediate: Scene[] = [scene];
      let current = scene;
      for (const child of command.children) {
        const result = applyCommand(current, child);
        if (!result.ok) {
          // Composite would fail on apply; the inverse is a Noop.
          return { kind: 'Noop' };
        }
        current = result.scene;
        intermediate.push(current);
      }
      const inverseChildren: Command[] = [];
      for (let i = command.children.length - 1; i >= 0; i--) {
        const childScene = intermediate[i] as Scene;
        const child = command.children[i] as Command;
        inverseChildren.push(invertCommand(childScene, child));
      }
      return { kind: 'Composite', children: inverseChildren };
    }
  }
}

// ─── Builders (ergonomic constructors) ────────────────────────────────────
//
// Free-function builders return plain command objects. Use them or
// hand-roll the records — both round-trip identically.

export const noop = (): NoopCommand => ({ kind: 'Noop' });

export const addLayer = (layer: Layer, index: number | null = null): AddLayerCommand => ({
  kind: 'AddLayer',
  layer,
  index,
});

export const removeLayer = (layerId: LayerId): RemoveLayerCommand => ({
  kind: 'RemoveLayer',
  layerId,
});

export const renameLayer = (layerId: LayerId, name: string): RenameLayerCommand => ({
  kind: 'RenameLayer',
  layerId,
  name,
});

export const setLayerOpacity = (layerId: LayerId, opacity: number): SetLayerOpacityCommand => ({
  kind: 'SetLayerOpacity',
  layerId,
  opacity,
});

export const setLayerVisibility = (
  layerId: LayerId,
  visible: boolean,
): SetLayerVisibilityCommand => ({ kind: 'SetLayerVisibility', layerId, visible });

export const setLayerLocked = (layerId: LayerId, locked: boolean): SetLayerLockedCommand => ({
  kind: 'SetLayerLocked',
  layerId,
  locked,
});

export const reorderLayers = (order: LayerId[]): ReorderLayersCommand => ({
  kind: 'ReorderLayers',
  order,
});

export const addObject = (
  layerId: LayerId,
  object: SceneObject,
  index: number | null = null,
): AddObjectCommand => ({ kind: 'AddObject', layerId, object, index });

export const removeObject = (objectId: ObjectId): RemoveObjectCommand => ({
  kind: 'RemoveObject',
  objectId,
});

export const moveObject = (
  objectId: ObjectId,
  position: { x: number; y: number; z: number },
): MoveObjectCommand => ({ kind: 'MoveObject', objectId, position });

export const reshapeObject = (objectId: ObjectId, transform: Transform): ReshapeObjectCommand => ({
  kind: 'ReshapeObject',
  objectId,
  transform,
});

/**
 * Build a {@link SetTankDimensionsCommand} from new dimensions. The `inverse`
 * envelope is omitted (populated by {@link invertCommand} when undo is built).
 */
export const setTankDimensions = (dimensions: {
  width: number;
  height: number;
  depth: number;
}): SetTankDimensionsCommand => ({
  kind: 'SetTankDimensions',
  dimensions: { ...dimensions },
});

export const composite = (children: Command[]): CompositeCommand => ({
  kind: 'Composite',
  children,
});

// Re-export identity transform builder so tests/feature code can build a
// neutral transform without reaching directly into geometry. (Optional —
// pure ergonomics.)
export { identityTransform };
