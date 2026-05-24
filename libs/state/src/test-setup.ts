// Jest setup for libs/state. F1.1 Phase B.
//
// jest-preset-angular's zone setup bootstraps the Angular JIT compiler +
// test platform. NgRx's partially-compiled distributions require the JIT
// compiler to be available at runtime — without it we get
// `'@angular/compiler' is not available` from the static initializers in
// `@ngrx/store`.

import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();
