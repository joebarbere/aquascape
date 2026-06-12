import { DataTexture, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { buildBackdropTexture, updateBackdropTint } from './backdrop';

describe('backdrop (scenic gradient)', () => {
  it('builds an equirectangular DataTexture with opaque RGBA data (no GL needed)', () => {
    const tex = buildBackdropTexture('#ffffff');
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.mapping).toBe(EquirectangularReflectionMapping);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    const { width, height } = tex.image;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(width * height * 4);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
    tex.dispose();
  });

  it('ramps as a softly lit room: darker floor (bottom rows), lighter upper band (top rows)', () => {
    const tex = buildBackdropTexture('#ffffff');
    const { width, height } = tex.image;
    const data = tex.image.data as Uint8Array;
    const luma = (row: number): number => {
      const i = row * width * 4;
      return data[i]! + data[i + 1]! + data[i + 2]!;
    };
    // Row 0 is the bottom (floor), last row the top (upper band).
    expect(luma(height - 1)).toBeGreaterThan(luma(0));
    // The mid band stays in the 0x1a2030 family — dark, blue-dominant.
    const midRow = Math.floor(height * 0.4);
    const i = midRow * width * 4;
    expect(data[i + 2]!).toBeGreaterThan(data[i]!); // b > r
    expect(data[i]!).toBeLessThan(80); // still a dark backdrop
    tex.dispose();
  });

  it('tint multiplies the gradient — a dark midnight tint darkens every pixel vs noon', () => {
    const noon = buildBackdropTexture('#ffffff');
    const midnight = buildBackdropTexture('#101018');
    const noonData = noon.image.data as Uint8Array;
    const midnightData = midnight.image.data as Uint8Array;
    let totalDelta = 0;
    for (let i = 0; i < noonData.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        expect(midnightData[i + c]!).toBeLessThanOrEqual(noonData[i + c]!);
        totalDelta += noonData[i + c]! - midnightData[i + c]!;
      }
    }
    // Strongly different, not a rounding-level nudge (the e2e day-night
    // test depends on noon vs midnight reading visibly different).
    expect(totalDelta).toBeGreaterThan(noonData.length);
    noon.dispose();
    midnight.dispose();
  });

  it('updateBackdropTint rewrites the SAME data array in place and flags needsUpdate', () => {
    const tex = buildBackdropTexture('#ffffff');
    const dataRef = tex.image.data as Uint8Array;
    const before = Array.from(dataRef);
    // `needsUpdate` is a setter-only property on Texture — setting it
    // bumps `version`, which is the observable re-upload flag.
    const versionBefore = tex.version;
    updateBackdropTint(tex, '#101018');
    expect(tex.image.data).toBe(dataRef); // in place — no re-allocation
    expect(tex.version).toBeGreaterThan(versionBefore);
    expect(Array.from(dataRef)).not.toEqual(before);
    // Round-trip back to the original tint restores the original bytes
    // (pure function of tint → determinism / idempotency).
    updateBackdropTint(tex, '#ffffff');
    expect(Array.from(dataRef)).toEqual(before);
    tex.dispose();
  });

  it('is deterministic — same tint, same bytes', () => {
    const a = buildBackdropTexture('#a4c7e8');
    const b = buildBackdropTexture('#a4c7e8');
    expect(Array.from(a.image.data as Uint8Array)).toEqual(
      Array.from(b.image.data as Uint8Array),
    );
    a.dispose();
    b.dispose();
  });

  it('falls back to the white (identity) tint on malformed input instead of throwing', () => {
    const malformed = buildBackdropTexture('not-a-hex');
    const identity = buildBackdropTexture('#ffffff');
    expect(Array.from(malformed.image.data as Uint8Array)).toEqual(
      Array.from(identity.image.data as Uint8Array),
    );
    malformed.dispose();
    identity.dispose();
  });
});
