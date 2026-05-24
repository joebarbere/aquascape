/* eslint-disable */
export default {
  displayName: 'domain-catalog',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'cjs'],
  // Exclude generated AJV validators from coverage. The standalone code
  // is `tools/precompile-validators.mjs` output — auto-generated, NOT
  // hand-maintained — and bloats stats. Its inputs (the JSON schema) are
  // covered indirectly via the wrapper tests in `validator.spec.ts`.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  coverageDirectory: '../../../coverage/libs/domain/catalog',
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
