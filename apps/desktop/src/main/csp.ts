// Content-Security-Policy header for the Electron renderer. F0.6 / plan §3.
//
// The CSP is set EXCLUSIVELY here, as an HTTP response header. The web
// app's `index.html` deliberately does NOT include a `<meta http-equiv>`
// CSP tag — browsers AND multiple CSP sources (taking the most restrictive
// directive of each), so a stricter meta tag would silently override the
// dev-only `'unsafe-eval'` relaxation below and break the renderer. The
// production web deploy must set its own CSP via server response headers.
//
// Non-negotiables (must hold in **production / packaged** builds):
//   * No `'unsafe-eval'` in `script-src` — see DEV CAVEAT below.
//   * No `'unsafe-inline'` in `script-src` — only Angular-emitted style
//     elements get an inline exemption (this matches the web baseline).
//   * `object-src 'none'` and `frame-src 'none'` — no embedded plugins or
//     frames.
//   * `base-uri 'none'` — no `<base>` overrides that could change URL
//     resolution for relative paths.
//
// DEV CAVEAT (load-bearing, dev-only carve-out):
// The renderer eagerly imports `coreCatalog` from `@aquascape/domain/catalog`,
// which calls `validateCatalogEntry` (AJV) at module-init time. AJV compiles
// JSON-Schema validators via `new Function(...)`, which strict CSP forbids.
// For the dev build we ship `DEV_CSP` (identical to `ELECTRON_CSP` plus
// `'unsafe-eval'` in `script-src`) so the desktop dev experience works
// today. **Production / packaged builds must precompile AJV via its
// `standalone` mode and switch back to the strict CSP — see TODO in
// `plans/stage-4-followup-precompile-ajv.md` when that lands.**
//
// Stored as string constants so the tests can assert byte-for-byte; future
// changes will be deliberate, not silent.

export const ELECTRON_CSP =
  "default-src 'self' file:; " +
  "script-src 'self' file:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: file:; " +
  "connect-src 'self' file:; " +
  "font-src 'self' file:; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "base-uri 'none'";

/**
 * Dev-only variant — adds `'unsafe-eval'` to `script-src` so AJV's runtime
 * compile path works in the renderer. Must NEVER be used in packaged
 * builds; `cspForEnvironment` enforces this by checking `isPackaged`.
 *
 * Also adds the dev-server origin to `script-src` / `connect-src` so the
 * Angular CLI's HMR + websocket reload channel can run alongside the
 * file:// resources.
 */
export const DEV_CSP =
  "default-src 'self' file: http://localhost:* ws://localhost:*; " +
  "script-src 'self' 'unsafe-eval' file: http://localhost:*; " +
  "style-src 'self' 'unsafe-inline' http://localhost:*; " +
  "img-src 'self' data: blob: file: http://localhost:*; " +
  "connect-src 'self' file: http://localhost:* ws://localhost:*; " +
  "font-src 'self' file: http://localhost:*; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "base-uri 'none'";

/**
 * Pick the right CSP for the current environment. Packaged builds always
 * get the strict CSP; unpackaged builds (`nx serve desktop`) get the dev
 * variant so AJV's runtime compile works.
 */
export function cspForEnvironment(env: { isPackaged: boolean }): string {
  return env.isPackaged ? ELECTRON_CSP : DEV_CSP;
}
