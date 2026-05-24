// Test-only stub for `@angular/core`.
//
// Angular core ships as ESM (`fesm2022/core.mjs`) and pulls in deep
// signal-runtime modules that the workspace's CommonJS jest preset cannot
// load. We don't need any of that here — the sub-entry only uses
// `InjectionToken`, which is a tiny named class. This file shims it so the
// spec can verify the token bindings without dragging Angular's full module
// graph into the test runtime.
//
// Wired up via `moduleNameMapper` in this lib's jest.config.ts. The
// production import path remains `@angular/core`; only jest sees this stub.

export class InjectionToken<T> {
  // The `_brand` field exists purely to retain the generic parameter `T`
  // in the type signature so callers preserve their service type. It is
  // never read at runtime.
  readonly _brand?: T;

  constructor(private readonly _desc: string) {}

  toString(): string {
    return `InjectionToken ${this._desc}`;
  }
}
