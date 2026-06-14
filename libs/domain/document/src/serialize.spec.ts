import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument, Migration } from './aqua-document';
import { packAquaContainer } from './container';
import {
  loadAquaDocument,
  packAquaDocument,
  serializeAquaDocument,
} from './serialize';

const EXAMPLE: AquaDocument = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../example.aqua.json'), 'utf8'),
);

describe('serializeAquaDocument', () => {
  it('returns compact JSON by default', () => {
    const out = serializeAquaDocument(EXAMPLE);
    expect(out.startsWith('{')).toBe(true);
    expect(out).not.toContain('\n');
  });

  it('pretty-prints when asked', () => {
    expect(serializeAquaDocument(EXAMPLE, { pretty: true })).toContain('\n');
  });

  it('round-trips through JSON.parse losslessly', () => {
    expect(JSON.parse(serializeAquaDocument(EXAMPLE))).toEqual(EXAMPLE);
  });
});

describe('loadAquaDocument', () => {
  it('loads a bare JSON string', () => {
    const json = serializeAquaDocument(EXAMPLE);
    const result = loadAquaDocument(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('json');
    expect(result.document).toEqual(EXAMPLE);
    expect(result.assets.size).toBe(0);
    expect(result.migrationSteps).toEqual([]);
  });

  it('loads bare JSON bytes', () => {
    const bytes = new TextEncoder().encode(serializeAquaDocument(EXAMPLE));
    const result = loadAquaDocument(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('json');
  });

  it('loads a packed ZIP container and preserves assets + thumbnail', () => {
    const assets = new Map<string, Uint8Array>([
      ['assets/photo.png', new Uint8Array([1, 2, 3])],
    ]);
    const thumbnail = new Uint8Array([9, 8, 7]);
    const zip = packAquaDocument(EXAMPLE, { assets, thumbnail });
    const result = loadAquaDocument(zip);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('zip');
    expect(result.document).toEqual(EXAMPLE);
    expect(result.assets.get('assets/photo.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.thumbnail).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('returns a json-parse-failed error for malformed JSON', () => {
    const result = loadAquaDocument('not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('json-parse-failed');
  });

  it('returns a schema-invalid error for valid JSON that is not an AquaDocument', () => {
    const result = loadAquaDocument('{"hello":"world"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema-invalid');
  });

  it('runs migrations before validation', () => {
    // EXAMPLE is at the current (v5) schemaVersion. Pretend a v6 reader is
    // running by injecting a hypothetical v5 → v6 step and targeting v6.
    // The current schema only constrains `schemaVersion: integer >= 1`, so
    // a doc whose version was just bumped to 6 still validates — the test's
    // intent is "validation runs AFTER migration", not the specific shape.
    const currentVersionDoc = serializeAquaDocument(EXAMPLE);
    const stepUp: Migration = {
      from: 5,
      to: 6,
      migrate: (d) => ({ ...(d as object), schemaVersion: 6 }),
    };
    const result = loadAquaDocument(currentVersionDoc, {
      migrations: [stepUp],
      targetVersion: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrationSteps).toEqual([{ from: 5, to: 6 }]);
    expect((result.document as { schemaVersion: number }).schemaVersion).toBe(6);
  });

  it('surfaces a migration-failed error when the chain has a gap', () => {
    const v1 = serializeAquaDocument(EXAMPLE);
    const result = loadAquaDocument(v1, { migrations: [], targetVersion: 6 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('migration-failed');
  });

  it('surfaces a container-malformed error for garbage ZIP-magic bytes', () => {
    // Start with the ZIP magic but fill the rest with nonsense.
    const corrupted = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff, 0xff]);
    const result = loadAquaDocument(corrupted);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('container-malformed');
  });

  it('surfaces a container-malformed error when a ZIP lacks document.json', () => {
    // Build a ZIP with only assets, no document.json.
    const { zipSync } = jest.requireActual('fflate') as typeof import('fflate');
    const badZip = zipSync({ 'assets/x.bin': new Uint8Array([0]) });
    const result = loadAquaDocument(badZip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('container-malformed');
  });
});

describe('packAquaContainer (re-tested via packAquaDocument)', () => {
  it('produces bytes that loadAquaDocument can read back', () => {
    const bytes = packAquaDocument(EXAMPLE);
    const result = loadAquaDocument(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual(EXAMPLE);
  });

  it('is a ZIP even when there are no assets (so reads as source: zip)', () => {
    const bytes = packAquaDocument(EXAMPLE);
    const result = loadAquaDocument(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('zip');
  });

  it('still accepts the bare-JSON form for asset-free docs (the docs say so)', () => {
    const bareJson = new TextEncoder().encode(serializeAquaDocument(EXAMPLE));
    const result = loadAquaDocument(bareJson);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('json');
  });

  it('honors the packAquaContainer wrapper API for plain strings', () => {
    const bytes = packAquaContainer('{"format":"aquascape","x":1}');
    const result = loadAquaDocument(bytes);
    // Schema rejects the partial doc, but we still get past container + parse.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('schema-invalid');
  });
});
