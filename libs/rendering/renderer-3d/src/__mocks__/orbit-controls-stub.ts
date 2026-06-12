// Test-only stub for `three/addons/controls/OrbitControls.js`.
//
// The real OrbitControls module is shipped as native ESM with no CJS twin.
// Jest's preset loads three's CJS build (`build/three.cjs`) but cannot
// `require()` the addons' ESM files. Rather than wiring an ESM jest
// environment (which would ripple to every other lib's spec config), we
// redirect the OrbitControls import to this stub via `moduleNameMapper`
// in `jest.config.ts`. The stub matches the public surface the renderer
// touches — `target`, `enableDamping`, `dampingFactor`, `minDistance`,
// `maxDistance`, `autoRotate`, `update()`, `dispose()` — and records
// `dispose` calls so the renderer's dispose-discipline test can assert
// teardown happened.
//
// Production builds load the real OrbitControls — bundlers (esbuild,
// webpack, vite, Angular's @angular/build) all handle the ESM addon path
// transparently. Only the jest spec config substitutes this stub.

import { Vector3, type Camera } from 'three';

export class OrbitControls {
  target = new Vector3();
  /** Fish-eye follow-cam toggles this; the real OrbitControls has it too. */
  enabled = true;
  enableDamping = false;
  dampingFactor = 0;
  minDistance = 0;
  maxDistance = Infinity;
  autoRotate = false;

  /** Increments per `dispose()` call so tests can assert teardown. */
  public disposed = 0;

  constructor(
    public readonly object: Camera,
    public readonly domElement: HTMLElement | undefined,
  ) {}

  update(): boolean {
    return false;
  }

  dispose(): void {
    this.disposed += 1;
  }
}
