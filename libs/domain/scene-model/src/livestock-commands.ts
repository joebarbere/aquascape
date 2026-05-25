/**
 * Livestock commands. Stage 7 F7.1.
 *
 * Lives in a sibling module to keep `commands.ts` manageable, matching the
 * pattern set by `substrate-commands.ts`. The union extension + apply/invert
 * switch cases + builder helpers all live here; `commands.ts` only imports
 * the union extension + the two dispatcher hooks and folds them into its
 * own switch.
 *
 * DESIGN
 * ------
 * Three commands cover the livestock UX surface:
 *
 *   - `AddLivestockEntry({ entry })` — append to `scene.livestock`,
 *     initializing the array when undefined. Inverse: remove by id, with
 *     the entry + original index captured.
 *
 *   - `RemoveLivestockEntry({ entryId })` — locate by id, capture entry +
 *     index into the dispatched command's `inverse`, then filter out.
 *     Inverse: re-insert at the captured index so undo restores ordering.
 *
 *   - `UpdateLivestockQuantity({ entryId, quantity })` — replace the entry's
 *     quantity. `quantity` must be a positive integer; non-integer / < 1
 *     rejects with `'invalid'`. Inverse captures `previousQuantity`.
 *
 * **No locked-layer guard.** Livestock entries don't belong to layers, so
 * the locked-layer policy in `commands.ts` doesn't apply here. Livestock
 * commands always run regardless of any layer's `locked` flag.
 *
 * Following the substrate-commands convention, validation runs every apply
 * (including when an `inverse` envelope is present) so latent bugs upstream
 * surface at the apply boundary, not in a downstream consumer.
 */

import type { CatalogRef, LivestockEntry, Scene, Uuid } from './types';

// ─── Command shapes ───────────────────────────────────────────────────────

/**
 * Append a livestock entry to `scene.livestock` (initializing the array if
 * undefined). The `entry` carries its own id; the caller is responsible for
 * minting a fresh UUID. Inverse: a `RemoveLivestockEntry` keyed off the
 * entry's id.
 *
 * `index` is omitted on UI dispatch (append). The Remove → invert pathway
 * sets `index` so the original ordinal of the removed entry is restored on
 * undo. Mirrors `AddSubstrateRegionCommand`'s optional-index slot.
 */
export interface AddLivestockEntryCommand {
  kind: 'AddLivestockEntry';
  entry: LivestockEntry;
  /** Insertion index; null/out-of-range/omitted → append. */
  index?: number | null;
}

/**
 * Remove a livestock entry by id. Apply captures the removed entry + its
 * index into `inverse` (populated on the dispatched command record so the
 * undo step can re-insert at the original ordinal). Reports `'not-found'`
 * when no entry has that id.
 *
 * APPLY SEMANTICS
 *   - Find the entry by `entryId`. If missing → `{ ok: false, reason:
 *     'not-found' }`, scene unchanged.
 *   - Filter the entry out; return the new scene. The dispatcher is
 *     responsible for writing the captured `{ entry, index }` into the
 *     `inverse` envelope of the stored command record (i.e. the input
 *     command is NOT mutated; `invertCommand` returns the inverse
 *     `AddLivestockEntry`).
 *
 * INVERT SEMANTICS
 *   - Return an `AddLivestockEntry` carrying a deep clone of the entry.
 *     The undo flow re-inserts at the captured index — see `applyCommand`
 *     for `AddLivestockEntry` which honours an optional index slot when we
 *     add one in the future. For v1 we re-append (livestock has no
 *     user-visible ordering semantics today); preservation of the original
 *     index is captured anyway in `inverse` so a future ordering-aware
 *     undo can use it without breaking serialized records.
 */
export interface RemoveLivestockEntryCommand {
  kind: 'RemoveLivestockEntry';
  entryId: Uuid;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * typically omitted on a freshly-built command from the UI.
   */
  inverse?: { entry: LivestockEntry; index: number };
}

/**
 * Replace a livestock entry's `quantity`. Apply validates `quantity` is an
 * integer ≥ 1 (livestock is "how many of this species"; 0 / negative /
 * fractional don't model anything meaningful).
 *
 * Reports `'invalid'` when quantity violates the constraint, `'not-found'`
 * when no entry has that id. Inverse captures `previousQuantity`.
 */
export interface UpdateLivestockQuantityCommand {
  kind: 'UpdateLivestockQuantity';
  entryId: Uuid;
  quantity: number;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command from the UI.
   */
  inverse?: { previousQuantity: number };
}

/** Discriminated union of all livestock commands. */
export type LivestockCommand =
  | AddLivestockEntryCommand
  | RemoveLivestockEntryCommand
  | UpdateLivestockQuantityCommand;

// ─── Helpers ──────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

function findEntry(
  scene: Scene,
  entryId: Uuid,
): { entry: LivestockEntry; index: number } | null {
  const list = scene.livestock;
  if (list === undefined) return null;
  const index = list.findIndex((e) => e.id === entryId);
  if (index < 0) return null;
  return { entry: list[index] as LivestockEntry, index };
}

function validateCatalogRefShape(ref: CatalogRef, label: string): string | null {
  if (typeof ref !== 'object' || ref === null) return `${label} must be an object`;
  if (typeof ref.catalog !== 'string' || ref.catalog.length === 0) {
    return `${label}.catalog must be a non-empty string`;
  }
  if (typeof ref.id !== 'string' || ref.id.length === 0) {
    return `${label}.id must be a non-empty string`;
  }
  if (!Number.isInteger(ref.version) || ref.version < 1) {
    return `${label}.version must be a positive integer`;
  }
  return null;
}

function validateEntry(entry: LivestockEntry): string | null {
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    return 'entry.id must be a non-empty string';
  }
  const refErr = validateCatalogRefShape(entry.ref, 'entry.ref');
  if (refErr !== null) return refErr;
  if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
    return `entry.quantity must be a positive integer; got ${String(entry.quantity)}`;
  }
  return null;
}

// ─── Apply ────────────────────────────────────────────────────────────────

/**
 * Apply a livestock command. Mirrors the `CommandResult` shape used by
 * `commands.applyCommand` so the main dispatcher can delegate without
 * adapting types.
 */
export function applyLivestockCommand(
  scene: Scene,
  command: LivestockCommand,
):
  | { ok: true; scene: Scene }
  | { ok: false; reason: 'invalid' | 'not-found' | 'locked'; message: string } {
  switch (command.kind) {
    case 'AddLivestockEntry': {
      const err = validateEntry(command.entry);
      if (err !== null) {
        return { ok: false, reason: 'invalid', message: `AddLivestockEntry: ${err}` };
      }
      const current = scene.livestock ?? [];
      if (current.some((e) => e.id === command.entry.id)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `AddLivestockEntry: entry id "${command.entry.id}" already exists`,
        };
      }
      const livestock = current.slice();
      const length = current.length;
      const insertAt =
        command.index === undefined ||
        command.index === null ||
        command.index < 0 ||
        command.index > length
          ? length
          : command.index;
      livestock.splice(insertAt, 0, clone(command.entry));
      return { ok: true, scene: { ...scene, livestock } };
    }

    case 'RemoveLivestockEntry': {
      const found = findEntry(scene, command.entryId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `RemoveLivestockEntry: entry "${command.entryId}" not found`,
        };
      }
      const list = scene.livestock as LivestockEntry[];
      const livestock = list.slice();
      livestock.splice(found.index, 1);
      // Empty array → drop the field so "absent stays absent" round-trip
      // holds across Add → invert(Remove) when the original scene had no
      // `livestock` property at all.
      if (livestock.length === 0) {
        const { livestock: _omit, ...sceneWithout } = scene;
        return { ok: true, scene: sceneWithout };
      }
      return { ok: true, scene: { ...scene, livestock } };
    }

    case 'UpdateLivestockQuantity': {
      if (!Number.isInteger(command.quantity) || command.quantity < 1) {
        return {
          ok: false,
          reason: 'invalid',
          message: `UpdateLivestockQuantity: quantity must be a positive integer; got ${String(command.quantity)}`,
        };
      }
      const found = findEntry(scene, command.entryId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `UpdateLivestockQuantity: entry "${command.entryId}" not found`,
        };
      }
      const list = scene.livestock as LivestockEntry[];
      const livestock = list.slice();
      livestock[found.index] = { ...found.entry, quantity: command.quantity };
      return { ok: true, scene: { ...scene, livestock } };
    }
  }
}

// ─── Invert ───────────────────────────────────────────────────────────────

/**
 * Build the inverse for a livestock command given the scene it will/did
 * apply to. Returns a `LivestockCommand` or a `'Noop'`-shaped record when
 * the forward command would have rejected (Noop is sound here for the same
 * reason it is in substrate-commands: "apply nothing then invert nothing"
 * preserves state).
 */
export function invertLivestockCommand(
  scene: Scene,
  command: LivestockCommand,
): LivestockCommand | { kind: 'Noop' } {
  switch (command.kind) {
    case 'AddLivestockEntry': {
      // Inverse: remove the entry we'd have just added. Reverse-of-reverse
      // (re-add via inverse-of-inverse) reconstructs the entry from the
      // inverse envelope that `invertCommand` populates on the
      // RemoveLivestockEntry below.
      return { kind: 'RemoveLivestockEntry', entryId: command.entry.id };
    }

    case 'RemoveLivestockEntry': {
      const found = findEntry(scene, command.entryId);
      if (found === null) return { kind: 'Noop' };
      // Inverse re-adds the entry at its original index so undo restores
      // ordering. The captured index doubles as the inverse-of-inverse
      // signal — a subsequent Remove that runs after this Add finds the
      // entry where the original Remove left it.
      return {
        kind: 'AddLivestockEntry',
        entry: clone(found.entry),
        index: found.index,
      };
    }

    case 'UpdateLivestockQuantity': {
      const found = findEntry(scene, command.entryId);
      if (found === null) return { kind: 'Noop' };
      return {
        kind: 'UpdateLivestockQuantity',
        entryId: command.entryId,
        quantity: found.entry.quantity,
        inverse: { previousQuantity: command.quantity },
      };
    }
  }
}

// ─── Builder helpers ──────────────────────────────────────────────────────

export const addLivestockEntry = (entry: LivestockEntry): AddLivestockEntryCommand => ({
  kind: 'AddLivestockEntry',
  entry,
});

export const removeLivestockEntry = (entryId: Uuid): RemoveLivestockEntryCommand => ({
  kind: 'RemoveLivestockEntry',
  entryId,
});

export const updateLivestockQuantity = (
  entryId: Uuid,
  quantity: number,
): UpdateLivestockQuantityCommand => ({
  kind: 'UpdateLivestockQuantity',
  entryId,
  quantity,
});
