import { DataTexture, EquirectangularReflectionMapping, SRGBColorSpace } from 'three';
import { buildEnvEquirectTexture, ENV_INTENSITY } from './environment';

describe('environment (IBL gradient)', () => {
  it('builds an equirectangular DataTexture with RGBA data', () => {
    const tex = buildEnvEquirectTexture();
    expect(tex).toBeInstanceOf(DataTexture);
    expect(tex.mapping).toBe(EquirectangularReflectionMapping);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    const { width, height } = tex.image;
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(width * height * 4);
    // Fully opaque.
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
    tex.dispose();
  });

  it('ramps brighter toward the sky pole (top rows) than the floor pole (bottom rows)', () => {
    const tex = buildEnvEquirectTexture();
    const { width, height } = tex.image;
    const data = tex.image.data as Uint8Array;
    const luma = (row: number): number => {
      const i = row * width * 4;
      return data[i]! + data[i + 1]! + data[i + 2]!;
    };
    // Row 0 is the floor (bottom), last row is the sky (top) — sky is brighter.
    expect(luma(height - 1)).toBeGreaterThan(luma(0));
    tex.dispose();
  });

  it('exposes a modest default environment intensity', () => {
    expect(ENV_INTENSITY).toBeGreaterThan(0);
    expect(ENV_INTENSITY).toBeLessThan(1);
  });
});
