/**
 * Pinned regression test for the v3 → v4 migration.
 *
 * The fixture under `__fixtures__/example.v3.aqua.json` is a byte-identical
 * snapshot of `example.aqua.json` from the day v3 was superseded by v4. Like
 * `example.v1.aqua.json` / `example.v2.aqua.json`, it is NEVER edited going
 * forward — every future format change adds a new fixture next to it and a
 * test that loads each in turn.
 *
 * The contract for v3 → v4 is:
 *   1. The v3 fixture loads under the current (v4) reader (v4 is a structural
 *      superset of v3 — `Tank.waterChemistry` is additive and optional).
 *   2. After loading, `schemaVersion === 4` (the migration ran).
 *   3. The tank ends up with `waterChemistry` ABSENT (the migration is a pure
 *      identity that bumps the version number; it MUST NOT invent chemistry —
 *      absent means "no chemistry recorded", and inventing a snapshot would
 *      falsely claim a never-cycled tank had been cycled).
 *   4. The loader reports the single applied step `{ from: 3, to: 4 }`.
 *   5. Apart from `schemaVersion`, the document is byte-for-byte unchanged
 *      (no shape rewrites slipped in under the no-op label — in particular the
 *      v3 `Tank.waterLevelMm` value survives untouched).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument } from './aqua-document';
import { loadAquaDocument } from './serialize';

const V3_FIXTURE_PATH = resolve(__dirname, '__fixtures__/example.v3.aqua.json');
const V3_FIXTURE_JSON = readFileSync(V3_FIXTURE_PATH, 'utf8');
const V3_FIXTURE: AquaDocument = JSON.parse(V3_FIXTURE_JSON);

describe('v3 → v4 migration (pinned fixture)', () => {
  it('loads the v3 fixture successfully under the current (v4) reader', () => {
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
  });

  it('bumps schemaVersion from 3 to 4 on load', () => {
    expect(V3_FIXTURE.schemaVersion).toBe(3);
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(4);
  });

  it('reports a single applied step { from: 3, to: 4 }', () => {
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationSteps).toEqual([{ from: 3, to: 4 }]);
  });

  it('does NOT invent a waterChemistry on the tank (migration is a pure no-op identity)', () => {
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The field must be ABSENT, not present-with-undefined — "no chemistry"
    // means the tank was never cycled, and must round-trip as "no field". The
    // migration has no authority to invent a cycle history for an old document.
    expect('waterChemistry' in result.document.tank).toBe(false);
  });

  it('preserves the v3 waterLevelMm untouched through the migration', () => {
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.tank.waterLevelMm).toBe(V3_FIXTURE.tank.waterLevelMm);
  });

  it('preserves every other field byte-for-byte (only schemaVersion changed)', () => {
    const result = loadAquaDocument(V3_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strip the version field from both sides and expect deep equality.
    const { schemaVersion: _v3Version, ...v3Rest } = V3_FIXTURE;
    const { schemaVersion: _v4Version, ...migratedRest } = result.document;
    expect(migratedRest).toEqual(v3Rest);
  });
});
