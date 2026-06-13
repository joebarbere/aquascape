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

  function gameItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
    const game = template.find((m) => m.label === 'Game');
    return (game?.submenu as MenuItemConstructorOptions[]) ?? [];
  }

  it('includes a Game submenu with one radio item per game sub-mode', () => {
    const items = gameItems(
      buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode: noop }),
    );
    expect(items.map((i) => i.id)).toEqual([
      'mode-game-survival',
      'mode-game-feeding',
      'mode-game-predator',
      'mode-game-cleaner',
    ]);
    expect(items.every((i) => i.type === 'radio')).toBe(true);
    // Title-cased labels.
    expect(items.map((i) => i.label)).toEqual(['Survival', 'Feeding', 'Predator', 'Cleaner']);
  });

  it('checks the game radio item matching the current game mode', () => {
    const items = gameItems(
      buildMenuTemplate({ currentMode: 'game:predator', isMac: false, onSelectMode: noop }),
    );
    expect(items.find((i) => i.id === 'mode-game-predator')?.checked).toBe(true);
    expect(items.find((i) => i.id === 'mode-game-survival')?.checked).toBe(false);
  });

  it('leaves every game item unchecked in a non-game mode', () => {
    const items = gameItems(
      buildMenuTemplate({ currentMode: 'simulation', isMac: false, onSelectMode: noop }),
    );
    expect(items.every((i) => i.checked === false)).toBe(true);
  });

  it('invokes onSelectMode with the game:<submode> token on click', () => {
    const onSelectMode = jest.fn();
    const items = gameItems(
      buildMenuTemplate({ currentMode: 'normal', isMac: false, onSelectMode }),
    );
    (items.find((i) => i.id === 'mode-game-feeding')?.click as () => void)();
    expect(onSelectMode).toHaveBeenCalledWith('game:feeding');
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
