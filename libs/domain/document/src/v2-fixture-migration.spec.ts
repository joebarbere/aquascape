/**
 * Pinned regression test for the v2 → v3 migration.
 *
 * The fixture under `__fixtures__/example.v2.aqua.json` is a byte-identical
 * snapshot of `example.aqua.json` from the day v2 was superseded by v3. Like
 * `example.v1.aqua.json`, it is NEVER edited going forward — every future
 * format change adds a new fixture next to it and a test that loads each in
 * turn.
 *
 * The contract for v2 → v3 is:
 *   1. The v2 fixture loads under the current (v3) reader (v3 is a structural
 *      superset of v2 — `Tank.waterLevelMm` is additive and optional).
 *   2. After loading, `schemaVersion === 3` (the migration ran).
 *   3. The tank ends up with `waterLevelMm` ABSENT (the migration is a pure
 *      identity that bumps the version number; it MUST NOT invent a water
 *      level — absent means "default fill", derived at render time).
 *   4. The loader reports the single applied step `{ from: 2, to: 3 }`.
 *   5. Apart from `schemaVersion`, the document is byte-for-byte unchanged
 *      (no shape rewrites slipped in under the no-op label — in particular
 *      the v2 `Layer.zone` values survive untouched).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument } from './aqua-document';
import { loadAquaDocument } from './serialize';

const V2_FIXTURE_PATH = resolve(__dirname, '__fixtures__/example.v2.aqua.json');
const V2_FIXTURE_JSON = readFileSync(V2_FIXTURE_PATH, 'utf8');
const V2_FIXTURE: AquaDocument = JSON.parse(V2_FIXTURE_JSON);

describe('v2 → v3 migration (pinned fixture)', () => {
  it('loads the v2 fixture successfully under the current (v3) reader', () => {
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
  });

  it('bumps schemaVersion from 2 to 3 on load', () => {
    expect(V2_FIXTURE.schemaVersion).toBe(2);
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(3);
  });

  it('reports a single applied step { from: 2, to: 3 }', () => {
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationSteps).toEqual([{ from: 2, to: 3 }]);
  });

  it('does NOT invent a waterLevelMm on the tank (migration is a pure no-op identity)', () => {
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The field must be ABSENT, not present-with-undefined — "no water level"
    // means "default fill derived at render time" and must round-trip as
    // "no field" to match the v2 baseline. The marshal must never
    // materialise the default either.
    expect('waterLevelMm' in result.document.tank).toBe(false);
  });

  it('preserves v2 layer zones untouched through the migration', () => {
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.layers.map((l) => l.zone)).toEqual(
      V2_FIXTURE.layers.map((l) => l.zone),
    );
  });

  it('preserves every other field byte-for-byte (only schemaVersion changed)', () => {
    const result = loadAquaDocument(V2_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strip the version field from both sides and expect deep equality.
    const { schemaVersion: _v2Version, ...v2Rest } = V2_FIXTURE;
    const { schemaVersion: _v3Version, ...migratedRest } = result.document;
    expect(migratedRest).toEqual(v2Rest);
  });
});
