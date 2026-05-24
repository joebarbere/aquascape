/**
 * Marshaling between the on-disk `AquaDocument` and the in-memory `Scene`.
 *
 * The in-memory `Scene` (from `@aquascape/domain/scene-model`) is the document
 * minus its `format` / `schemaVersion` / `meta` envelope and the optional
 * `livestock` / `equipment` / `renderHistory` / `extensions` bag.
 *
 * Splitting the doc into `{ scene, envelope }` keeps `scene-model` ignorant of
 * the on-disk wrapper while still letting load → edit → save be **lossless**:
 * the editor only mutates `scene`, but on save the original `envelope`
 * (including unknown `extensions`) is re-attached unchanged. This is the
 * concrete mechanism for the "don't drop what you don't understand" rule in
 * the document format.
 */

import type { Scene } from '@aquascape/domain/scene-model';

import type {
  AquaDocument,
  DocumentMeta,
  EquipmentEntry,
  Layer,
  LivestockEntry,
  RenderRecord,
} from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';

/**
 * Everything in the document that isn't in the in-memory `Scene`. Held
 * verbatim by the editor so save round-trips preserve unknown extensions.
 */
export interface DocumentEnvelope {
  meta: DocumentMeta;
  livestock?: LivestockEntry[];
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
  };

  const envelope: DocumentEnvelope = {
    meta: doc.meta,
    ...(doc.livestock !== undefined ? { livestock: doc.livestock } : {}),
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
    ...(envelope.livestock !== undefined ? { livestock: envelope.livestock } : {}),
    ...(envelope.equipment !== undefined ? { equipment: envelope.equipment } : {}),
    ...(envelope.renderHistory !== undefined
      ? { renderHistory: envelope.renderHistory }
      : {}),
    ...(envelope.extensions !== undefined ? { extensions: envelope.extensions } : {}),
  };
}
