/**
 * Pinned regression test for migrating a v1 document to the current reader.
 *
 * The fixture under `__fixtures__/example.v1.aqua.json` is a byte-identical
 * snapshot of `example.aqua.json` from the day v1 was locked. It is NEVER
 * edited going forward — every future format change adds a new fixture next
 * to it (see `example.v2.aqua.json` + `v2-fixture-migration.spec.ts`) and a
 * test that loads each in turn.
 *
 * The contract for loading a v1 document under the current (v4) reader is:
 *   1. The v1 fixture loads (every later version is a structural superset of
 *      v1 — additive optional fields only).
 *   2. After loading, `schemaVersion === 4` (the full chain ran).
 *   3. Every layer ends up with `zone` absent and the tank with `waterLevelMm`
 *      AND `waterChemistry` absent (each migration is a pure identity that
 *      bumps the version number; it does NOT invent values).
 *   4. The loader reports the applied steps `{1→2}, {2→3}, {3→4}` in order.
 *   5. Apart from `schemaVersion`, the document is byte-for-byte unchanged
 *      (no shape rewrites slipped in under the no-op label).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument } from './aqua-document';
import { loadAquaDocument } from './serialize';

const V1_FIXTURE_PATH = resolve(__dirname, '__fixtures__/example.v1.aqua.json');
const V1_FIXTURE_JSON = readFileSync(V1_FIXTURE_PATH, 'utf8');
const V1_FIXTURE: AquaDocument = JSON.parse(V1_FIXTURE_JSON);

describe('v1 → current migration (pinned fixture)', () => {
  it('loads the v1 fixture successfully under the current (v4) reader', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
  });

  it('bumps schemaVersion from 1 to 4 on load', () => {
    expect(V1_FIXTURE.schemaVersion).toBe(1);
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(4);
  });

  it('reports the applied steps { 1 → 2 }, { 2 → 3 }, { 3 → 4 } in order', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationSteps).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ]);
  });

  it('does NOT invent a zone on any layer (migration is a pure no-op identity)', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const layer of result.document.layers) {
      // The field must be ABSENT, not present-with-undefined — the schema's
      // `additionalProperties: false` would reject literal undefined, and
      // "no zone" must round-trip as "no field" to match the v1 baseline.
      expect('zone' in layer).toBe(false);
    }
  });

  it('does NOT invent a waterLevelMm on the tank (v3 step is a pure no-op identity)', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same absent-not-undefined contract as zone: "no water level" means
    // "default fill derived at render time", and must stay an absent field.
    expect('waterLevelMm' in result.document.tank).toBe(false);
  });

  it('does NOT invent a waterChemistry on the tank (v4 step is a pure no-op identity)', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same absent-not-undefined contract: "no chemistry recorded" means the
    // tank was never cycled, and must stay an absent field.
    expect('waterChemistry' in result.document.tank).toBe(false);
  });

  it('preserves every other field byte-for-byte (only schemaVersion changed)', () => {
    const result = loadAquaDocument(V1_FIXTURE_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Strip the version field from both sides and expect deep equality.
    const { schemaVersion: _v1Version, ...v1Rest } = V1_FIXTURE;
    const { schemaVersion: _migratedVersion, ...migratedRest } = result.document;
    expect(migratedRest).toEqual(v1Rest);
  });
});
