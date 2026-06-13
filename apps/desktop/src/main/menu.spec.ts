import type { MenuItemConstructorOptions } from 'electron';

import { buildMenuTemplate } from './menu';

function findMode(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions | undefined {
  return template.find((m) => m.label === 'Mode');
}

function modeItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const mode = findMode(template);
  return (mode?.submenu as MenuItemConstructorOptions[]) ?? [];
}

describe('buildMenuTemplate', () => {
  const noop = (): void => undefined;

  it('includes a Mode menu with Normal + Demo radio items', () => {
    const items = modeItems(
      buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode: noop }),
    );
    expect(items.map((i) => i.id)).toEqual(['mode-normal', 'mode-simulation']);
    expect(items.every((i) => i.type === 'radio')).toBe(true);
  });

  it('checks the radio item matching the current mode', () => {
    const normal = modeItems(
      buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode: noop }),
    );
    expect(normal.find((i) => i.id === 'mode-normal')?.checked).toBe(true);
    expect(normal.find((i) => i.id === 'mode-simulation')?.checked).toBe(false);

    const demo = modeItems(
      buildMenuTemplate({ currentMode: 'simulation', isMac: false, onSelectMode: noop }),
    );
    expect(demo.find((i) => i.id === 'mode-simulation')?.checked).toBe(true);
    expect(demo.find((i) => i.id === 'mode-normal')?.checked).toBe(false);
  });

  it('invokes onSelectMode with the chosen mode on click', () => {
    const onSelectMode = jest.fn();
    const items = modeItems(
      buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode }),
    );
    (items.find((i) => i.id === 'mode-simulation')?.click as () => void)();
    expect(onSelectMode).toHaveBeenCalledWith('simulation');
    (items.find((i) => i.id === 'mode-normal')?.click as () => void)();
    expect(onSelectMode).toHaveBeenCalledWith('normal');
  });

  it('keeps the standard roles so Quit / Copy / DevTools survive', () => {
    const roles = buildMenuTemplate({
      currentMode: 'normal',
      isMac: false,
      onSelectMode: noop,
    }).map((m) => m.role);
    expect(roles).toContain('fileMenu');
    expect(roles).toContain('editMenu');
    expect(roles).toContain('viewMenu');
    expect(roles).toContain('windowMenu');
  });

  it('adds the macOS app menu only on darwin', () => {
    const mac = buildMenuTemplate({ currentMode: 'normal', isMac: true, onSelectMode: noop });
    const other = buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode: noop });
    expect(mac.some((m) => m.role === 'appMenu')).toBe(true);
    expect(other.some((m) => m.role === 'appMenu')).toBe(false);
  });
});
