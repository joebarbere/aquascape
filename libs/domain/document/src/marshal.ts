/**
 * Marshaling between the on-disk `AquaDocument` and the in-memory `Scene`.
 *
 * The in-memory `Scene` (from `@aquascape/domain/scene-model`) is the document
 * minus its `format` / `schemaVersion` / `meta` envelope and the optional
 * `extensions` bag.
 *
 * Splitting the doc into `{ scene, envelope }` keeps `scene-model` ignorant of
 * the on-disk wrapper while still letting load → edit → save be **lossless**:
 * the editor only mutates `scene`, but on save the original `envelope`
 * (including unknown `extensions`) is re-attached unchanged. This is the
 * concrete mechanism for the "don't drop what you don't understand" rule in
 * the document format.
 *
 * **Promotion history.** As of Stage 7 F7.3, BOTH `livestock` (promoted in
 * F7.1) AND `equipment` live on the in-memory `Scene` — they each round-trip
 * through `Scene.livestock` / `Scene.equipment` so their mutations flow
 * through the Command pipeline with undo/redo. Only `extensions` still rides
 * on the envelope; it is the non-user-editable forward-compat carry-through.
 * (The `renderHistory` envelope field was retired in schema v5 when the AI
 * render feature was dropped from scope.)
 */

import type {
  EquipmentEntry as SceneEquipmentEntry,
  LivestockEntry as SceneLivestockEntry,
  Scene,
} from '@aquascape/domain/scene-model';

import type { AquaDocument, DocumentMeta, Layer } from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';

/**
 * Everything in the document that isn't in the in-memory `Scene`. Held
 * verbatim by the editor so save round-trips preserve unknown extensions.
 *
 * NOTE: `livestock` AND `equipment` are intentionally absent — they were
 * promoted to `Scene` in F7.1 and F7.3 respectively. See the file header for
 * the asymmetry rationale.
 */
export interface DocumentEnvelope {
  meta: DocumentMeta;
  extensions?: Record<string, unknown>;
}

/** Split an `AquaDocument` into the editor's `Scene` + the surrounding envelope. */
export function documentToScene(doc: AquaDocument): {
  scene: Scene;
  envelope: DocumentEnvelope;
} {
  const scene: Scene = {
    tank: doc.tank,
    substrate: doc.substrate,
    // Layer / object ids are stored as plain UUID strings on disk; the
    // scene-model uses compile-time branded subtypes (`LayerId`/`ObjectId`).
    // The brands are structural at runtime — this cast is safe and free.
    layers: doc.layers as unknown as Scene['layers'],
    seed: doc.meta.seed,
    // Livestock lives on the scene (Stage 7 F7.1). Same structural-cast
    // safety as `layers` — the on-disk + in-memory shapes are identical.
    // The element-type cast (not `Scene['livestock']`) sidesteps `exact
    // OptionalPropertyTypes` — `Scene['livestock']` includes `undefined`
    // because the field is optional, and that flag rejects assignment of
    // `T | undefined` into an optional-without-undefined slot.
    ...(doc.livestock !== undefined
      ? { livestock: doc.livestock as unknown as SceneLivestockEntry[] }
      : {}),
    // Equipment lives on the scene too (Stage 7 F7.3) — same pattern as
    // livestock above, closing the marshal asymmetry that F7.1 had to
    // leave open. The element-type cast (not `Scene['equipment']`) sidesteps
    // `exactOptionalPropertyTypes` for the same reason as livestock.
    ...(doc.equipment !== undefined
      ? { equipment: doc.equipment as unknown as SceneEquipmentEntry[] }
      : {}),
  };

  const envelope: DocumentEnvelope = {
    meta: doc.meta,
    ...(doc.extensions !== undefined ? { extensions: doc.extensions } : {}),
  };

  return { scene, envelope };
}

/**
 * Re-wrap a `Scene` + previously-captured envelope back into an `AquaDocument`.
 *
 * `meta.seed` is overwritten from `scene.seed` (the editor is the source of
 * truth for the live seed). `schemaVersion` is bumped to the writer's
 * `CURRENT_SCHEMA_VERSION` — a v(N-1) doc that was migrated up on load is
 * saved at the new version.
 */
export function sceneToDocument(
  scene: Scene,
  envelope: DocumentEnvelope,
): AquaDocument {
  return {
    format: 'aquascape',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...envelope.meta, seed: scene.seed },
    tank: scene.tank,
    substrate: scene.substrate,
    layers: scene.layers as unknown as Layer[],
    // Livestock comes off the scene (F7.1); equipment comes off the scene
    // too (F7.3). Only `extensions` still rides on the envelope — the
    // non-user-editable forward-compat carry-through.
    ...(scene.livestock !== undefined ? { livestock: scene.livestock } : {}),
    ...(scene.equipment !== undefined ? { equipment: scene.equipment } : {}),
    ...(envelope.extensions !== undefined ? { extensions: envelope.extensions } : {}),
  };
}
