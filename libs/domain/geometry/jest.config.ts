/* eslint-disable */
export default {
  displayName: 'domain-geometry',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/domain/geometry',
  // F0.2 enforces ≥90% on domain libs (plan §3). Threshold lives here so
  // local `nx test domain-geometry --coverage` matches CI.
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
