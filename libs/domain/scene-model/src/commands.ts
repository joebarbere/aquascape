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

import {
  applyEquipmentCommand,
  invertEquipmentCommand,
  type EquipmentCommand,
} from './equipment-commands';
import {
  applyLivestockCommand,
  invertLivestockCommand,
  type LivestockCommand,
} from './livestock-commands';
import {
  applyNutrientCommand,
  invertNutrientCommand,
  type NutrientCommand,
} from './nutrient-commands';
import { getLayerById, getObjectWithLayer } from './selectors';
import {
  applySubstrateCommand,
  invertSubstrateCommand,
  type SubstrateCommand,
} from './substrate-commands';
import {
  applyWaterChangeCommand,
  invertWaterChangeCommand,
  type WaterChangeCommand,
} from './water-change-commands';
import type { HexColor, Layer, LayerId, ObjectId, Scene, SceneObject, TankStyle } from './types';

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
 * Set (or clear) a layer's optional `zone` hint. Metadata-only — NOT blocked
 * by `locked`, matching the existing layer-property convention (rename,
 * opacity, visibility, locked). Stage 10 / schema v2 follow-up.
 *
 * APPLY SEMANTICS
 *  - Layer-not-found rejects with `'not-found'`.
 *  - `zone === null` REMOVES the `zone` property entirely (the field is
 *    optional in the schema; `additionalProperties: false` rejects a literal
 *    `null`, and JSON.stringify drops `undefined`, so the only way an
 *    ungrouped layer round-trips identically is for the property to be
 *    absent). Same pattern as {@link SetObjectGroupIdCommand}.
 *  - `zone` set to `'foreground' | 'midground' | 'background'` writes the
 *    field.
 *  - Any other value rejects with `'invalid'` (defensive — TS catches this
 *    at compile time for normal callers).
 *
 * INVERT SEMANTICS
 *  - Captures the pre-apply zone into `inverse.previousZone` (the literal
 *    string, or `undefined` when the field was absent). On replay, an
 *    `inverse.previousZone === undefined` restores via `zone: null` (i.e.
 *    REMOVE the property); a captured string is reinstated.
 */
export interface SetLayerZoneCommand {
  kind: 'SetLayerZone';
  layerId: LayerId;
  /** New zone, or `null` to remove the property entirely. */
  zone: 'foreground' | 'midground' | 'background' | null;
  inverse?: { previousZone: 'foreground' | 'midground' | 'background' | undefined };
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
 * Flip an object about its local x- or y-axis (`flipX` or `flipY` on the
 * transform). Self-inverse — applying twice returns to the original state,
 * so `invertCommand` returns the same command back. Stage 3 F3.3.
 *
 * Locked layers block this (it's an object-level edit, unlike `SetTank
 * Dimensions`).
 */
export interface MirrorObjectCommand {
  kind: 'MirrorObject';
  objectId: ObjectId;
  axis: 'x' | 'y';
}

/**
 * Move an object to a new index within its current layer's `objects` array.
 * Within-layer z-position is just the index — the renderer paints
 * objects[0] first (back) and objects[length-1] last (front). Stage 3 F3.4.
 *
 * APPLY SEMANTICS
 *  - Validates `toIndex` ∈ [0, layer.objects.length). Out-of-range rejects
 *    with `'invalid'`.
 *  - Removes the object from its current index and re-inserts at `toIndex`.
 *  - No-op when the object is already at `toIndex`.
 *  - Blocked by `layer.locked` (object-level edit).
 *
 * INVERT
 *  - Inverse restores the object to its previous index. Symmetric.
 */
export interface ReorderObjectInLayerCommand {
  kind: 'ReorderObjectInLayer';
  objectId: ObjectId;
  toIndex: number;
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
 * Replace `scene.tank.style` with a new value. Structural / global
 * operation; NOT blocked by `locked` on any layer — `SetTankStyle` is
 * treated like `SetTankDimensions`, `RemoveLayer`, `ReorderLayers`.
 *
 * SHAPE — WHOLE-STYLE REPLACEMENT
 *
 * The command carries the **entire** replacement `TankStyle` rather than
 * a per-field patch. Rationale:
 *   - Matches how the UI dispatches: the styling panel's local state is
 *     one record; emitting "the new style" is simpler than diffing.
 *   - Inversion is trivial: snapshot the previous style, no patch merge.
 *   - The `background` union has mutually exclusive variants — a patch
 *     semantic would have to spell out how to remove fields when switching
 *     between e.g. `'color'` → `'gradient'`. That's a footgun; whole-style
 *     replacement sidesteps it.
 *
 * APPLY SEMANTICS
 *  1. Validates `style`. Rejects with `reason: 'invalid'` on:
 *     - `frame` not in `{'rimless','framed','braced'}`.
 *     - `frameColor` / `waterTint` present but not a well-formed hex color
 *       (`#RRGGBB` or `#RRGGBBAA`, case-insensitive).
 *     - `background.kind === 'color'`: `color` not a well-formed hex.
 *     - `background.kind === 'gradient'`:
 *       - `stops.length < 2` (schema-level too; defense in depth here).
 *       - any stop's `color` not a well-formed hex.
 *       - any stop's `at` non-finite or outside `[0, 1]`.
 *       - stops not sorted ascending by `at` — **non-strict** ascending,
 *         so two stops sharing an `at` (a hard-stop band) is legal.
 *       - `angle` non-finite.
 *     - `background.kind === 'image'`: missing `asset`, or `asset.id` /
 *       `asset.uri` not non-empty strings. (No deep validation of the
 *       asset bytes — that's the loader's job.)
 *  2. Replaces `scene.tank.style` with `structuredClone(style)` so the
 *     stored value is independent from any caller reference. Tank
 *     `width`/`height`/`depth`/`glassThickness`/`presetRef` are NOT
 *     touched.
 *
 * INVERT SEMANTICS
 * `invertCommand(scene, cmd)` returns a fresh `SetTankStyleCommand` whose
 * `style` is the pre-apply `scene.tank.style`, and whose `inverse.previousStyle`
 * is the original `cmd.style` (so inverse-of-inverse round-trips
 * structurally).
 *
 * **Inverse revalidation policy: always validate.** Apply does not
 * short-circuit validation when `inverse.previousStyle` is present — the
 * cost is microseconds (one shallow hex regex per color) and the
 * always-on path keeps the apply switch simple and catches any latent
 * bug that produced an invalid style upstream.
 *
 * A `SetTankStyleCommand` built freshly from the UI omits `inverse`; one
 * built by `invertCommand` carries it. Both are JSON-serializable.
 */
export interface SetTankStyleCommand {
  kind: 'SetTankStyle';
  /** The full replacement style. Whole-style replacement, not a patch. */
  style: TankStyle;
  /**
   * Pre-apply style captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command from the UI.
   */
  inverse?: { previousStyle: TankStyle };
}

/**
 * Set (or clear) the tank's authored water level — Stage 11 fidelity
 * follow-up. `waterLevelMm` is the water-surface height above the interior
 * floor in canonical integer mm; `null` clears the field back to the
 * default fill (`effectiveWaterLevelMm` then derives
 * `height − DEFAULT_WATER_GAP_BELOW_RIM_MM`).
 *
 * APPLY SEMANTICS
 *  - `null` → delete `tank.waterLevelMm`.
 *  - number → must be a finite value in `[1, tank.height]`; rounded to the
 *    canonical integer mm. Out-of-range / non-finite is REJECTED (the UI
 *    clamps before dispatch; the domain guard protects other callers).
 *  - Like `SetTankDimensions`, this is a structural global op — NOT
 *    blocked by `layer.locked` (it owns no layer content).
 *
 * INVERT SEMANTICS
 * `invertCommand(scene, cmd)` returns a fresh `SetWaterLevelCommand` whose
 * `waterLevelMm` is the pre-apply value (`null` when the field was unset),
 * with the would-be-applied value carried in `inverse` so
 * inverse-of-inverse round-trips structurally.
 */
export interface SetWaterLevelCommand {
  kind: 'SetWaterLevel';
  /** New authored level (mm above the floor), or `null` to clear. */
  waterLevelMm: number | null;
  /** Pre-apply value captured for inversion (`null` = field was unset). */
  inverse?: { previousWaterLevelMm: number | null };
}

/**
 * Set `groupId` on a list of objects in a single command. Stage 4 F4.3.
 *
 * Why one batch command instead of a Composite of N single-object commands?
 *  - Group / Ungroup is the user action; we want a single entry on the undo
 *    stack regardless of how many objects participate.
 *  - Inversion needs per-object pre-apply state (each object may already
 *    belong to a different group, including none). A batch makes that
 *    inverse envelope a single record.
 *
 * APPLY SEMANTICS
 *  - Validates that every object in `objectIds` exists. Rejects with
 *    `'not-found'` on the first miss.
 *  - Validates that no affected layer is locked. Rejects with `'locked'`.
 *  - Sets `groupId` on every listed object. When `groupId === null`, the
 *    `groupId` property is REMOVED (so a structural-equality check between
 *    "never grouped" and "ungrouped" matches — important for round-trip).
 *  - When `inverse.previousGroupIds` is present, per-object restoration
 *    takes precedence over the uniform `groupId`. This is how Undo can
 *    re-spread objects across multiple original groups in one shot.
 *
 * INVERT SEMANTICS
 *  - Captures every listed object's pre-apply `groupId` (or `null` when
 *    absent) into `inverse.previousGroupIds`. The inverse command's
 *    `groupId` is meaningless once `inverse` is present; we keep the field
 *    populated with `null` so the schema stays simple.
 */
export interface SetObjectGroupIdCommand {
  kind: 'SetObjectGroupId';
  objectIds: ObjectId[];
  /** New groupId. `null` removes the property entirely. */
  groupId: ObjectId | null;
  inverse?: {
    /**
     * Pre-apply `groupId` per object id. `null` means the property was
     * absent and should be removed on restore.
     */
    previousGroupIds: Record<string, string | null>;
  };
}

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
  | SetLayerZoneCommand
  | ReorderLayersCommand
  | AddObjectCommand
  | RemoveObjectCommand
  | MoveObjectCommand
  | ReshapeObjectCommand
  | MirrorObjectCommand
  | ReorderObjectInLayerCommand
  | SetObjectGroupIdCommand
  | SetTankDimensionsCommand
  | SetTankStyleCommand
  | SetWaterLevelCommand
  | SubstrateCommand
  | LivestockCommand
  | EquipmentCommand
  | NutrientCommand
  | WaterChangeCommand
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

/**
 * Return a copy of `obj` with `groupId` set to `next`, or with the property
 * deleted when `next === null`. Round-tripping through the document format
 * requires the property to be absent (not `undefined`, not `null`) when an
 * object is ungrouped — JSON.stringify drops `undefined` but not `null`, and
 * the schema's `additionalProperties: false` would reject a literal `null`.
 */
function withGroupId<T extends SceneObject>(obj: T, next: ObjectId | string | null): T {
  if (next === null) {
    if (obj.groupId === undefined) return obj;
    const { groupId: _gid, ...rest } = obj;
    return rest as T;
  }
  if (obj.groupId === next) return obj;
  return { ...obj, groupId: next as ObjectId };
}

/**
 * Return a copy of `layer` with `zone` set to `next`, or with the property
 * deleted when `next === null`. Same property-absent-vs-null contract as
 * {@link withGroupId} — JSON.stringify drops `undefined` but not `null`, and
 * the schema's `additionalProperties: false` would reject a literal `null`.
 */
function withZone(
  layer: Layer,
  next: 'foreground' | 'midground' | 'background' | null,
): Layer {
  if (next === null) {
    if (layer.zone === undefined) return layer;
    const { zone: _z, ...rest } = layer;
    return rest as Layer;
  }
  if (layer.zone === next) return layer;
  return { ...layer, zone: next };
}

// ─── TankStyle validation ─────────────────────────────────────────────────

/**
 * Hex-color shape: `#RRGGBB` or `#RRGGBBAA`, case-insensitive. Intentionally
 * narrow — three-digit shorthand (`#abc`) and CSS color names are NOT
 * accepted. Keeps the on-disk representation canonical.
 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/**
 * Returns `null` if `style` is valid; otherwise a human-readable message
 * describing the first thing wrong with it. The caller wraps the message
 * in a `rejected('invalid', ...)` result. Pure, no IO.
 */
function validateTankStyle(style: TankStyle): string | null {
  // frame
  if (style.frame !== 'rimless' && style.frame !== 'framed' && style.frame !== 'braced') {
    return `frame must be 'rimless' | 'framed' | 'braced'; got "${String(style.frame)}"`;
  }
  // optional colors
  if (style.frameColor !== undefined && !isHexColor(style.frameColor)) {
    return `frameColor must be a hex color (#RRGGBB or #RRGGBBAA); got "${String(style.frameColor)}"`;
  }
  if (style.waterTint !== undefined && !isHexColor(style.waterTint)) {
    return `waterTint must be a hex color (#RRGGBB or #RRGGBBAA); got "${String(style.waterTint)}"`;
  }
  // background
  const bg = style.background;
  switch (bg.kind) {
    case 'none':
      break;
    case 'color': {
      if (!isHexColor(bg.color)) {
        return `background.color must be a hex color; got "${String(bg.color)}"`;
      }
      break;
    }
    case 'image': {
      if (!bg.asset || typeof bg.asset !== 'object') {
        return `background.asset must be an AssetRef`;
      }
      if (typeof bg.asset.id !== 'string' || bg.asset.id.length === 0) {
        return `background.asset.id must be a non-empty string`;
      }
      if (typeof bg.asset.uri !== 'string' || bg.asset.uri.length === 0) {
        return `background.asset.uri must be a non-empty string`;
      }
      break;
    }
    case 'gradient': {
      if (!Number.isFinite(bg.angle)) {
        return `background.angle must be finite`;
      }
      if (!Array.isArray(bg.stops) || bg.stops.length < 2) {
        return `background.stops must have ≥ 2 entries`;
      }
      let prevAt = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < bg.stops.length; i++) {
        const stop = bg.stops[i] as { at: number; color: HexColor };
        if (!Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1) {
          return `background.stops[${i}].at must be a finite number in [0, 1]; got ${String(stop.at)}`;
        }
        if (!isHexColor(stop.color)) {
          return `background.stops[${i}].color must be a hex color; got "${String(stop.color)}"`;
        }
        // Non-strict ascending: equal `at` values are legal (hard-stop band).
        if (stop.at < prevAt) {
          return `background.stops must be sorted ascending by \`at\`; stop ${i} (${stop.at}) < previous (${prevAt})`;
        }
        prevAt = stop.at;
      }
      break;
    }
  }
  return null;
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

    case 'SetLayerZone': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return rejected('not-found', `SetLayerZone: layer "${command.layerId}" not found`);
      }
      // Not blocked by `locked` (metadata, not content).
      const next = command.zone;
      if (
        next !== null &&
        next !== 'foreground' &&
        next !== 'midground' &&
        next !== 'background'
      ) {
        return rejected(
          'invalid',
          `SetLayerZone: zone must be 'foreground' | 'midground' | 'background' | null; got "${String(next)}"`,
        );
      }
      return ok(replaceLayer(scene, command.layerId, withZone(layer, next)));
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
      const oldP = found.object.transform.position;
      const dx = command.position.x - oldP.x;
      const dy = command.position.y - oldP.y;
      const nextObject: SceneObject = {
        ...found.object,
        transform: {
          ...found.object.transform,
          position: { ...command.position },
        },
      };
      // Scatter plants carry their patch outline in absolute scene-space
      // mm (Plan §3 — `Patch outline in scene space (mm)`). MoveObject
      // changes the plant's `transform.position` but the renderer paints
      // scatter instances from `scatter.polygon` directly. Without
      // translating the polygon by the same delta, a Move (or arrow-key
      // nudge, or click-drag) shifts the transform's "anchor" but leaves
      // the actual patch visually pinned to the original position — the
      // user sees nothing change. Apply the position delta to every
      // polygon vertex so the patch tracks the move.
      if (
        nextObject.kind === 'plant' &&
        nextObject.scatter !== undefined &&
        (dx !== 0 || dy !== 0)
      ) {
        const polygon = nextObject.scatter.polygon.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        }));
        nextObject.scatter = { ...nextObject.scatter, polygon };
      }
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

    case 'MirrorObject': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return rejected('not-found', `MirrorObject: object "${command.objectId}" not found`);
      }
      if (found.layer.locked) {
        return rejected('locked', `MirrorObject: layer "${found.layer.id}" is locked`);
      }
      // **Plants never flip vertically.** Roots must stay at the bottom
      // (a plant with its leaves below its substrate anchor is not a
      // thing). Reject axis='y' on plant objects; the inspector also
      // disables the Mirror V button when a plant is selected.
      if (command.axis === 'y' && found.object.kind === 'plant') {
        return rejected(
          'invalid',
          `MirrorObject: vertical flip is not allowed on plant objects`,
        );
      }
      const transform: Transform =
        command.axis === 'x'
          ? { ...found.object.transform, flipX: !found.object.transform.flipX }
          : { ...found.object.transform, flipY: !found.object.transform.flipY };
      const nextObject: SceneObject = { ...found.object, transform };
      const objects = found.layer.objects.map((o) => (o.id === command.objectId ? nextObject : o));
      return ok(replaceLayer(scene, found.layer.id, { ...found.layer, objects }));
    }

    case 'ReorderObjectInLayer': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return rejected(
          'not-found',
          `ReorderObjectInLayer: object "${command.objectId}" not found`,
        );
      }
      if (found.layer.locked) {
        return rejected('locked', `ReorderObjectInLayer: layer "${found.layer.id}" is locked`);
      }
      const fromIndex = found.layer.objects.findIndex((o) => o.id === command.objectId);
      const len = found.layer.objects.length;
      if (command.toIndex < 0 || command.toIndex >= len) {
        return rejected(
          'invalid',
          `ReorderObjectInLayer: toIndex ${command.toIndex} is out of range [0, ${len - 1}]`,
        );
      }
      if (fromIndex === command.toIndex) {
        return ok(scene); // No-op, identity result.
      }
      const objects = found.layer.objects.slice();
      const [moved] = objects.splice(fromIndex, 1);
      objects.splice(command.toIndex, 0, moved!);
      return ok(replaceLayer(scene, found.layer.id, { ...found.layer, objects }));
    }

    case 'SetObjectGroupId': {
      // Resolve targets + lock + existence check. Done in a first pass so a
      // partial failure leaves the scene untouched (atomic).
      const ids = command.objectIds;
      if (ids.length === 0) return ok(scene);
      const found: Array<{ layerIndex: number; objectIndex: number }> = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as ObjectId;
        let layerIndex = -1;
        let objectIndex = -1;
        for (let li = 0; li < scene.layers.length; li++) {
          const layer = scene.layers[li] as Layer;
          const oi = layer.objects.findIndex((o) => o.id === id);
          if (oi >= 0) {
            layerIndex = li;
            objectIndex = oi;
            break;
          }
        }
        if (layerIndex < 0) {
          return rejected('not-found', `SetObjectGroupId: object "${id}" not found`);
        }
        const layer = scene.layers[layerIndex] as Layer;
        if (layer.locked) {
          return rejected('locked', `SetObjectGroupId: layer "${layer.id}" is locked`);
        }
        found.push({ layerIndex, objectIndex });
      }

      // Build the per-object groupId map we'll write. Restoration envelope
      // takes precedence; otherwise everything maps to `command.groupId`.
      const restorations = command.inverse?.previousGroupIds;
      const layers = scene.layers.slice();
      const layerObjectsDirty = new Map<number, SceneObject[]>();
      for (let i = 0; i < found.length; i++) {
        const slot = found[i] as { layerIndex: number; objectIndex: number };
        const id = ids[i] as ObjectId;
        const layer = layers[slot.layerIndex] as Layer;
        const objects = layerObjectsDirty.get(slot.layerIndex) ?? layer.objects.slice();
        layerObjectsDirty.set(slot.layerIndex, objects);
        const oldObj = objects[slot.objectIndex] as SceneObject;
        const target =
          restorations !== undefined && Object.prototype.hasOwnProperty.call(restorations, id)
            ? (restorations[id] ?? null)
            : command.groupId;
        const nextObj: SceneObject = withGroupId(oldObj, target);
        objects[slot.objectIndex] = nextObj;
      }
      for (const [li, objects] of layerObjectsDirty) {
        const layer = layers[li] as Layer;
        layers[li] = { ...layer, objects };
      }
      return ok({ ...scene, layers });
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

    case 'SetTankStyle': {
      // Always validate, even when an `inverse` envelope is present. The
      // cost is a few regex checks; the always-on path keeps the apply
      // switch simple and catches latent bugs.
      const err = validateTankStyle(command.style);
      if (err !== null) {
        return rejected('invalid', `SetTankStyle: ${err}`);
      }
      // Whole-style replacement. Tank dimensions / glassThickness /
      // presetRef are NOT touched. structuredClone so the stored style is
      // independent of any caller reference.
      const nextTank: Scene['tank'] = {
        ...scene.tank,
        style: clone(command.style),
      };
      return ok({ ...scene, tank: nextTank });
    }

    case 'SetWaterLevel': {
      if (command.waterLevelMm === null) {
        // Clear back to the default fill. Drop the field entirely (the
        // document stays minimal; `effectiveWaterLevelMm` derives).
        const { waterLevelMm: _cleared, ...rest } = scene.tank;
        void _cleared;
        return ok({ ...scene, tank: rest });
      }
      if (!Number.isFinite(command.waterLevelMm)) {
        return rejected('invalid', 'SetWaterLevel: waterLevelMm must be finite');
      }
      const rounded = Math.round(command.waterLevelMm);
      if (rounded < 1 || rounded > scene.tank.height) {
        return rejected(
          'invalid',
          `SetWaterLevel: waterLevelMm must be in [1, ${scene.tank.height}] (got ${rounded})`,
        );
      }
      return ok({ ...scene, tank: { ...scene.tank, waterLevelMm: rounded } });
    }

    case 'AddSubstrateRegion':
    case 'RemoveSubstrateRegion':
    case 'SetSubstrateRegionMaterial':
    case 'SetSubstrateRegionExtent':
    case 'SetSubstrateRegionProfile': {
      // Substrate commands are global-structural (no per-layer lock guard);
      // delegate to the substrate-commands module so the union stays
      // tractable here while the substrate-specific validation + mutation
      // lives with its types.
      return applySubstrateCommand(scene, command);
    }

    case 'AddLivestockEntry':
    case 'RemoveLivestockEntry':
    case 'UpdateLivestockQuantity': {
      // Livestock commands don't target any layer, so the locked-layer guard
      // doesn't apply. Delegate to the livestock-commands module.
      return applyLivestockCommand(scene, command);
    }

    case 'AddEquipmentEntry':
    case 'RemoveEquipmentEntry':
    case 'SetEquipmentNote':
    case 'UpdateEquipmentSettings': {
      // Equipment commands don't target any layer, so the locked-layer guard
      // doesn't apply. Delegate to the equipment-commands module. Stage 7
      // F7.3 — symmetric follow-up to the F7.1 livestock promotion.
      return applyEquipmentCommand(scene, command);
    }

    case 'DoseNutrient':
    case 'RemoveDoseEvent': {
      // Dosing isn't object-scoped (a DoseEvent belongs to no layer), so the
      // locked-layer guard doesn't apply. Delegate to the nutrient-commands
      // module. F-B — runtime-only; chemistry effect deferred to Stage 13.
      return applyNutrientCommand(scene, command);
    }

    case 'WaterChange': {
      // A water change isn't object-scoped (it belongs to no layer), so the
      // locked-layer guard doesn't apply. Delegate to the water-change module.
      // Stage 13 F13.5a — dilutes the water column, never the bacterial colony.
      return applyWaterChangeCommand(scene, command);
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

    case 'SetLayerZone': {
      const layer = getLayerById(scene, command.layerId);
      if (layer === null) {
        return { kind: 'Noop' };
      }
      // Capture the pre-apply zone. `undefined` (property absent) round-trips
      // as `zone: null` on restore — i.e. remove the property again. A
      // captured string is reinstated verbatim.
      const previousZone = layer.zone;
      return {
        kind: 'SetLayerZone',
        layerId: command.layerId,
        zone: previousZone ?? null,
        inverse: { previousZone },
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

    case 'MirrorObject': {
      // Self-inverse: applying MirrorObject twice returns to the original.
      // Same command works as its own inverse — but only when the target
      // object actually exists; for a missing id (which apply would reject)
      // the inverse is a Noop so undo-stack replays stay clean.
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) return { kind: 'Noop' };
      return { kind: 'MirrorObject', objectId: command.objectId, axis: command.axis };
    }

    case 'ReorderObjectInLayer': {
      const found = getObjectWithLayer(scene, command.objectId);
      if (found === null) {
        return { kind: 'Noop' };
      }
      const previousIndex = found.layer.objects.findIndex((o) => o.id === command.objectId);
      return {
        kind: 'ReorderObjectInLayer',
        objectId: command.objectId,
        toIndex: previousIndex,
      };
    }

    case 'SetObjectGroupId': {
      const ids = command.objectIds;
      if (ids.length === 0) return { kind: 'Noop' };
      const previousGroupIds: Record<string, string | null> = {};
      let anyMissing = false;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as ObjectId;
        const found = getObjectWithLayer(scene, id);
        if (found === null) {
          anyMissing = true;
          break;
        }
        const current = (found.object as SceneObject).groupId;
        previousGroupIds[id] = current ?? null;
      }
      if (anyMissing) {
        // Apply would have rejected; replay-safe inverse is Noop.
        return { kind: 'Noop' };
      }
      return {
        kind: 'SetObjectGroupId',
        objectIds: ids.slice(),
        groupId: null,
        inverse: { previousGroupIds },
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

    case 'SetTankStyle': {
      // Snapshot the pre-apply style, deep-cloned so future scene edits
      // can't mutate the captured inverse. Carry the would-be-applied
      // style in `inverse.previousStyle` so inverse-of-inverse also
      // round-trips structurally.
      return {
        kind: 'SetTankStyle',
        style: clone(scene.tank.style),
        inverse: { previousStyle: clone(command.style) },
      };
    }

    case 'SetWaterLevel': {
      // Pre-apply value (null = unset) becomes the inverse's payload.
      return {
        kind: 'SetWaterLevel',
        waterLevelMm: scene.tank.waterLevelMm ?? null,
        inverse: { previousWaterLevelMm: command.waterLevelMm },
      };
    }

    case 'AddSubstrateRegion':
    case 'RemoveSubstrateRegion':
    case 'SetSubstrateRegionMaterial':
    case 'SetSubstrateRegionExtent':
    case 'SetSubstrateRegionProfile': {
      return invertSubstrateCommand(scene, command);
    }

    case 'AddLivestockEntry':
    case 'RemoveLivestockEntry':
    case 'UpdateLivestockQuantity': {
      return invertLivestockCommand(scene, command);
    }

    case 'AddEquipmentEntry':
    case 'RemoveEquipmentEntry':
    case 'SetEquipmentNote':
    case 'UpdateEquipmentSettings': {
      return invertEquipmentCommand(scene, command);
    }

    case 'DoseNutrient':
    case 'RemoveDoseEvent': {
      return invertNutrientCommand(scene, command);
    }

    case 'WaterChange': {
      return invertWaterChangeCommand(scene, command);
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

/**
 * Build a {@link SetLayerZoneCommand}. Pass `zone: null` to remove the zone
 * property entirely (round-trips as the field being absent). The `inverse`
 * envelope is omitted; {@link invertCommand} populates it.
 */
export const setLayerZone = (
  layerId: LayerId,
  zone: 'foreground' | 'midground' | 'background' | null,
): SetLayerZoneCommand => ({ kind: 'SetLayerZone', layerId, zone });

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

/** Build a {@link MirrorObjectCommand}. Self-inverse — applying twice is identity. */
export const mirrorObject = (objectId: ObjectId, axis: 'x' | 'y'): MirrorObjectCommand => ({
  kind: 'MirrorObject',
  objectId,
  axis,
});

/** Build a {@link ReorderObjectInLayerCommand}. `toIndex` ∈ [0, layer.objects.length). */
export const reorderObjectInLayer = (
  objectId: ObjectId,
  toIndex: number,
): ReorderObjectInLayerCommand => ({
  kind: 'ReorderObjectInLayer',
  objectId,
  toIndex,
});

/**
 * Build a {@link SetObjectGroupIdCommand}. Pass `groupId: null` to ungroup.
 * `objectIds` may be a single id (the constructor wraps it) or an array.
 * The `inverse` envelope is omitted; {@link invertCommand} populates it
 * when undo is built.
 */
export const setObjectGroupId = (
  objectIds: ObjectId | ReadonlyArray<ObjectId>,
  groupId: ObjectId | null,
): SetObjectGroupIdCommand => ({
  kind: 'SetObjectGroupId',
  objectIds: Array.isArray(objectIds) ? objectIds.slice() : [objectIds as ObjectId],
  groupId,
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

/**
 * Build a {@link SetTankStyleCommand} from a new full style. The `inverse`
 * envelope is omitted; {@link invertCommand} populates it when undo is
 * built. The argument is taken by reference — `applyCommand` deep-clones
 * before storing.
 */
export const setTankStyle = (style: TankStyle): SetTankStyleCommand => ({
  kind: 'SetTankStyle',
  style,
});

/**
 * Build a {@link SetWaterLevelCommand}. `waterLevelMm` is the new authored
 * water-surface height above the floor (mm), or `null` to clear back to
 * the default fill. The `inverse` envelope is omitted; {@link invertCommand}
 * populates it when undo is built.
 */
export const setWaterLevel = (waterLevelMm: number | null): SetWaterLevelCommand => ({
  kind: 'SetWaterLevel',
  waterLevelMm,
});

export const composite = (children: Command[]): CompositeCommand => ({
  kind: 'Composite',
  children,
});

// Re-export identity transform builder so tests/feature code can build a
// neutral transform without reaching directly into geometry. (Optional —
// pure ergonomics.)
export { identityTransform };
