// Test-only stub for the `three/examples/jsm/loaders/GLTFLoader` ESM addon.
//
// Same rationale as `orbit-controls-stub.ts` / `postprocessing-stub.ts`:
// the addon ships as native ESM with no CJS twin, and Jest's preset loads
// three's CJS build and can't `require()` it. The `ModelCache` only
// constructs `GLTFLoader` in its DEFAULT loader path, which is itself
// guarded behind `typeof document !== 'undefined'` — so under jsdom-less
// unit tests the class is never instantiated; the stub just has to be
// requireable so the module-level `import` resolves. Tests that exercise
// real load behaviour inject a fake `ModelLoadFn` instead.
//
// Production builds load the real addon (the app's esbuild bundle resolves
// it via tsconfig path-maps + an ambient `.d.ts` shim, exactly like
// OrbitControls).

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */

export class GLTFLoader {
  constructor(..._args: any[]) {}
  load(
    _url: string,
    _onLoad: (gltf: unknown) => void,
    _onProgress?: unknown,
    _onError?: (err: unknown) => void,
  ): void {}
}
