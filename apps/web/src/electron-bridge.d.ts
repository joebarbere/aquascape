// Ambient typing for the Electron preload bridge, mirrored from
// `apps/desktop/src/preload/global.d.ts`. Kept in apps/web (not imported
// from apps/desktop) because:
//   1. The module-boundary rules treat each app as its own boundary; one
//      app importing another app's types would invite the wrong kind of
//      coupling.
//   2. The shape exposed at `window.aquascape` is a *contract* between the
//      web bundle and any Electron shell that loads it. Stating it locally
//      makes the contract obvious here at the consumer end.
//
// If the shape ever diverges from `apps/desktop/src/preload/global.d.ts`,
// either side calling `window.aquascape.ipc.<channel>` will fail at runtime
// — which is exactly the signal we want. Stage 1+ may extract this into a
// small shared lib if more renderer consumers appear.

declare global {
  interface Window {
    readonly aquascape?: {
      readonly ipc: {
        // The renderer in Stage 0 only reads the existence of `ipc` to pick
        // a platform binding — it does not invoke channels directly.
        // F1.4+ will populate this with channel signatures when the
        // runtime-detect approach is replaced or extended.
        readonly [channel: string]: (payload: unknown) => Promise<unknown>;
      };
    };
  }
}

export {};
