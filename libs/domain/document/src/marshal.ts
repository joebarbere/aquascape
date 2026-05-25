/**
 * Marshaling between the on-disk `AquaDocument` and the in-memory `Scene`.
 *
 * The in-memory `Scene` (from `@aquascape/domain/scene-model`) is the document
 * minus its `format` / `schemaVersion` / `meta` envelope and the optional
 * `equipment` / `renderHistory` / `extensions` bag.
 *
 * Splitting the doc into `{ scene, envelope }` keeps `scene-model` ignorant of
 * the on-disk wrapper while still letting load → edit → save be **lossless**:
 * the editor only mutates `scene`, but on save the original `envelope`
 * (including unknown `extensions`) is re-attached unchanged. This is the
 * concrete mechanism for the "don't drop what you don't understand" rule in
 * the document format.
 *
 * **Livestock asymmetry.** As of Stage 7 F7.1, `livestock` lives on the
 * in-memory `Scene` (not on the envelope) so livestock mutations can flow
 * through the Command pipeline with undo/redo. `equipment` / `renderHistory`
 * / `extensions` still ride on the envelope for now; F7.3 will repeat the
 * promotion for equipment.
 */

import type { LivestockEntry as SceneLivestockEntry, Scene } from '@aquascape/domain/scene-model';

import type {
  AquaDocument,
  DocumentMeta,
  EquipmentEntry,
  Layer,
  RenderRecord,
} from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';

/**
 * Everything in the document that isn't in the in-memory `Scene`. Held
 * verbatim by the editor so save round-trips preserve unknown extensions.
 *
 * NOTE: `livestock` is intentionally absent — it was promoted to `Scene` in
 * F7.1. See the file header for the asymmetry rationale.
 */
export interface DocumentEnvelope {
  meta: DocumentMeta;
  equipment?: EquipmentEntry[];
  renderHistory?: RenderRecord[];
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
  };

  const envelope: DocumentEnvelope = {
    meta: doc.meta,
    ...(doc.equipment !== undefined ? { equipment: doc.equipment } : {}),
    ...(doc.renderHistory !== undefined ? { renderHistory: doc.renderHistory } : {}),
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
    // Livestock comes off the scene (F7.1), not the envelope. Equipment +
    // renderHistory + extensions still ride on the envelope; F7.3 will
    // repeat the promotion for equipment.
    ...(scene.livestock !== undefined ? { livestock: scene.livestock } : {}),
    ...(envelope.equipment !== undefined ? { equipment: envelope.equipment } : {}),
    ...(envelope.renderHistory !== undefined
      ? { renderHistory: envelope.renderHistory }
      : {}),
    ...(envelope.extensions !== undefined ? { extensions: envelope.extensions } : {}),
  };
}
