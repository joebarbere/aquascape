/* eslint-disable */
export default {
  displayName: 'features-export',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/features/export',
  // Branch coverage held at 80% (statement / line / function stay at 90%):
  // the F7.4 setup-sheet expansion adds many small per-section defensive
  // guards (catalog-entry-missing, optional-field-absent, coverageLitres
  // min-only / max-only / both) that aren't all naturally exercised from
  // unit tests. Matches the pattern other feature libs use.
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
