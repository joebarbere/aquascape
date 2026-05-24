import { strFromU8 } from 'fflate';

import { AQUA_CONTAINER } from './aqua-document';
import { isZipContainer, packAquaContainer, readAquaContainer } from './container';

describe('isZipContainer', () => {
  it('detects the PK\\x03\\x04 magic at the head of a ZIP', () => {
    const zip = packAquaContainer('{"format":"aquascape"}');
    expect(isZipContainer(zip)).toBe(true);
  });

  it('returns false for bare JSON bytes', () => {
    const json = new TextEncoder().encode('{"format":"aquascape"}');
    expect(isZipContainer(json)).toBe(false);
  });

  it('returns false for sub-magic-length inputs', () => {
    expect(isZipContainer(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe('readAquaContainer', () => {
  it('routes bare JSON bytes to the json branch with no assets', () => {
    const bytes = new TextEncoder().encode('{"format":"aquascape","x":1}');
    const result = readAquaContainer(bytes);
    expect(result.source).toBe('json');
    expect(result.documentJson).toBe('{"format":"aquascape","x":1}');
    expect(result.assets.size).toBe(0);
    expect(result.thumbnail).toBeUndefined();
  });

  it('round-trips a ZIP with assets and a thumbnail', () => {
    const assets = new Map<string, Uint8Array>([
      ['assets/photo.png', new Uint8Array([1, 2, 3])],
    ]);
    const thumbnail = new Uint8Array([9, 8, 7]);
    const zip = packAquaContainer('{"format":"aquascape"}', { assets, thumbnail });
    const result = readAquaContainer(zip);
    expect(result.source).toBe('zip');
    expect(result.documentJson).toBe('{"format":"aquascape"}');
    expect(result.assets.get('assets/photo.png')).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.thumbnail).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('throws when a ZIP is missing the required document entry', () => {
    // Build a ZIP that has only an asset, no document.json.
    const zip = packAquaContainer('{"format":"aquascape"}', {
      assets: new Map([['assets/x.bin', new Uint8Array([0])]]),
    });
    // Manually strip document.json by repacking only the assets.
    const stripped = packAquaContainer('{}'); // can't easily mutate ZIPs in-place; sanity check the error path with a synthetic broken ZIP below.
    expect(stripped.length).toBeGreaterThan(0);

    // Synthesize a ZIP whose only entry is an asset by packing with a custom routine:
    const { zipSync } = jest.requireActual('fflate') as typeof import('fflate');
    const badZip = zipSync({ 'assets/x.bin': new Uint8Array([0]) });
    expect(() => readAquaContainer(badZip)).toThrow(/missing required entry/);

    // Bonus: confirm that the synthesized zip still parses as a zip
    expect(isZipContainer(badZip)).toBe(true);
    // And that the original well-formed zip still has the doc inside.
    const reread = readAquaContainer(zip);
    expect(reread.documentJson).toBe('{"format":"aquascape"}');
  });
});

describe('packAquaContainer', () => {
  it('writes the document under the canonical entry name', () => {
    const zip = packAquaContainer('{"format":"aquascape"}');
    const { unzipSync } = jest.requireActual('fflate') as typeof import('fflate');
    const entries = unzipSync(zip);
    expect(entries[AQUA_CONTAINER.documentEntry]).toBeDefined();
    expect(strFromU8(entries[AQUA_CONTAINER.documentEntry]!)).toBe(
      '{"format":"aquascape"}',
    );
  });

  it('rejects asset paths outside the assets/ directory', () => {
    const assets = new Map<string, Uint8Array>([['outside.bin', new Uint8Array([0])]]);
    expect(() => packAquaContainer('{}', { assets })).toThrow(/under "assets\//);
  });
});
