/* eslint-disable */
// F0.4 — Canvas2DRenderer is exercised through op-counting tests against a
// hand-rolled FakeCanvas. We use testEnvironment: 'node' because there's
// no jsdom dependency in the workspace and our fake supplies everything
// the renderer needs to touch.
export default {
  displayName: 'rendering-renderer-2d',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/rendering/renderer-2d',
  // Exclude the in-lib test harness from coverage — it isn't shipped and
  // wouldn't be a useful coverage target. Same shape as scene-model.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/test-canvas.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  // Rendering libs targeted ≥90% in plan §3 (same bar as domain libs).
  // Branch coverage is held at 85% — Stage 3's selection handles and
  // hardscape painting add many small defensive guards (null-surface
  // re-render after dispose, zero-scale degenerate transforms, missing
  // catalog entries) that aren't naturally exercised from a unit test
  // without bypassing the renderer's own contract. The statement / line
  // / function gates stay at 90%.
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
