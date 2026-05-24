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

  it('contains the documented ADA + Standard presets', () => {
    expect(tankPresets.map((p) => p.id)).toEqual([
      'ada.mini-s',
      'ada.mini-m',
      'ada.60-p',
      'ada.90-p',
      'ada.120-p',
      'standard.10-gal',
      'standard.20-gal-h',
      'standard.40-gal-b',
    ]);
  });

  it.each([
    ['ada.mini-s', 310, 185, 185, 'rimless'],
    ['ada.mini-m', 360, 220, 220, 'rimless'],
    ['ada.60-p', 600, 300, 360, 'rimless'],
    ['ada.90-p', 900, 450, 450, 'rimless'],
    ['ada.120-p', 1200, 450, 450, 'rimless'],
    ['standard.10-gal', 508, 254, 305, 'framed'],
    ['standard.20-gal-h', 610, 305, 407, 'framed'],
    ['standard.40-gal-b', 915, 457, 407, 'framed'],
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
});
