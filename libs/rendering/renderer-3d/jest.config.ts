/* eslint-disable */
// Stage 10 F10.1 — Three.js renderer. We run unit tests against the Three.js
// object graph (jest's default Node env is enough; Three.js builds scene
// graphs without needing a real GL context). The `Three3DRenderer` orchestrator
// uses a hand-rolled WebGL stub for its attach / dispose paths.
//
// Coverage gate is held at 70% branch / 80% statement / line / function —
// Three.js code paths have many defensive guards (WebGL init failures,
// missing-catalog fallbacks, controls-dispose-after-detach) that aren't
// naturally exercised without bypassing the contract. Same convention
// other rendering libs (renderer-2d) use for their own hard-to-cover
// branches.
//
// `moduleNameMapper` redirects the ESM-only OrbitControls addon to a CJS
// stub for the duration of the spec run. See
// `src/__mocks__/orbit-controls-stub.ts` for rationale.
export default {
  displayName: 'rendering-renderer-3d',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^three/examples/jsm/controls/OrbitControls$':
      '<rootDir>/src/__mocks__/orbit-controls-stub.ts',
  },
  coverageDirectory: '../../../coverage/libs/rendering/renderer-3d',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/__mocks__/**',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
