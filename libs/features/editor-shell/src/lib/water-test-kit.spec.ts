// Pure value → band/colour mapping tests. Plan Stage 13 F13.5 (F13.5b).

import type { WaterTestReading } from '@aquascape/domain/catalog';

import {
  PANEL_PARAMETERS,
  DEFAULT_PANEL_READINGS,
  buildPanelReadout,
  classifyBand,
  mapReading,
  parameterLabel,
} from './water-test-kit';

describe('water-test-kit mapping', () => {
  describe('classifyBand', () => {
    it('marks ammonia/nitrite safe at a trace, caution then danger as they climb', () => {
      expect(classifyBand('ammonia', 0)).toBe('safe');
      expect(classifyBand('ammonia', 0.2)).toBe('safe');
      expect(classifyBand('ammonia', 0.4)).toBe('caution');
      expect(classifyBand('ammonia', 2)).toBe('danger');
      expect(classifyBand('nitrite', 0.6)).toBe('danger');
    });

    it('marks nitrate safe low, caution mid, danger high', () => {
      expect(classifyBand('nitrate', 10)).toBe('safe');
      expect(classifyBand('nitrate', 30)).toBe('caution');
      expect(classifyBand('nitrate', 80)).toBe('danger');
    });

    it('judges pH by distance from the neutral band', () => {
      expect(classifyBand('ph', 7.0)).toBe('safe');
      expect(classifyBand('ph', 6.1)).toBe('caution');
      expect(classifyBand('ph', 5.5)).toBe('danger');
      expect(classifyBand('ph', 8.6)).toBe('danger');
    });

    it('treats a non-finite value as zero', () => {
      expect(classifyBand('ammonia', NaN)).toBe('safe');
    });
  });

  describe('mapReading', () => {
    const reading: WaterTestReading = { parameter: 'nitrate', min: 0, max: 160, unit: 'ppm' };

    it('normalises the value to its chart position, clamped to [0,1]', () => {
      expect(mapReading(reading, 0).fraction).toBe(0);
      expect(mapReading(reading, 80).fraction).toBeCloseTo(0.5, 5);
      expect(mapReading(reading, 999).fraction).toBe(1); // clamp past the top swatch
    });

    it('returns a hex swatch + the verdict band', () => {
      const row = mapReading(reading, 80);
      expect(row.swatch).toMatch(/^#[0-9a-f]{6}$/i);
      expect(row.band).toBe('danger');
      expect(row.unit).toBe('ppm');
    });

    it('a zero-span reading yields fraction 0 rather than NaN', () => {
      const flat: WaterTestReading = { parameter: 'ph', min: 7, max: 7, unit: 'pH' };
      expect(mapReading(flat, 7).fraction).toBe(0);
    });
  });

  describe('buildPanelReadout', () => {
    const apiReads: WaterTestReading[] = [
      { parameter: 'ph', min: 6.0, max: 7.6, unit: 'pH' },
      { parameter: 'ammonia', min: 0, max: 8, unit: 'ppm' },
      { parameter: 'nitrite', min: 0, max: 5, unit: 'ppm' },
      { parameter: 'nitrate', min: 0, max: 160, unit: 'ppm' },
    ];

    it('always returns the four panel rows in order', () => {
      const rows = buildPanelReadout({ ammonia: 0, nitrite: 0, nitrate: 0, ph: 7.4 }, apiReads);
      expect(rows.map((r) => r.parameter)).toEqual([...PANEL_PARAMETERS]);
    });

    it('reflects each parameter value into a band', () => {
      const rows = buildPanelReadout({ ammonia: 4, nitrite: 0, nitrate: 5, ph: 7.0 }, apiReads);
      const byParam = Object.fromEntries(rows.map((r) => [r.parameter, r]));
      expect(byParam['ammonia'].band).toBe('danger');
      expect(byParam['nitrate'].band).toBe('safe');
      expect(byParam['ph'].band).toBe('safe');
    });

    it('falls back to default ranges when the kit omits a parameter', () => {
      // A kit that only reads pH still produces all four rows.
      const rows = buildPanelReadout({ ammonia: 1, nitrite: 0, nitrate: 0, ph: 7.0 }, [
        { parameter: 'ph', min: 6, max: 7.6, unit: 'pH' },
      ]);
      const ammonia = rows.find((r) => r.parameter === 'ammonia');
      expect(ammonia?.max).toBe(DEFAULT_PANEL_READINGS.ammonia.max);
    });
  });

  it('parameterLabel covers the panel parameters', () => {
    expect(parameterLabel('ammonia')).toBe('Ammonia');
    expect(parameterLabel('ph')).toBe('pH');
    expect(parameterLabel('nitrate')).toBe('Nitrate');
  });
});
