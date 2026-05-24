// Content-Security-Policy header for the Electron renderer. F0.6 / plan §3.
//
// The web app already ships a baseline CSP via a <meta http-equiv> tag in
// `apps/web/src/index.html`. Electron loads the same bundle off `file://` so
// we need to compose with the baseline to additionally allow `file:`
// origins for self-served scripts / styles / images / connect / fonts.
//
// Non-negotiables (must hold in production builds):
//   * No `'unsafe-eval'` — anywhere. We never want eval in the renderer.
//   * No `'unsafe-inline'` in `script-src` — only Angular-emitted style
//     elements get an inline exemption (this matches the web baseline).
//   * `object-src 'none'` and `frame-src 'none'` — no embedded plugins or
//     frames.
//   * `base-uri 'none'` — no `<base>` overrides that could change URL
//     resolution for relative paths.
//
// Stored as a single string constant so the test can assert it byte-for-byte;
// future changes will be deliberate, not silent.

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
