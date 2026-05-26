// Stage 11 F11.1 Wave 3 — `buildLivestockMeshes` + per-archetype
// InstancedMesh + carangiform shader. Coverage band matches
// `rendering/renderer-3d` (70% branch / 80% line+function+statement) —
// Three.js code paths have defensive guards (WebGL init failures,
// missing-context fallbacks) that don't exercise naturally without
// bypassing the contract.
//
// Unit tests run under the default Node env: Three.js builds scene
// graphs without a GL context, and the spec asserts on the object
// graph + shader source rather than rasterized output.
export default {
  displayName: 'rendering-livestock-renderer-3d',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/rendering/livestock-renderer-3d',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
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
