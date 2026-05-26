/**
 * Equipment commands. Stage 7 F7.3.
 *
 * Symmetric follow-up to `livestock-commands.ts` — equipment was promoted
 * off the document envelope onto `Scene` so mutations can flow through the
 * Command pipeline with undo/redo. Pattern mirrors livestock exactly except
 * for the two equipment-specific commands (`SetEquipmentNote`,
 * `UpdateEquipmentSettings`).
 *
 * DESIGN
 * ------
 * Four commands cover the equipment UX surface:
 *
 *   - `AddEquipmentEntry({ entry })` — append to `scene.equipment`,
 *     initializing the array when undefined. Inverse: remove by id, with
 *     the entry + original index captured.
 *
 *   - `RemoveEquipmentEntry({ entryId })` — locate by id, capture entry +
 *     index into the dispatched command's `inverse`, then filter out.
 *     Inverse: re-insert at the captured index so undo restores ordering.
 *
 *   - `SetEquipmentNote({ entryId, note })` — set, replace, or clear the
 *     entry's `note`. **`note: null` deletes the property entirely** so the
 *     absent-on-disk shape round-trips correctly (same pattern as
 *     `SetObjectGroupId` — JSON.stringify drops `undefined` but not `null`,
 *     and the schema's `additionalProperties: false` would reject a literal
 *     `null`). Empty string `''` is REJECTED with `'invalid'` so the UI
 *     must dispatch either a real note string or `null` to clear (no
 *     accidentally-empty notes ride around). Inverse captures
 *     `previousNote` (undefined when no note was set).
 *
 *   - `UpdateEquipmentSettings({ entryId, settings })` — WHOLESALE-replace
 *     the entry's `settings` (no merge — matches `SetTankStyle` /
 *     `SetSubstrateRegionProfile`). `settings: null` deletes the property
 *     entirely. Every value in the new settings must be a primitive
 *     `number | string | boolean`; nested objects / arrays / `null` /
 *     `undefined` values reject with `'invalid'`. Inverse captures
 *     `previousSettings` (undefined when no settings were set).
 *
 * **No locked-layer guard.** Equipment entries don't belong to layers, so
 * the locked-layer policy in `commands.ts` doesn't apply here. Equipment
 * commands always run regardless of any layer's `locked` flag.
 *
 * Following the substrate-commands convention, validation runs every apply
 * (including when an `inverse` envelope is present) so latent bugs upstream
 * surface at the apply boundary, not in a downstream consumer.
 */

import type { CatalogRef, EquipmentEntry, Scene, Uuid } from './types';

// ─── Command shapes ───────────────────────────────────────────────────────

/**
 * Append an equipment entry to `scene.equipment` (initializing the array if
 * undefined). The `entry` carries its own id; the caller is responsible for
 * minting a fresh UUID. Inverse: a `RemoveEquipmentEntry` keyed off the
 * entry's id.
 *
 * `index` is omitted on UI dispatch (append). The Remove → invert pathway
 * sets `index` so the original ordinal of the removed entry is restored on
 * undo. Mirrors `AddLivestockEntryCommand`'s optional-index slot.
 */
export interface AddEquipmentEntryCommand {
  kind: 'AddEquipmentEntry';
  entry: EquipmentEntry;
  /** Insertion index; null/out-of-range/omitted → append. */
  index?: number | null;
}

/**
 * Remove an equipment entry by id. Apply captures the removed entry + its
 * index into `inverse` (populated on the dispatched command record so the
 * undo step can re-insert at the original ordinal). Reports `'not-found'`
 * when no entry has that id.
 */
export interface RemoveEquipmentEntryCommand {
  kind: 'RemoveEquipmentEntry';
  entryId: Uuid;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * typically omitted on a freshly-built command from the UI.
   */
  inverse?: { entry: EquipmentEntry; index: number };
}

/**
 * Set, replace, or clear an equipment entry's `note`.
 *
 *  - A non-empty string sets the note.
 *  - `null` REMOVES the `note` property entirely (round-trip "absent stays
 *    absent" — JSON.stringify drops `undefined` but not `null`, and the
 *    schema's `additionalProperties: false` would reject literal `null`).
 *  - Empty string `''` is REJECTED with `'invalid'` — the UI must dispatch
 *    either a real note or `null` to clear; no silent-empty notes.
 *
 * Inverse captures `previousNote` (undefined when no note was set). On
 * undo, `previousNote === undefined` → remove the property via null;
 * otherwise → set the string back.
 */
export interface SetEquipmentNoteCommand {
  kind: 'SetEquipmentNote';
  entryId: Uuid;
  /** New note. `null` removes the property entirely. */
  note: string | null;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command from the UI.
   */
  inverse?: { previousNote: string | undefined };
}

/**
 * WHOLESALE-replace an equipment entry's `settings`. No merge — matches
 * the `SetTankStyle` / `SetSubstrateRegionProfile` whole-replace pattern.
 *
 *  - A `Record<string, number | string | boolean>` replaces the settings.
 *    Every value must be a primitive; nested objects / arrays / `null` /
 *    `undefined` values reject with `'invalid'`.
 *  - `null` REMOVES the `settings` property entirely.
 *
 * Inverse captures `previousSettings` (undefined when no settings were
 * set). On undo, `previousSettings === undefined` → remove via null;
 * otherwise → replace with the captured object.
 */
export interface UpdateEquipmentSettingsCommand {
  kind: 'UpdateEquipmentSettings';
  entryId: Uuid;
  /** New settings (wholesale replace). `null` removes the property entirely. */
  settings: Record<string, number | string | boolean> | null;
  /**
   * Pre-apply state captured for inversion. Populated by `invertCommand`;
   * omitted on a freshly-built command from the UI.
   */
  inverse?: { previousSettings: Record<string, number | string | boolean> | undefined };
}

/** Discriminated union of all equipment commands. */
export type EquipmentCommand =
  | AddEquipmentEntryCommand
  | RemoveEquipmentEntryCommand
  | SetEquipmentNoteCommand
  | UpdateEquipmentSettingsCommand;

// ─── Helpers ──────────────────────────────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

function findEntry(
  scene: Scene,
  entryId: Uuid,
): { entry: EquipmentEntry; index: number } | null {
  const list = scene.equipment;
  if (list === undefined) return null;
  const index = list.findIndex((e) => e.id === entryId);
  if (index < 0) return null;
  return { entry: list[index] as EquipmentEntry, index };
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

function validateSettingsShape(
  settings: Record<string, unknown>,
  label: string,
): string | null {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return `${label} must be a plain object`;
  }
  for (const key of Object.keys(settings)) {
    const value = settings[key];
    if (
      typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'boolean'
    ) {
      return `${label}.${key} must be a number, string, or boolean`;
    }
  }
  return null;
}

function validateEntry(entry: EquipmentEntry): string | null {
  if (typeof entry.id !== 'string' || entry.id.length === 0) {
    return 'entry.id must be a non-empty string';
  }
  const refErr = validateCatalogRefShape(entry.ref, 'entry.ref');
  if (refErr !== null) return refErr;
  if (entry.settings !== undefined) {
    const settingsErr = validateSettingsShape(entry.settings, 'entry.settings');
    if (settingsErr !== null) return settingsErr;
  }
  if (entry.note !== undefined && typeof entry.note !== 'string') {
    return 'entry.note must be a string when present';
  }
  return null;
}

/**
 * Return a copy of `entry` with `note` set to `next`, or with the property
 * deleted when `next === null`. Round-tripping through the document format
 * requires the property to be absent (not `undefined`, not `null`) when an
 * entry has no note — same rationale as `withGroupId` for object groups.
 */
function withNote(entry: EquipmentEntry, next: string | null): EquipmentEntry {
  if (next === null) {
    if (entry.note === undefined) return entry;
    const { note: _omit, ...rest } = entry;
    return rest;
  }
  if (entry.note === next) return entry;
  return { ...entry, note: next };
}

/**
 * Return a copy of `entry` with `settings` set to `next`, or with the
 * property deleted when `next === null`. Same round-trip rationale as
 * `withNote` above.
 */
function withSettings(
  entry: EquipmentEntry,
  next: Record<string, number | string | boolean> | null,
): EquipmentEntry {
  if (next === null) {
    if (entry.settings === undefined) return entry;
    const { settings: _omit, ...rest } = entry;
    return rest;
  }
  return { ...entry, settings: { ...next } };
}

// ─── Apply ────────────────────────────────────────────────────────────────

/**
 * Apply an equipment command. Mirrors the `CommandResult` shape used by
 * `commands.applyCommand` so the main dispatcher can delegate without
 * adapting types.
 */
export function applyEquipmentCommand(
  scene: Scene,
  command: EquipmentCommand,
):
  | { ok: true; scene: Scene }
  | { ok: false; reason: 'invalid' | 'not-found' | 'locked'; message: string } {
  switch (command.kind) {
    case 'AddEquipmentEntry': {
      const err = validateEntry(command.entry);
      if (err !== null) {
        return { ok: false, reason: 'invalid', message: `AddEquipmentEntry: ${err}` };
      }
      const current = scene.equipment ?? [];
      if (current.some((e) => e.id === command.entry.id)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `AddEquipmentEntry: entry id "${command.entry.id}" already exists`,
        };
      }
      const equipment = current.slice();
      const length = current.length;
      const insertAt =
        command.index === undefined ||
        command.index === null ||
        command.index < 0 ||
        command.index > length
          ? length
          : command.index;
      equipment.splice(insertAt, 0, clone(command.entry));
      return { ok: true, scene: { ...scene, equipment } };
    }

    case 'RemoveEquipmentEntry': {
      const found = findEntry(scene, command.entryId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `RemoveEquipmentEntry: entry "${command.entryId}" not found`,
        };
      }
      const list = scene.equipment as EquipmentEntry[];
      const equipment = list.slice();
      equipment.splice(found.index, 1);
      // Empty array → drop the field so "absent stays absent" round-trip
      // holds across Add → invert(Remove) when the original scene had no
      // `equipment` property at all.
      if (equipment.length === 0) {
        const { equipment: _omit, ...sceneWithout } = scene;
        return { ok: true, scene: sceneWithout };
      }
      return { ok: true, scene: { ...scene, equipment } };
    }

    case 'SetEquipmentNote': {
      // Empty string is REJECTED — the UI must dispatch a real note or
      // `null` to clear. Silent-empty notes have no UX meaning and would
      // round-trip as the schema-illegal `note: ''`.
      if (command.note !== null && command.note === '') {
        return {
          ok: false,
          reason: 'invalid',
          message: `SetEquipmentNote: note must be a non-empty string or null to clear`,
        };
      }
      if (command.note !== null && typeof command.note !== 'string') {
        return {
          ok: false,
          reason: 'invalid',
          message: `SetEquipmentNote: note must be a string or null`,
        };
      }
      const found = findEntry(scene, command.entryId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `SetEquipmentNote: entry "${command.entryId}" not found`,
        };
      }
      const list = scene.equipment as EquipmentEntry[];
      const equipment = list.slice();
      equipment[found.index] = withNote(found.entry, command.note);
      return { ok: true, scene: { ...scene, equipment } };
    }

    case 'UpdateEquipmentSettings': {
      if (command.settings !== null) {
        const settingsErr = validateSettingsShape(
          command.settings as Record<string, unknown>,
          'settings',
        );
        if (settingsErr !== null) {
          return {
            ok: false,
            reason: 'invalid',
            message: `UpdateEquipmentSettings: ${settingsErr}`,
          };
        }
      }
      const found = findEntry(scene, command.entryId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `UpdateEquipmentSettings: entry "${command.entryId}" not found`,
        };
      }
      const list = scene.equipment as EquipmentEntry[];
      const equipment = list.slice();
      equipment[found.index] = withSettings(found.entry, command.settings);
      return { ok: true, scene: { ...scene, equipment } };
    }
  }
}

// ─── Invert ───────────────────────────────────────────────────────────────

/**
 * Build the inverse for an equipment command given the scene it will/did
 * apply to. Returns an `EquipmentCommand` or a `'Noop'`-shaped record when
 * the forward command would have rejected.
 */
export function invertEquipmentCommand(
  scene: Scene,
  command: EquipmentCommand,
): EquipmentCommand | { kind: 'Noop' } {
  switch (command.kind) {
    case 'AddEquipmentEntry': {
      return { kind: 'RemoveEquipmentEntry', entryId: command.entry.id };
    }

    case 'RemoveEquipmentEntry': {
      const found = findEntry(scene, command.entryId);
      if (found === null) return { kind: 'Noop' };
      return {
        kind: 'AddEquipmentEntry',
        entry: clone(found.entry),
        index: found.index,
      };
    }

    case 'SetEquipmentNote': {
      const found = findEntry(scene, command.entryId);
      if (found === null) return { kind: 'Noop' };
      const previousNote = found.entry.note;
      // previousNote === undefined → restore via null (removes the property)
      // previousNote === string    → restore by setting the string back
      return {
        kind: 'SetEquipmentNote',
        entryId: command.entryId,
        note: previousNote === undefined ? null : previousNote,
        inverse: { previousNote },
      };
    }

    case 'UpdateEquipmentSettings': {
      const found = findEntry(scene, command.entryId);
      if (found === null) return { kind: 'Noop' };
      const previousSettings = found.entry.settings;
      // previousSettings === undefined → restore via null (removes the property)
      // previousSettings === object    → restore by replacing with a clone
      return {
        kind: 'UpdateEquipmentSettings',
        entryId: command.entryId,
        settings: previousSettings === undefined ? null : clone(previousSettings),
        inverse: { previousSettings },
      };
    }
  }
}

// ─── Builder helpers ──────────────────────────────────────────────────────

export const addEquipmentEntry = (entry: EquipmentEntry): AddEquipmentEntryCommand => ({
  kind: 'AddEquipmentEntry',
  entry,
});

export const removeEquipmentEntry = (entryId: Uuid): RemoveEquipmentEntryCommand => ({
  kind: 'RemoveEquipmentEntry',
  entryId,
});

export const setEquipmentNote = (
  entryId: Uuid,
  note: string | null,
): SetEquipmentNoteCommand => ({
  kind: 'SetEquipmentNote',
  entryId,
  note,
});

export const updateEquipmentSettings = (
  entryId: Uuid,
  settings: Record<string, number | string | boolean> | null,
): UpdateEquipmentSettingsCommand => ({
  kind: 'UpdateEquipmentSettings',
  entryId,
  settings,
});
