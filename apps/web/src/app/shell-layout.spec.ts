import {
  boundsFor,
  clampPanelWidth,
  resolveBreakpoint,
  RAIL_BOUNDS_MEDIUM,
  RAIL_BOUNDS_WIDE,
  SHELL_STORAGE_KEYS,
  SIDEBAR_BOUNDS_MEDIUM,
  SIDEBAR_BOUNDS_WIDE,
} from './shell-layout';

describe('clampPanelWidth', () => {
  it('returns the raw value when inside [min, max]', () => {
    expect(clampPanelWidth(300, 200, 500, 320)).toBe(300);
  });

  it('clamps below the min', () => {
    expect(clampPanelWidth(100, 200, 500, 320)).toBe(200);
  });

  it('clamps above the max', () => {
    expect(clampPanelWidth(800, 200, 500, 320)).toBe(500);
  });

  it('returns the default for NaN', () => {
    expect(clampPanelWidth(Number.NaN, 200, 500, 320)).toBe(320);
  });

  it('returns the default for ±Infinity', () => {
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 200, 500, 320)).toBe(320);
    expect(clampPanelWidth(Number.NEGATIVE_INFINITY, 200, 500, 320)).toBe(320);
  });

  it('accepts boundary values', () => {
    expect(clampPanelWidth(200, 200, 500, 320)).toBe(200);
    expect(clampPanelWidth(500, 200, 500, 320)).toBe(500);
  });
});

describe('resolveBreakpoint', () => {
  it('returns `phone` below 768px', () => {
    expect(resolveBreakpoint(320)).toBe('phone');
    expect(resolveBreakpoint(767)).toBe('phone');
  });

  it('returns `tablet` in [768, 1199]', () => {
    expect(resolveBreakpoint(768)).toBe('tablet');
    expect(resolveBreakpoint(1024)).toBe('tablet');
    expect(resolveBreakpoint(1199)).toBe('tablet');
  });

  it('returns `wide` at 1200+', () => {
    expect(resolveBreakpoint(1200)).toBe('wide');
    expect(resolveBreakpoint(1920)).toBe('wide');
  });
});

describe('boundsFor', () => {
  it('uses wide bounds for wide + phone', () => {
    expect(boundsFor('wide', 'sidebar')).toEqual(SIDEBAR_BOUNDS_WIDE);
    expect(boundsFor('wide', 'rail')).toEqual(RAIL_BOUNDS_WIDE);
    expect(boundsFor('phone', 'sidebar')).toEqual(SIDEBAR_BOUNDS_WIDE);
    expect(boundsFor('phone', 'rail')).toEqual(RAIL_BOUNDS_WIDE);
  });

  it('uses medium bounds for tablet', () => {
    expect(boundsFor('tablet', 'sidebar')).toEqual(SIDEBAR_BOUNDS_MEDIUM);
    expect(boundsFor('tablet', 'rail')).toEqual(RAIL_BOUNDS_MEDIUM);
  });
});

describe('SHELL_STORAGE_KEYS', () => {
  it('uses the documented namespacing', () => {
    expect(SHELL_STORAGE_KEYS.sidebarWidth).toBe('aquascape.ui.shell.sidebarWidth');
    expect(SHELL_STORAGE_KEYS.railWidth).toBe('aquascape.ui.shell.railWidth');
    expect(SHELL_STORAGE_KEYS.sidebarCollapsed).toBe('aquascape.ui.shell.sidebarCollapsed');
    expect(SHELL_STORAGE_KEYS.railCollapsed).toBe('aquascape.ui.shell.railCollapsed');
  });
});
