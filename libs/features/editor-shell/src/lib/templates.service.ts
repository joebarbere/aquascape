// Templates service. Stage 5 F5.1 + F5.2.
//
// Two responsibilities:
//   1. List the built-in starter templates (Iwagumi / Dutch / Jungle /
//      Beginner) — re-exported from `@aquascape/features/templates`.
//   2. Store + retrieve user-saved "personal" templates, persisted via
//      `StorageService` under `aquascape.templates.personal` (one JSON
//      array of `AquaDocument`s, capped at MAX_PERSONAL_TEMPLATES so the
//      blob never grows unbounded).
//
// Instantiation (turning a template into a fresh untitled document) is
// the host's job — this service ONLY owns the catalogue. The host
// dispatches `SceneActions.setScene({ scene })` after calling
// `instantiateTemplate(document)` to produce the clean scene.

import { Injectable, computed, inject, signal } from '@angular/core';

import {
  documentToScene,
  sceneToDocument,
  type AquaDocument,
  type DocumentEnvelope,
} from '@aquascape/domain/document';
import type { Scene } from '@aquascape/domain/scene-model';
import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import { BUILTIN_TEMPLATES, type TemplateListing } from '@aquascape/features/templates';

/** Cap on personal templates — keeps the StorageService blob small. */
export const MAX_PERSONAL_TEMPLATES = 32;
/** StorageService key for the personal-templates blob. */
export const STORAGE_KEY_PERSONAL_TEMPLATES = 'aquascape.templates.personal';

@Injectable({ providedIn: 'root' })
export class TemplatesService {
  private readonly storage: StorageService = inject(STORAGE_SERVICE);

  /** Built-in starter templates — frozen at module import. */
  readonly builtins: ReadonlyArray<TemplateListing> = BUILTIN_TEMPLATES;

  private readonly personalSignal = signal<ReadonlyArray<TemplateListing>>([]);
  readonly personal = this.personalSignal.asReadonly();

  /** Combined view used by the browser UI. Builtins first, then personals. */
  readonly all = computed<ReadonlyArray<TemplateListing>>(() => [
    ...this.builtins,
    ...this.personalSignal(),
  ]);

  /** Count of personal entries — drives the panel badge. */
  readonly personalCount = computed<number>(() => this.personalSignal().length);

  constructor() {
    void this.hydrate();
  }

  /**
   * Turn a template document into a fresh scene the editor can `setScene`
   * with. Mints a NEW `meta.id`, clears `meta.isTemplate`, stamps
   * updatedAt — so the instantiated document doesn't accidentally save
   * over the template's identity. Re-marshals through `documentToScene`
   * so the host gets a scene-shaped value ready for `setScene`.
   */
  instantiateTemplate(template: AquaDocument): Scene {
    const cloned: AquaDocument = JSON.parse(JSON.stringify(template)) as AquaDocument;
    cloned.meta = {
      ...cloned.meta,
      id: crypto.randomUUID(),
      isTemplate: false,
      title: stripTemplateSuffix(cloned.meta.title),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    return documentToScene(cloned).scene;
  }

  /**
   * Persist the current scene as a personal template. Marshals through
   * `sceneToDocument`, stamps it as a template (fresh id, isTemplate=true,
   * updated timestamps), and stores under `aquascape.templates.personal`.
   * Newest first; capped at `MAX_PERSONAL_TEMPLATES` (oldest evicted).
   *
   * `envelope` is the document envelope the editor is currently holding
   * (from the document store). Pass `null` when the user hasn't opened /
   * saved a document yet — a minimal envelope is synthesised from the
   * scene so the marshal always has the meta it requires.
   *
   * Returns the listing that was added so the caller can show it.
   */
  async saveAsTemplate(
    scene: Scene,
    envelope: DocumentEnvelope | null,
    name: string,
    description?: string,
  ): Promise<TemplateListing> {
    const trimmed = name.trim();
    const finalName = trimmed.length > 0 ? trimmed : 'Untitled template';
    const now = new Date().toISOString();
    const baseEnvelope: DocumentEnvelope =
      envelope !== null
        ? envelope
        : {
            meta: {
              id: crypto.randomUUID(),
              title: finalName,
              createdAt: now,
              updatedAt: now,
              appVersion: '1.0.0',
              seed: scene.seed,
            },
          };
    // Stamp the template metadata onto the envelope BEFORE marshalling so
    // the resulting AquaDocument carries the right identity + flags. The
    // tsconfig has `exactOptionalPropertyTypes`, so we only spread the
    // optional `description` when we actually have a string for it —
    // assigning `undefined` to an optional field is a type error.
    const resolvedDescription = description ?? baseEnvelope.meta.description;
    const stampedEnvelope: DocumentEnvelope = {
      ...baseEnvelope,
      meta: {
        ...baseEnvelope.meta,
        id: crypto.randomUUID(),
        title: finalName,
        ...(resolvedDescription !== undefined ? { description: resolvedDescription } : {}),
        isTemplate: true,
        createdAt: baseEnvelope.meta.createdAt ?? now,
        updatedAt: now,
      },
    };
    const document = sceneToDocument(scene, stampedEnvelope);
    const listing: TemplateListing = {
      id: document.meta.id,
      name: finalName,
      description: document.meta.description ?? '',
      document,
    };
    const next = [listing, ...this.personalSignal()].slice(0, MAX_PERSONAL_TEMPLATES);
    this.personalSignal.set(next);
    await this.persistPersonal(next);
    return listing;
  }

  /** Delete a personal template by listing id. No-op on unknown ids. */
  async deletePersonalTemplate(id: string): Promise<void> {
    const next = this.personalSignal().filter((t) => t.id !== id);
    if (next.length === this.personalSignal().length) return;
    this.personalSignal.set(next);
    await this.persistPersonal(next);
  }

  /** Test-friendly: clear personal templates outright. */
  async clearPersonalTemplates(): Promise<void> {
    this.personalSignal.set([]);
    await this.persistPersonal([]);
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await this.storage.get<unknown>(STORAGE_KEY_PERSONAL_TEMPLATES);
      if (!Array.isArray(raw)) return;
      const valid: TemplateListing[] = [];
      for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const e = entry as {
          id?: unknown;
          name?: unknown;
          description?: unknown;
          document?: unknown;
        };
        if (
          typeof e.id !== 'string' ||
          typeof e.name !== 'string' ||
          typeof e.description !== 'string' ||
          e.document === null ||
          typeof e.document !== 'object'
        ) {
          continue;
        }
        valid.push({
          id: e.id,
          name: e.name,
          description: e.description,
          document: e.document as AquaDocument,
        });
      }
      this.personalSignal.set(valid.slice(0, MAX_PERSONAL_TEMPLATES));
    } catch {
      // Storage failure non-fatal.
    }
  }

  private async persistPersonal(next: ReadonlyArray<TemplateListing>): Promise<void> {
    try {
      await this.storage.set(STORAGE_KEY_PERSONAL_TEMPLATES, next);
    } catch {
      // Persist failure non-fatal — in-memory state still updates.
    }
  }
}

/**
 * Drop trailing parenthetical suffixes ("(60-P)", "(nano)") from a
 * template title so the instantiated document gets a clean name like
 * "Iwagumi" rather than "Iwagumi (60-P)". Used by `instantiateTemplate`.
 */
function stripTemplateSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/u, '').trim();
}
