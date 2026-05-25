// Verify the preset table matches the published dimensions documented in
// `tank-presets.ts`. These are load-bearing: a copy-paste error here would
// quietly ship a tank with the wrong volume.

import {
  TANK_PRESET_CATALOG,
  TANK_PRESET_VERSION,
  tankPresets,
} from './tank-presets';

describe('tankPresets', () => {
  it('catalog metadata is the "core" namespace at version 1', () => {
    expect(TANK_PRESET_CATALOG).toBe('core');
    expect(TANK_PRESET_VERSION).toBe(1);
  });

  it('contains the documented preset ids across all four brands', () => {
    // Spot-check ids are present rather than asserting an exact list — the
    // exact list is verified per-brand below, and a tight equality check
    // here would make every additive change a multi-spec churn.
    const ids = new Set(tankPresets.map((p) => p.id));
    for (const id of [
      // ADA core line
      'ada.mini-s',
      'ada.mini-m',
      'ada.30-c',
      'ada.45-p',
      'ada.60-f',
      'ada.60-p',
      'ada.75-p',
      'ada.90-p',
      'ada.120-p',
      'ada.150-p',
      // UNS sampler
      'uns.5n',
      'uns.5s',
      'uns.16c',
      'uns.25c',
      'uns.30c',
      'uns.45u',
      'uns.60l',
      'uns.60s',
      'uns.60u',
      'uns.75p',
      'uns.75s',
      'uns.90l',
      'uns.90u',
      'uns.120s',
      'uns.120u',
      // Waterbox sampler
      'waterbox.clear-mini-10',
      'waterbox.clear-mini-16',
      'waterbox.cube-20',
      'waterbox.clear-mini-30',
      // US standards
      'standard.5-gal-cube',
      'standard.10-gal',
      'standard.20-gal-h',
      'standard.29-gal',
      'standard.40-gal-b',
      'standard.75-gal',
      'standard.90-gal',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it.each([
    // ADA (interior dimensions per ADA / Aquasabi spec sheets).
    ['ada.mini-s', 310, 185, 185, 'rimless'],
    ['ada.mini-m', 360, 220, 220, 'rimless'],
    ['ada.30-c', 300, 300, 300, 'rimless'],
    ['ada.45-p', 450, 300, 270, 'rimless'],
    ['ada.60-f', 600, 250, 300, 'rimless'],
    ['ada.60-p', 600, 300, 360, 'rimless'],
    ['ada.75-p', 750, 450, 450, 'rimless'],
    ['ada.90-p', 900, 450, 450, 'rimless'],
    ['ada.120-p', 1200, 450, 450, 'rimless'],
    ['ada.150-p', 1500, 600, 600, 'rimless'],
    // UNS (from the official 2019 size guide PDF + 5S post-2019 release).
    ['uns.5n', 360, 220, 220, 'rimless'],
    ['uns.5s', 360, 120, 220, 'rimless'],
    ['uns.16c', 160, 160, 160, 'rimless'],
    ['uns.25c', 250, 250, 250, 'rimless'],
    ['uns.30c', 300, 300, 300, 'rimless'],
    ['uns.45u', 450, 280, 280, 'rimless'],
    ['uns.60l', 600, 200, 200, 'rimless'],
    ['uns.60s', 600, 180, 360, 'rimless'],
    ['uns.60u', 600, 360, 360, 'rimless'],
    ['uns.75p', 750, 450, 450, 'rimless'],
    ['uns.75s', 750, 300, 450, 'rimless'],
    ['uns.90l', 900, 300, 300, 'rimless'],
    ['uns.90u', 900, 560, 560, 'rimless'],
    ['uns.120s', 1200, 360, 600, 'rimless'],
    ['uns.120u', 1200, 600, 600, 'rimless'],
    // Waterbox.
    ['waterbox.clear-mini-10', 500, 300, 250, 'rimless'],
    ['waterbox.clear-mini-16', 600, 360, 300, 'rimless'],
    ['waterbox.cube-20', 450, 400, 450, 'rimless'],
    ['waterbox.clear-mini-30', 800, 400, 400, 'rimless'],
    // US framed / braced (Aqueon size chart).
    ['standard.5-gal-cube', 410, 250, 200, 'framed'],
    ['standard.10-gal', 508, 254, 305, 'framed'],
    ['standard.20-gal-h', 610, 305, 407, 'framed'],
    ['standard.29-gal', 768, 476, 318, 'framed'],
    ['standard.40-gal-b', 915, 457, 407, 'framed'],
    ['standard.75-gal', 1232, 537, 470, 'braced'],
    ['standard.90-gal', 1232, 638, 470, 'braced'],
  ])('%s = %i × %i × %i mm / frame=%s', (id, w, h, d, frame) => {
    const preset = tankPresets.find((p) => p.id === id);
    expect(preset).toBeDefined();
    expect(preset!.width).toBe(w);
    expect(preset!.height).toBe(h);
    expect(preset!.depth).toBe(d);
    expect(preset!.frame).toBe(frame);
  });

  it('every preset has integer-millimetre dimensions', () => {
    for (const preset of tankPresets) {
      expect(Number.isInteger(preset.width)).toBe(true);
      expect(Number.isInteger(preset.height)).toBe(true);
      expect(Number.isInteger(preset.depth)).toBe(true);
    }
  });

  it('every preset id is unique', () => {
    const ids = tankPresets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset carries a known brand', () => {
    const knownBrands = new Set(['ADA', 'UNS', 'Waterbox', 'Standard']);
    for (const preset of tankPresets) {
      expect(knownBrands.has(preset.brand)).toBe(true);
    }
  });
});
