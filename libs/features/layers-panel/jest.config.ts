/* eslint-disable */
// Jest config for libs/features/layers-panel. Stage 4 F4.2.
//
// Angular standalone components need jest-preset-angular + jsdom. Path
// mapping pulled from tsconfig.base.json so `@aquascape/*` resolves
// identically to the workspace TS config.

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
  displayName: 'features-layers-panel',
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageDirectory: '../../../coverage/libs/features/layers-panel',
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
  // Branch coverage held at 80% — the panel's defensive `?? []` paths for
  // a null `currentScene` aren't easily reachable from realistic UI flows
  // (the store always emits a non-null scene by the time the panel binds).
  // Statements / lines / functions sit at 100%; matches the threshold used
  // by features-editor-shell for the same reason.
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
