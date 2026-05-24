/* eslint-disable */
// renderer-api is a TYPES-ONLY lib. The contract is enforced by `tsc`;
// there is no runtime code to cover. The single `index.spec.ts` exists
// to pin the public type shape (it fails to compile if a public type
// is broken). Coverage thresholds are intentionally NOT set — there is
// nothing to threshold.
export default {
  displayName: 'rendering-renderer-api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/rendering/renderer-api',
};
