# Scene model + commands caveats

**Load this when:** authoring or editing `Command` types in `libs/domain/scene-model/`, touching undo/redo, or wiring a new editor mutation.

- **Commands are plain discriminated-union records** (not classes), dispatched through free `applyCommand` / `invertCommand`. Chosen for trivial JSON round-trips + inspectability.
- **Lock-guard policy:** locked layers reject *object-level* commands via `CommandResult` (`{ ok: false, reason: 'locked' | 'not-found' | 'invalid', message }`). Layer-metadata commands (rename / opacity / visibility / locked) and global ops (`SetTankDimensions` / `SetTankStyle`) are NOT blocked.
- `MoveObject` carries absolute world position. `ReorderLayers` takes a full id-permutation.
- `SetTankDimensions` validates against 100–10 000 mm, clamps every object's `transform.position` into the new interior AABB. **Nothing is deleted**, even when an object's centre lands on a face. Invert carries `inverse: { previousDimensions, restoredPositions }`; apply **short-circuits the clamp when `restoredPositions` is present** (this is how shrink-and-undo restores originals).
- `SetTankStyle` is whole-style replacement, `structuredClone`-cloned on store, always-on validation (hex regex + sorted-stops + finite angle + image `AssetRef` shape). Substrate `SetSubstrateRegionProfile` follows the same wholesale-replace pattern.
- `MirrorObject` is **self-inverse** (no captured state; apply twice = identity). `Duplicate` isn't a new command — the inspector composes `AddObject` of a `JSON.parse(JSON.stringify())`-cloned object with a fresh id + 20 mm offset.
- **`MirrorObject` rejects `axis: 'y'` on plant objects** with `reason: 'invalid'`. Plants must always grow upward from the substrate; a vertically-mirrored plant would have its roots in the air. The selection inspector's Mirror V button is disabled when any selected object is a plant (so the user sees the constraint surfaced in the UI), and the 2D + 3D renderers ignore `plant.transform.flipY` entirely (sy stays positive) as defence in depth for any legacy document that smuggled `flipY: true` past the command guard.
- `SetObjectGroupId({ objectIds, groupId: null })` REMOVES the property entirely. The schema's `additionalProperties: false` won't accept literal `null`; "ungrouped" must round-trip as "no field present". When `inverse.previousGroupIds` is present, per-object restoration takes precedence over the uniform `groupId`.
- **History is bounded immutable** (default 200). `setScene({ scene })` replaces wholesale and resets history — deliberately NOT a Command (you don't undo opening a file). Used by Open / New / Recover.
- **`setTankPresetRef`** is a metadata-only side-edit that bypasses the Command pipeline.
