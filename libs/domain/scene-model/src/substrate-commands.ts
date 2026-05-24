/**
 * Substrate commands. Stage 2 F2.2 / F2.3.
 *
 * Lives in a sibling module to keep `commands.ts` manageable. The union
 * extension + apply/invert switch cases + builder helpers are all wired
 * here; `commands.ts` only needs to know the union extension and the two
 * dispatcher hooks.
 *
 * DESIGN RULES
 *
 * Five commands cover the substrate UX surface:
 *   - `AddSubstrateRegion({ region })` — region carries its own id (caller
 *     mints via `newRegionId()`). Inverse removes by id.
 *   - `RemoveSubstrateRegion({ regionId })` — inverse captures the removed
 *     region plus its prior index so re-application restores ordering.
 *   - `SetSubstrateRegionMaterial({ regionId, material })` — small patch
 *     for the material picker; inverse carries the previous material.
 *   - `SetSubstrateRegionExtent({ regionId, fromX, toX, blend? })` —
 *     numeric form on the panel; inverse carries the previous extent.
 *   - `SetSubstrateRegionProfile({ regionId, profile })` — wholesale-replace
 *     the control-point list; inverse carries the previous profile.
 *
 * **Why wholesale-replace the profile rather than per-point commands?**
 * The UI dispatches on commit/blur after the user has edited any number of
 * points; collapsing to one command per commit cycle keeps undo/redo
 * intuitive (one Ctrl+Z = one user edit, not one Ctrl+Z = one micro-tweak).
 * The SetTankStyle decision applied the same reasoning to TankStyle.
 *
 * Validation runs every apply (including when an `inverse` envelope is
 * present) so latent bugs in the inverse upstream are caught at the
 * apply boundary, not by a downstream renderer crash.
 */

import type { CatalogRef, Scene, SubstrateRegion, Uuid } from './types';

// ─── Region-id brand ──────────────────────────────────────────────────────

/**
 * Branded UUID for a substrate region. Compile-time only — at runtime it's
 * a plain string and serializes losslessly. Mirrors `LayerId` / `ObjectId`.
 */
export type RegionId = string & { readonly __brand: 'RegionId' };

/** Cast a plain string to a `RegionId`. Use sparingly — primarily for test fixtures. */
export const asRegionId = (id: string): RegionId => id as RegionId;

// ─── Command shapes ───────────────────────────────────────────────────────

/** Whole-region insertion. Region.id must be unique within the scene. */
export interface AddSubstrateRegionCommand {
  kind: 'AddSubstrateRegion';
  region: SubstrateRegion;
  /** Insertion index; null/out-of-range → append. */
  index?: number | null;
}

/** Remove a region by id. Inverse restores the region and its prior index. */
export interface RemoveSubstrateRegionCommand {
  kind: 'RemoveSubstrateRegion';
  regionId: Uuid;
  inverse?: { region: SubstrateRegion; index: number };
}

/** Re-bind a region's material. */
export interface SetSubstrateRegionMaterialCommand {
  kind: 'SetSubstrateRegionMaterial';
  regionId: Uuid;
  material: CatalogRef;
  inverse?: { previousMaterial: CatalogRef };
}

/**
 * Update fromX / toX / blend in one shot. The three move together in
 * practice (drag-resize handles both edges; blend follows extent in the UI).
 */
export interface SetSubstrateRegionExtentCommand {
  kind: 'SetSubstrateRegionExtent';
  regionId: Uuid;
  fromX: number;
  toX: number;
  /** Omit to leave blend unchanged; pass `null` to remove the field. */
  blend?: number | null;
  inverse?: { previousFromX: number; previousToX: number; previousBlend?: number };
}

/** Wholesale-replace the profile control points for a region. */
export interface SetSubstrateRegionProfileCommand {
  kind: 'SetSubstrateRegionProfile';
  regionId: Uuid;
  profile: SubstrateRegion['profile'];
  inverse?: { previousProfile: SubstrateRegion['profile'] };
}

/** Discriminated union of all substrate-region commands. */
export type SubstrateCommand =
  | AddSubstrateRegionCommand
  | RemoveSubstrateRegionCommand
  | SetSubstrateRegionMaterialCommand
  | SetSubstrateRegionExtentCommand
  | SetSubstrateRegionProfileCommand;

// ─── Validators ───────────────────────────────────────────────────────────

/**
 * Returns `null` if the region's structural fields are valid; otherwise a
 * human-readable reason. Validates only what the substrate UX can produce
 * — material is a `CatalogRef` shape check (catalog/id/version present),
 * not a catalog lookup (the catalog isn't visible here).
 */
export function validateSubstrateRegion(region: SubstrateRegion): string | null {
  if (typeof region.id !== 'string' || region.id.length === 0) {
    return 'region.id must be a non-empty string';
  }
  const matErr = validateCatalogRefShape(region.material, 'material');
  if (matErr !== null) return matErr;
  const extentErr = validateExtent(region.fromX, region.toX);
  if (extentErr !== null) return extentErr;
  if (region.blend !== undefined && !(region.blend >= 0 && Number.isFinite(region.blend))) {
    return `blend must be a non-negative finite number; got ${String(region.blend)}`;
  }
  const profileErr = validateProfile(region.profile);
  if (profileErr !== null) return profileErr;
  return null;
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

function validateExtent(fromX: number, toX: number): string | null {
  if (!Number.isFinite(fromX) || fromX < 0 || fromX > 1) {
    return `fromX must be in [0, 1]; got ${String(fromX)}`;
  }
  if (!Number.isFinite(toX) || toX < 0 || toX > 1) {
    return `toX must be in [0, 1]; got ${String(toX)}`;
  }
  if (fromX > toX) return `fromX (${fromX}) must be <= toX (${toX})`;
  return null;
}

function validateProfile(profile: SubstrateRegion['profile']): string | null {
  if (!Array.isArray(profile) || profile.length < 2) {
    return 'profile must have >= 2 control points';
  }
  let lastX = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i]!;
    if (!Number.isFinite(p.x) || p.x < 0 || p.x > 1) {
      return `profile[${i}].x must be in [0, 1]; got ${String(p.x)}`;
    }
    if (!Number.isFinite(p.y) || p.y < 0) {
      return `profile[${i}].y must be a non-negative finite number; got ${String(p.y)}`;
    }
    if (p.x < lastX) {
      return `profile must be sorted by x ascending; profile[${i}].x = ${p.x} < ${lastX}`;
    }
    lastX = p.x;
  }
  return null;
}

// ─── Helpers shared with commands.ts ──────────────────────────────────────

function clone<T>(v: T): T {
  return structuredClone(v);
}

function findRegion(scene: Scene, regionId: Uuid): { region: SubstrateRegion; index: number } | null {
  const index = scene.substrate.regions.findIndex((r) => r.id === regionId);
  if (index < 0) return null;
  return { region: scene.substrate.regions[index]!, index };
}

function replaceRegion(scene: Scene, index: number, next: SubstrateRegion): Scene {
  const regions = scene.substrate.regions.slice();
  regions[index] = next;
  return { ...scene, substrate: { ...scene.substrate, regions } };
}

// ─── Apply ────────────────────────────────────────────────────────────────

/**
 * Apply a substrate command. Mirrors the CommandResult shape used by
 * `commands.applyCommand` so the main dispatcher can delegate without
 * adapting types.
 */
export function applySubstrateCommand(
  scene: Scene,
  command: SubstrateCommand,
):
  | { ok: true; scene: Scene }
  | { ok: false; reason: 'invalid' | 'not-found' | 'locked'; message: string } {
  switch (command.kind) {
    case 'AddSubstrateRegion': {
      const err = validateSubstrateRegion(command.region);
      if (err !== null) return { ok: false, reason: 'invalid', message: `AddSubstrateRegion: ${err}` };
      if (scene.substrate.regions.some((r) => r.id === command.region.id)) {
        return {
          ok: false,
          reason: 'invalid',
          message: `AddSubstrateRegion: region id "${command.region.id}" already exists`,
        };
      }
      const length = scene.substrate.regions.length;
      const insertAt =
        command.index === undefined || command.index === null || command.index < 0 || command.index > length
          ? length
          : command.index;
      const regions = scene.substrate.regions.slice();
      regions.splice(insertAt, 0, clone(command.region));
      return { ok: true, scene: { ...scene, substrate: { ...scene.substrate, regions } } };
    }

    case 'RemoveSubstrateRegion': {
      const found = findRegion(scene, command.regionId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `RemoveSubstrateRegion: region "${command.regionId}" not found`,
        };
      }
      const regions = scene.substrate.regions.slice();
      regions.splice(found.index, 1);
      return { ok: true, scene: { ...scene, substrate: { ...scene.substrate, regions } } };
    }

    case 'SetSubstrateRegionMaterial': {
      const found = findRegion(scene, command.regionId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `SetSubstrateRegionMaterial: region "${command.regionId}" not found`,
        };
      }
      const matErr = validateCatalogRefShape(command.material, 'material');
      if (matErr !== null) {
        return { ok: false, reason: 'invalid', message: `SetSubstrateRegionMaterial: ${matErr}` };
      }
      const next: SubstrateRegion = { ...found.region, material: clone(command.material) };
      return { ok: true, scene: replaceRegion(scene, found.index, next) };
    }

    case 'SetSubstrateRegionExtent': {
      const found = findRegion(scene, command.regionId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `SetSubstrateRegionExtent: region "${command.regionId}" not found`,
        };
      }
      const extentErr = validateExtent(command.fromX, command.toX);
      if (extentErr !== null) {
        return { ok: false, reason: 'invalid', message: `SetSubstrateRegionExtent: ${extentErr}` };
      }
      if (
        command.blend !== undefined &&
        command.blend !== null &&
        !(command.blend >= 0 && Number.isFinite(command.blend))
      ) {
        return {
          ok: false,
          reason: 'invalid',
          message: `SetSubstrateRegionExtent: blend must be a non-negative finite number`,
        };
      }
      const next: SubstrateRegion = { ...found.region, fromX: command.fromX, toX: command.toX };
      if (command.blend === undefined) {
        // Leave blend unchanged.
        if (found.region.blend !== undefined) next.blend = found.region.blend;
      } else if (command.blend === null) {
        // Explicit removal.
        delete (next as { blend?: number }).blend;
      } else {
        next.blend = command.blend;
      }
      return { ok: true, scene: replaceRegion(scene, found.index, next) };
    }

    case 'SetSubstrateRegionProfile': {
      const found = findRegion(scene, command.regionId);
      if (found === null) {
        return {
          ok: false,
          reason: 'not-found',
          message: `SetSubstrateRegionProfile: region "${command.regionId}" not found`,
        };
      }
      const profileErr = validateProfile(command.profile);
      if (profileErr !== null) {
        return { ok: false, reason: 'invalid', message: `SetSubstrateRegionProfile: ${profileErr}` };
      }
      const next: SubstrateRegion = { ...found.region, profile: clone(command.profile) };
      return { ok: true, scene: replaceRegion(scene, found.index, next) };
    }
  }
}

// ─── Invert ───────────────────────────────────────────────────────────────

/**
 * Build the inverse for a substrate command given the scene it will/did
 * apply to. Returns a `SubstrateCommand` or a `'Noop'` shape when the
 * forward command targets a region that doesn't exist (Noop is sound:
 * "apply nothing then invert nothing" preserves state).
 */
export function invertSubstrateCommand(
  scene: Scene,
  command: SubstrateCommand,
): SubstrateCommand | { kind: 'Noop' } {
  switch (command.kind) {
    case 'AddSubstrateRegion': {
      // Inverse: remove the region we'd have just added. If the region's id
      // is already present we can't add it (apply would reject); the inverse
      // is still "remove by that id" because if the user retries, the
      // inverse-of-inverse re-adds.
      return { kind: 'RemoveSubstrateRegion', regionId: command.region.id };
    }
    case 'RemoveSubstrateRegion': {
      const found = findRegion(scene, command.regionId);
      if (found === null) return { kind: 'Noop' };
      return {
        kind: 'AddSubstrateRegion',
        region: clone(found.region),
        index: found.index,
      };
    }
    case 'SetSubstrateRegionMaterial': {
      const found = findRegion(scene, command.regionId);
      if (found === null) return { kind: 'Noop' };
      return {
        kind: 'SetSubstrateRegionMaterial',
        regionId: command.regionId,
        material: clone(found.region.material),
        inverse: { previousMaterial: clone(command.material) },
      };
    }
    case 'SetSubstrateRegionExtent': {
      const found = findRegion(scene, command.regionId);
      if (found === null) return { kind: 'Noop' };
      const inv: SetSubstrateRegionExtentCommand = {
        kind: 'SetSubstrateRegionExtent',
        regionId: command.regionId,
        fromX: found.region.fromX,
        toX: found.region.toX,
        ...(found.region.blend === undefined ? { blend: null } : { blend: found.region.blend }),
      };
      return inv;
    }
    case 'SetSubstrateRegionProfile': {
      const found = findRegion(scene, command.regionId);
      if (found === null) return { kind: 'Noop' };
      return {
        kind: 'SetSubstrateRegionProfile',
        regionId: command.regionId,
        profile: clone(found.region.profile),
        inverse: { previousProfile: clone(command.profile) },
      };
    }
  }
}

// ─── Builder helpers ──────────────────────────────────────────────────────

export const addSubstrateRegion = (
  region: SubstrateRegion,
  index: number | null = null,
): AddSubstrateRegionCommand => ({
  kind: 'AddSubstrateRegion',
  region,
  ...(index !== null ? { index } : {}),
});

export const removeSubstrateRegion = (regionId: Uuid): RemoveSubstrateRegionCommand => ({
  kind: 'RemoveSubstrateRegion',
  regionId,
});

export const setSubstrateRegionMaterial = (
  regionId: Uuid,
  material: CatalogRef,
): SetSubstrateRegionMaterialCommand => ({
  kind: 'SetSubstrateRegionMaterial',
  regionId,
  material,
});

export const setSubstrateRegionExtent = (args: {
  regionId: Uuid;
  fromX: number;
  toX: number;
  blend?: number | null;
}): SetSubstrateRegionExtentCommand => ({
  kind: 'SetSubstrateRegionExtent',
  regionId: args.regionId,
  fromX: args.fromX,
  toX: args.toX,
  ...(args.blend !== undefined ? { blend: args.blend } : {}),
});

export const setSubstrateRegionProfile = (
  regionId: Uuid,
  profile: SubstrateRegion['profile'],
): SetSubstrateRegionProfileCommand => ({
  kind: 'SetSubstrateRegionProfile',
  regionId,
  profile,
});
