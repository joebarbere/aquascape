// Jest config for apps/web. Stage 0 F0.6.
//
// Angular standalone components need jest-preset-angular for the Angular
// compiler-aware ts-jest transform (it sets up `tslib`, the `zone.js`
// testing helpers, and the html / inline-template preprocessor). We pin the
// workspace's coverage reporters so the CI coverage gate sees a consistent
// shape.
//
// Test environment is jsdom — the component spec exercises ResizeObserver
// and a real DOM tree. Renderer interactions are stubbed via a mock
// SCENE_RENDERER provider so the test doesn't depend on a real canvas
// implementation.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

// Inline-read tsconfig.base.json (it contains JSON5 / comments? no — plain
// JSON) so jest resolves `@aquascape/*` exactly like the workspace TS does.
// Doing this in code (rather than copy-pasting the paths) keeps the mapping
// authoritative against the workspace tsconfig.
const tsconfigPath = resolve(__dirname, '../../tsconfig.base.json');
const tsconfigJson = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

const moduleNameMapper: Record<string, string | string[]> = pathsToModuleNameMapper(
  tsconfigJson.compilerOptions.paths,
  { prefix: '<rootDir>/../../' },
) as Record<string, string | string[]>;

// Stage 10 F10.3 — redirect Three.js's ESM-only OrbitControls addon to the
// CJS stub shipped in `renderer-3d/src/__mocks__/`. The renderer-3d's own
// jest.config.ts wires the same mapping; we duplicate here because apps/web
// now imports `Three3DRenderer` via the `SCENE_RENDERER_3D` token, and that
// import path runs OrbitControls' module-level code under jest.
moduleNameMapper['^three/examples/jsm/controls/OrbitControls$'] =
  '<rootDir>/../../libs/rendering/renderer-3d/src/__mocks__/orbit-controls-stub.ts';
// Fidelity pass (bloom) — same dance for the postprocessing addons: apps/web
// imports `Three3DRenderer` (which imports these) via `SCENE_RENDERER_3D`.
moduleNameMapper[
  '^three/examples/jsm/postprocessing/(EffectComposer|RenderPass|UnrealBloomPass|OutputPass)$'
] = '<rootDir>/../../libs/rendering/renderer-3d/src/__mocks__/postprocessing-stub.ts';

const config: Config = {
  displayName: 'web',
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageDirectory: '../../coverage/apps/web',
  moduleFileExtensions: ['ts', 'html', 'js', 'mjs'],
  moduleNameMapper,
  transform: {
    '^.+\\.(ts|js|mjs|html|svg)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular|rxjs|tslib)'],
  testPathIgnorePatterns: ['/node_modules/'],
};

export default config;
