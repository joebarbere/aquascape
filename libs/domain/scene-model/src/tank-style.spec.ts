/**
 * Type-level + runtime coverage for `TankStyle.background` variants.
 *
 * The union is structurally identical to the on-disk `aqua-document.ts` —
 * this spec is the in-lib guard that no variant gets silently dropped or
 * its shape drifts away from the canonical document type.
 */

import type { TankStyle } from './types';

describe('TankStyle.background variants', () => {
  it('accepts a solid color', () => {
    const style: TankStyle = {
      frame: 'rimless',
      background: { kind: 'color', color: '#0b0d0e' },
    };
    expect(style.background.kind).toBe('color');
  });

  it('accepts none', () => {
    const style: TankStyle = {
      frame: 'rimless',
      background: { kind: 'none' },
    };
    expect(style.background.kind).toBe('none');
  });

  it('accepts an image asset reference', () => {
    const style: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'image',
        asset: {
          id: '00000000-0000-4000-8000-000000000001',
          uri: 'assets/backdrop.png',
          mimeType: 'image/png',
        },
      },
    };
    expect(style.background.kind).toBe('image');
  });

  it('accepts a gradient with angle (radians) and two stops', () => {
    const style: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: Math.PI / 2,
        stops: [
          { at: 0, color: '#0a1622' },
          { at: 1, color: '#3b6ea5' },
        ],
      },
    };
    expect(style.background.kind).toBe('gradient');
    if (style.background.kind === 'gradient') {
      expect(style.background.stops).toHaveLength(2);
      expect(style.background.stops[0].at).toBe(0);
      expect(style.background.stops[1].at).toBe(1);
      expect(style.background.angle).toBeCloseTo(Math.PI / 2);
    }
  });

  it('round-trips a gradient background through JSON losslessly', () => {
    const style: TankStyle = {
      frame: 'rimless',
      background: {
        kind: 'gradient',
        angle: Math.PI / 2,
        stops: [
          { at: 0, color: '#0a1622' },
          { at: 0.5, color: '#1c3a5c' },
          { at: 1, color: '#3b6ea5' },
        ],
      },
    };

    const round = JSON.parse(JSON.stringify(style)) as TankStyle;
    expect(round).toEqual(style);
  });
});
