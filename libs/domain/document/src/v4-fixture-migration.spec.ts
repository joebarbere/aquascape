/**
 * Pinned regression test for the v4 → v5 migration.
 *
 * The fixture under `__fixtures__/example.v4.aqua.json` is a byte-identical
 * snapshot of `example.aqua.json` from the day v4 was superseded by v5. Like
 * the v1 / v2 / v3 fixtures, it is NEVER edited going forward — every future
 * format change adds a new fixture next to it and a test that loads each in
 * turn.
 *
 * v5 is the first NON-additive step: it REMOVES the optional `renderHistory`
 * field (the AI photorealistic render feature was dropped from scope). The
 * canonical v4 example never carried `renderHistory` (no shipped writer ever
 * emitted it), so on the pinned fixture the migration is byte-identical apart
 * from the version stamp. A SEPARATE test below synthesises a v4 doc WITH
 * `renderHistory` to prove the strip path.
 *
 * The contract for loading the v4 fixture under the current (v5) reader is:
 *   1. The v4 fixture loads (v5 is a structural superset of v4 minus the
 *      removed `renderHistory` field, which the fixture doesn't carry).
 *   2. After loading, `schemaVersion === 5` (the migration ran).
 *   3. The loader reports the single applied step `{ from: 4, to: 5 }`.
 *   4. Apart from `schemaVersion`, the document is byte-for-byte unchanged
 *      (the v4 `waterChemistry` / `waterLevelMm` survive untouched).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument } from './aqua-document';
import { loadAquaDocument } from './serialize';

const V4_FIXTURE_PATH = resolve(__dirname, '__fixtures__/example.v4.aqua.json');
const V4_FIXTURE_JSON = readFileSync(V4_FIXTURE_PATH, 'utf8');
const V4_FIXTURE: AquaDocument = JSON.parse(V4_FIXTURE_JSON);

describe('v4 → v5 migration (pinned fixture)', () => {
  it('loads the v4 fixture successfully under the current (v5) reader', () => {
    const result = loadAquaDocument(V4_FIXTURE_JSON);
    expect(result.ok).toBe(true);
  });

  it('bumps schemaVersion from 4 to 5 on load', () => {
    expect(V4_FIXTURE.schemaVersion).toBe(4);
    const result = loadAquaDocument(V4_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(5);
  });

  it('reports a single applied step { from: 4, to: 5 }', () => {
    const result = loadAquaDocument(V4_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationSteps).toEqual([{ from: 4, to: 5 }]);
  });

  it('preserves the v4 waterChemistry + waterLevelMm untouched through the migration', () => {
    const result = loadAquaDocument(V4_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.tank.waterChemistry).toEqual(V4_FIXTURE.tank.waterChemistry);
    expect(result.document.tank.waterLevelMm).toBe(V4_FIXTURE.tank.waterLevelMm);
  });

  it('preserves every other field byte-for-byte (only schemaVersion changed)', () => {
    const result = loadAquaDocument(V4_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strip the version field from both sides and expect deep equality.
    const { schemaVersion: _v4Version, ...v4Rest } = V4_FIXTURE;
    const { schemaVersion: _v5Version, ...migratedRest } = result.document;
    expect(migratedRest).toEqual(v4Rest);
  });
});

describe('v4 → v5 migration strips renderHistory (the dropped AI-render field)', () => {
  // Synthesise a v4 document that carried `renderHistory`. No shipped writer
  // ever emitted it, but a hand-authored or speculative pre-Stage-9 doc could
  // — and such a doc must load cleanly under v5 (whose `additionalProperties:
  // false` no longer admits the field) with the field stripped.
  const v4WithHistory = {
    ...structuredClone(V4_FIXTURE),
    renderHistory: [
      {
        id: '7a8b9c0d-4000-4000-8000-000000004000',
        createdAt: '2026-05-23T15:00:00.000Z',
        provider: { kind: 'local', name: 'sdxl-local' },
        request: { prompt: 'a serene iwagumi aquascape' },
        resultAsset: {
          id: '7a8b9c0d-4000-4000-8000-000000004001',
          uri: 'assets/render-01.png',
          mimeType: 'image/png',
        },
      },
    ],
  };
  const V4_WITH_HISTORY_JSON = JSON.stringify(v4WithHistory);

  it('loads cleanly and strips renderHistory under the v5 reader', () => {
    const result = loadAquaDocument(V4_WITH_HISTORY_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(5);
    // The field is GONE — not present-with-undefined. The v5 schema's
    // `additionalProperties: false` would have rejected the doc otherwise.
    expect('renderHistory' in result.document).toBe(false);
  });

  it('leaves every non-renderHistory field identical to the stripped v4 doc', () => {
    const result = loadAquaDocument(V4_WITH_HISTORY_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { renderHistory: _dropped, schemaVersion: _v, ...v4Rest } = v4WithHistory;
    const { schemaVersion: _v5, ...migratedRest } = result.document;
    expect(migratedRest).toEqual(v4Rest);
  });
});
