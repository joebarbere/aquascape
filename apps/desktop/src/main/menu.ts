// Application-menu template — adds a "Mode" menu alongside the standard roles.
//
// Pure builder (no `electron` runtime import — only the structural
// `MenuItemConstructorOptions` type) so the template shape is unit-testable
// without booting Electron, the same split discipline as `web-preferences.ts`
// / `app-mode.ts`. `main.ts` feeds the result to `Menu.buildFromTemplate`.
//
// The "Mode" submenu carries one radio item per launch profile (see
// `app-mode.ts`). Selecting one switches the running app at runtime: the main
// process pushes the new mode to the renderer (load showcase / reveal editor)
// and toggles the window's fullscreen. The radio `checked` state reflects the
// CURRENT mode, so `main.ts` rebuilds the menu after every switch.

import type { MenuItemConstructorOptions } from 'electron';

import type { AppMode } from './app-mode';

export interface MenuTemplateOptions {
  /** The mode currently active — drives which radio item is checked. */
  readonly currentMode: AppMode;
  /** True on macOS — adds the leading app menu + uses the OS-standard layout. */
  readonly isMac: boolean;
  /** Invoked with the chosen mode when the user picks a "Mode" radio item. */
  readonly onSelectMode: (mode: AppMode) => void;
}

/**
 * Build the full application-menu template. Includes the standard roles
 * (app / file / edit / view / window) so replacing the default menu does not
 * drop Quit, Copy/Paste, Reload, DevTools, etc., plus the custom "Mode" menu.
 */
export function buildMenuTemplate(options: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const { currentMode, isMac, onSelectMode } = options;

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({ role: 'appMenu' });
  }

  template.push({ role: 'fileMenu' });
  template.push({ role: 'editMenu' });
  template.push({ role: 'viewMenu' });

  template.push({
    label: 'Mode',
    submenu: [
      {
        id: 'mode-normal',
        label: 'Normal Editor',
        type: 'radio',
        checked: currentMode === 'normal',
        click: () => onSelectMode('normal'),
      },
      {
        id: 'mode-simulation',
        label: 'Simulation',
        type: 'radio',
        checked: currentMode === 'simulation',
        click: () => onSelectMode('simulation'),
      },
    ],
  });

  template.push({ role: 'windowMenu' });

  return template;
}
