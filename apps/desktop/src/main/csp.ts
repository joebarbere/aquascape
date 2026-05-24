// Content-Security-Policy header for the Electron renderer. F0.6 / plan §3.
//
// The CSP is set EXCLUSIVELY here, as an HTTP response header. The web
// app's `index.html` deliberately does NOT include a `<meta http-equiv>`
// CSP tag — browsers AND multiple CSP sources (taking the most restrictive
// directive of each), so a stricter meta tag would silently override the
// header below. The production web deploy must set its own CSP via server
// response headers.
//
// Non-negotiables (must hold in every build, dev and packaged):
//   * No `'unsafe-eval'` — anywhere. AJV's runtime `new Function(…)` path
//     is sidestepped by precompiling each schema at build time via
//     `tools/precompile-validators.mjs` (Stage 4 follow-up shipped); the
//     emitted standalone code is plain JS that the CSP allows.
//   * No `'unsafe-inline'` in `script-src` — only Angular-emitted style
//     elements get an inline exemption (matches the legacy meta baseline).
//   * `object-src 'none'` and `frame-src 'none'` — no embedded plugins or
//     frames.
//   * `base-uri 'none'` — no `<base>` overrides that could change URL
//     resolution for relative paths.
//
// The unpackaged dev shell additionally needs to talk to the Angular dev
// server (`http://localhost:*` + `ws://localhost:*` for HMR). Packaged
// builds load from `file://` and don't need those origins.

const STRICT_DIRECTIVES = {
  default: "'self' file:",
  script: "'self' file:",
  style: "'self' 'unsafe-inline'",
  img: "'self' data: blob: file:",
  connect: "'self' file:",
  font: "'self' file:",
};

const DEV_EXTRA_ORIGINS = {
  default: ' http://localhost:* ws://localhost:*',
  script: ' http://localhost:*',
  style: ' http://localhost:*',
  img: ' http://localhost:*',
  connect: ' http://localhost:* ws://localhost:*',
  font: ' http://localhost:*',
};

function buildPolicy(allowDevOrigins: boolean): string {
  const extra = allowDevOrigins ? DEV_EXTRA_ORIGINS : { default: '', script: '', style: '', img: '', connect: '', font: '' };
  return [
    `default-src ${STRICT_DIRECTIVES.default}${extra.default}`,
    `script-src ${STRICT_DIRECTIVES.script}${extra.script}`,
    `style-src ${STRICT_DIRECTIVES.style}${extra.style}`,
    `img-src ${STRICT_DIRECTIVES.img}${extra.img}`,
    `connect-src ${STRICT_DIRECTIVES.connect}${extra.connect}`,
    `font-src ${STRICT_DIRECTIVES.font}${extra.font}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Strict CSP used in packaged builds. No `'unsafe-eval'`, no localhost. */
export const ELECTRON_CSP = buildPolicy(false);

/**
 * Dev CSP — same as `ELECTRON_CSP` but with `http://localhost:*` /
 * `ws://localhost:*` origins added so the renderer can talk to the
 * Angular dev server. Still no `'unsafe-eval'`: AJV precompile means we
 * don't need it.
 */
export const DEV_CSP = buildPolicy(true);

/**
 * Pick the CSP for the current Electron environment. Packaged builds get
 * the strict policy; unpackaged dev builds get the localhost-relaxed
 * variant. Both are equally strict on `script-src`.
 */
export function cspForEnvironment(env: { isPackaged: boolean }): string {
  return env.isPackaged ? ELECTRON_CSP : DEV_CSP;
}
