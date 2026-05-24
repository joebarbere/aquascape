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
import {
  createElectronPlatform,
  createIpcTransport,
  type IpcBridge,
} from '@aquascape/platform/platform-electron';
import { createWebPlatform } from '@aquascape/platform/platform-web';

/**
 * Pick the platform binding by sniffing `window.aquascape`. Returns the
 * Electron bundle (wired through real IPC channels as of F1.4) when running
 * inside the desktop shell, the web bundle otherwise.
 *
 * The check is intentionally narrow: presence of `window.aquascape.ipc` is
 * the contract between the Electron shell's preload bridge and the web
 * bundle. A hostile page that defines a fake `window.aquascape` would still
 * get the Electron binding, but every IPC channel validates its payload
 * main-process-side so the worst case is a normal browser tab seeing
 * confusing errors on save/open.
 */
export function selectPlatform(globalThisRef: typeof globalThis = globalThis): Platform {
  const win = (globalThisRef as { window?: Window | undefined }).window;
  const bridge = win?.aquascape?.ipc as unknown as IpcBridge | undefined;
  if (bridge !== undefined) {
    return createElectronPlatform(createIpcTransport(bridge));
  }
  return createWebPlatform({ globalRef: globalThisRef });
}
