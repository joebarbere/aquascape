// Ambient typings for the `window.aquascape` bridge — consumed by the
// renderer (apps/web) when running under Electron.
//
// The property is optional (`?:`) because:
//   1. The same web bundle runs in a normal browser, where `window.aquascape`
//      is undefined.
//   2. The renderer detects Electron at runtime via `typeof window.aquascape
//      !== 'undefined'` (see apps/web/src/main.ts).
//
// This file is referenced by apps/web's tsconfig so the Angular composition
// root can read `window.aquascape` without an `unknown` cast.

import type { IpcContract } from '../shared/ipc-contract';

declare global {
  interface Window {
    readonly aquascape?: {
      readonly ipc: IpcContract;
      /**
       * Launch mode forwarded from the main process (`aquascape --mode <mode>`).
       * `'simulation'` drives the borderless-fullscreen showcase; absent / `'normal'`
       * is the full editor. See `apps/desktop/src/main/app-mode.ts`.
       */
      readonly mode?: 'normal' | 'simulation';
      /**
       * Subscribe to runtime mode switches pushed from the "Mode" application
       * menu. The callback receives the validated mode; the returned thunk
       * unsubscribes. Absent in a browser build.
       */
      readonly onSetMode?: (callback: (mode: 'normal' | 'simulation') => void) => () => void;
    };
  }
}

export {};
