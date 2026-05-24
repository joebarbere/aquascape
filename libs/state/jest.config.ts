// Jest config for libs/state. F1.1 Phase B.
//
// NgRx packages ship "partially compiled" — their static initializers call
// into `@angular/core`'s JIT compiler, so a plain ts-jest setup throws
// `'@angular/compiler' is not available`. `jest-preset-angular` bootstraps
// the JIT compiler + zone test env, which is what NgRx expects at test
// time. We keep the rest of the config (path mapping, coverage threshold)
// in line with the other libs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';

const tsconfigPath = resolve(__dirname, '../../tsconfig.base.json');
const tsconfigJson = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
  compilerOptions: { paths: Record<string, string[]> };
};

const moduleNameMapper: Record<string, string | string[]> = pathsToModuleNameMapper(
  tsconfigJson.compilerOptions.paths,
  { prefix: '<rootDir>/../../' },
) as Record<string, string | string[]>;

const config: Config = {
  displayName: 'state',
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageDirectory: '../../coverage/libs/state',
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular|@ngrx|rxjs|tslib)'],
  testPathIgnorePatterns: ['/node_modules/'],
  // F1.1 Phase B: NgRx scene store. 90% threshold mirrors the domain libs so
  // future refactors can't silently drop store coverage. (CI's coverage gate
  // doesn't yet include scope:state per its tag filter; this enforces locally.)
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};

export default config;
