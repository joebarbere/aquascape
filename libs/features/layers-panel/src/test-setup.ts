import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// jsdom 20 ships with `crypto` but not `crypto.randomUUID`. The scene-model
// id factory calls `crypto.randomUUID()` directly; polyfill here so any
// `newLayerId()` / `newObjectId()` call from the panel components doesn't
// crash under tests.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const cryptoLike: { randomUUID?: () => string } =
    (globalThis.crypto as unknown as {
      randomUUID?: () => string;
    }) ?? {};
  cryptoLike.randomUUID = (): string =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, 'crypto', { value: cryptoLike, configurable: true });
  }
}
