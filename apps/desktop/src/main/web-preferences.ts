// Pure builder for the BrowserWindow `webPreferences` block — extracted so
// the security posture can be asserted in unit tests **without booting
// Electron**. Plan §3 / F0.6.
//
// IMPORTANT: every flag below is non-negotiable. The companion test
// (`web-preferences.spec.ts`) asserts every key/value pair literally.
// Changing any field here without updating the test is a security-relevant
// drift; the test will fail and force a deliberate review.
//
// We deliberately do NOT pass any Electron value types through here — the
// function consumes a preload path (string) and returns a plain object. The
// concrete `WebPreferences` shape is imported only as a *structural* type so
// the unit test can compile without Electron's runtime.

/**
 * Strict subset of Electron's `WebPreferences` that we set. Defined locally
 * so this module has zero runtime dependency on `electron`.
 *
 * Fields are intentionally required (not `?`) — omission is a foot-gun.
 */
export interface SecureWebPreferences {
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webSecurity: true;
  readonly preload: string;
}

/**
 * Build the secure `webPreferences` for the Aquascape main window.
 *
 * @param preloadPath Absolute path to the compiled preload script.
 */
export function buildWebPreferences(preloadPath: string): SecureWebPreferences {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    preload: preloadPath,
  };
}
