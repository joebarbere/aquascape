/**
 * Migration chain for the `.aqua` document format.
 *
 * Migrations are pure, total, single-step (`from` → `from + 1`) transforms.
 * The loader walks the chain in order until the document's `schemaVersion`
 * matches the reader's `CURRENT_SCHEMA_VERSION`. v1 is the baseline; v2 adds
 * the optional `Layer.zone` field and v3 adds the optional `Tank.waterLevelMm`
 * field — both additive + optional, so each migration is an identity that
 * only bumps the version number. Prior-version documents in the wild keep
 * loading transparently.
 *
 * Re-exports the `Migration` interface from `./aqua-document` so callers have
 * one import for the whole document module.
 */

import type { AquaDocument, Migration } from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';

export type { Migration };

/**
 * The canonical migration list a reader applies on load.
 *
 * Ordered by `from` ascending; `runMigrations` enforces ordering. New steps
 * are APPENDED so the historical chain reads top-down (v1 → v2 → v3 → …).
 *
 * - v1 → v2: adds optional `Layer.zone`. No-op identity migration — every v1
 *   document is structurally a valid v2 document; the field is additive and
 *   optional. The migration MUST NOT invent zone values (a v1 layer's zone
 *   stays undefined post-migration; assigning a guessed zone would be a
 *   data transformation we have no authority to make on the user's behalf).
 * - v2 → v3: adds optional `Tank.waterLevelMm`. No-op identity migration —
 *   every v2 document is structurally a valid v3 document. The migration
 *   MUST NOT invent a water level: absent means "default fill", derived at
 *   render time by scene-model's `effectiveWaterLevelMm`, and absent stays
 *   absent through migration + round-trip.
 */
export const AQUA_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    from: 1,
    to: 2,
    migrate: (doc) => ({ ...(doc as AquaDocument), schemaVersion: 2 }),
  },
  {
    from: 2,
    to: 3,
    migrate: (doc) => ({ ...(doc as AquaDocument), schemaVersion: 3 }),
  },
]);

/** Failure modes from `runMigrations`, kept structured for tests + UI surfacing. */
export type MigrationError =
  | { kind: 'unsupported-future-version'; documentVersion: number; readerVersion: number }
  | { kind: 'missing-migration'; from: number; to: number }
  | { kind: 'invalid-step'; from: number; to: number; reason: string }
  | { kind: 'migration-threw'; from: number; to: number; cause: unknown };

export type MigrationResult =
  | { ok: true; document: unknown; appliedSteps: ReadonlyArray<{ from: number; to: number }> }
  | { ok: false; error: MigrationError };

/**
 * Walk `doc` from its declared `schemaVersion` up to `targetVersion`, applying
 * each registered migration in order.
 *
 * - Downgrades are refused (a v3 doc fed to a v2 reader is `unsupported-future-version`;
 *   the reader cannot know what fields v3 added).
 * - A gap between the current version and the next available migration's `from`
 *   is `missing-migration`.
 * - A migration that returns a doc whose new version is not `from + 1` is `invalid-step`
 *   (defends against author mistakes).
 *
 * The function is pure: it never mutates its inputs or the migration list.
 */
export function runMigrations(
  doc: unknown,
  migrations: readonly Migration[] = AQUA_MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  const sorted = [...migrations].sort((a, b) => a.from - b.from);

  let current = doc;
  const appliedSteps: Array<{ from: number; to: number }> = [];

  while (true) {
    const version = readSchemaVersion(current);
    if (version === targetVersion) {
      return { ok: true, document: current, appliedSteps };
    }
    if (version > targetVersion) {
      return {
        ok: false,
        error: {
          kind: 'unsupported-future-version',
          documentVersion: version,
          readerVersion: targetVersion,
        },
      };
    }

    const step = sorted.find((m) => m.from === version);
    if (!step) {
      return {
        ok: false,
        error: { kind: 'missing-migration', from: version, to: version + 1 },
      };
    }
    if (step.to !== step.from + 1) {
      return {
        ok: false,
        error: {
          kind: 'invalid-step',
          from: step.from,
          to: step.to,
          reason: `migration must advance exactly one version (got ${step.from} → ${step.to})`,
        },
      };
    }

    let next: unknown;
    try {
      next = step.migrate(current);
    } catch (cause) {
      return {
        ok: false,
        error: { kind: 'migration-threw', from: step.from, to: step.to, cause },
      };
    }
    const nextVersion = readSchemaVersion(next);
    if (nextVersion !== step.to) {
      return {
        ok: false,
        error: {
          kind: 'invalid-step',
          from: step.from,
          to: step.to,
          reason: `migration produced schemaVersion=${String(nextVersion)} (expected ${step.to})`,
        },
      };
    }
    appliedSteps.push({ from: step.from, to: step.to });
    current = next;
  }
}

/**
 * Read `schemaVersion` from an opaque document candidate. Returns `0` when the
 * field is missing or non-integer; the loader treats that as "definitely not a
 * valid AquaDocument" and reports a schema validation error rather than letting
 * the migration walker spin forever.
 */
function readSchemaVersion(doc: unknown): number {
  if (typeof doc !== 'object' || doc === null) return 0;
  const v = (doc as { schemaVersion?: unknown }).schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) ? v : 0;
}
