// Test-only stub for the `three/examples/jsm/postprocessing/*` ESM addons.
//
// Same rationale as `orbit-controls-stub.ts`: those addons ship as native
// ESM with no CJS twin, and Jest's preset loads three's CJS build and can't
// `require()` them. The renderer only ever constructs these behind an
// `instanceof WebGLRenderer` guard (false under the headless test stub), so
// the classes are never actually instantiated in unit tests — the stub just
// has to be requireable so the module-level `import` resolves.
//
// Production builds load the real addons (the app's esbuild bundle resolves
// them via tsconfig path-maps + an ambient `.d.ts` shim).

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function */

export class EffectComposer {
  constructor(..._args: any[]) {}
  setSize(_w: number, _h: number): void {}
  setPixelRatio(_r: number): void {}
  addPass(_pass: unknown): void {}
  render(_delta?: number): void {}
  dispose(): void {}
}

export class RenderPass {
  constructor(..._args: any[]) {}
  dispose(): void {}
}

export class UnrealBloomPass {
  threshold = 0;
  strength = 0;
  radius = 0;
  constructor(..._args: any[]) {}
  setSize(_w: number, _h: number): void {}
  dispose(): void {}
}

export class OutputPass {
  constructor(..._args: any[]) {}
  dispose(): void {}
}
