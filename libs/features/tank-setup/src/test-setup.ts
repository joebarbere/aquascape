// Jest setup for libs/features/tank-setup. F1.1 Phase B.
//
// Boots the Angular browser-dynamic testing platform via jest-preset-angular's
// zone-based setup. Mirrors the apps/web test-setup so component specs see
// the same Angular configuration the production bundle gets.

import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();
