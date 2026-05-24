/* eslint-disable */
export default {
  displayName: 'platform-api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // The `angular` sub-entry imports `@angular/core`. Angular ships as ESM and
  // its real module graph isn't loadable from the workspace's CommonJS jest
  // preset. The sub-entry only uses `InjectionToken`, so we redirect that
  // import to a tiny stub for the duration of the test run. Production
  // builds and other libs continue to resolve the real `@angular/core`.
  moduleNameMapper: {
    '^@angular/core$': '<rootDir>/src/angular/__mocks__/angular-core-stub.ts',
  },
  coverageDirectory: '../../../coverage/libs/platform/platform-api',
};
