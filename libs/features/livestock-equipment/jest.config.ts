/* eslint-disable */
// Jest config for libs/features/livestock-equipment. Stage 7 F7.1.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

const tsconfigPath = resolve(__dirname, '../../../tsconfig.base.json');
const tsconfigJson = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

const moduleNameMapper: Record<string, string | string[]> = pathsToModuleNameMapper(
  tsconfigJson.compilerOptions.paths,
  { prefix: '<rootDir>/../../../' },
) as Record<string, string | string[]>;

const config: Config = {
  displayName: 'features-livestock-equipment',
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageDirectory: '../../../coverage/libs/features/livestock-equipment',
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular|rxjs|tslib|@ngrx)'],
  testPathIgnorePatterns: ['/node_modules/'],
  // Branch coverage held at 80% — quantity-floor guard + "missing catalog
  // entry" fallback + a handful of defensive `??` paths aren't naturally
  // reachable from happy-path tests. Same precedent as features-planting-tool
  // and features-layers-panel.
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};

export default config;
