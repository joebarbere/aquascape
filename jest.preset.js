const nxPreset = require('@nx/jest/preset').default;

module.exports = {
  ...nxPreset,
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  testEnvironment: 'node',
};
