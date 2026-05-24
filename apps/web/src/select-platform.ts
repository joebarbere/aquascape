// Runtime selector between platform-web and platform-electron. Extracted
// from `main.ts` so it can be unit-tested without driving the full
// bootstrapApplication path.
//
// The check is intentionally narrow: presence of `window.aquascape.ipc` is
// the contract between the Electron shell's preload bridge and the web
// bundle. Anything else — including a hostile page that defines a fake
// `window.aquascape` — would still get the Electron binding, but that
// binding is in-memory in Stage 0 and switches to validated IPC channels in
// F1.4, so the worst case is "a normal browser tab uses a less convenient
// in-memory file service".

import type { Platform } from '@aquascape/platform/platform-api';
import { createElectronPlatform } from '@aquascape/platform/platform-electron';
import { createWebPlatform } from '@aquascape/platform/platform-web';

/**
 * Pick the platform binding by sniffing `window.aquascape`. Returns the
 * Electron bundle when running inside the desktop shell, the web bundle
 * otherwise.
 */
export function selectPlatform(globalThisRef: typeof globalThis = globalThis): Platform {
  const win = (globalThisRef as { window?: Window | undefined }).window;
  const isElectron =
    typeof win !== 'undefined' &&
    typeof win.aquascape !== 'undefined' &&
    typeof win.aquascape?.ipc !== 'undefined';
  return isElectron ? createElectronPlatform() : createWebPlatform();
}
