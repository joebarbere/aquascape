// The Electron CSP is a security-relevant constant — any change must be
// deliberate. This test pins the exact string so silent drift fails CI.

import { ELECTRON_CSP } from './csp';

describe('ELECTRON_CSP', () => {
  it('matches the documented policy exactly', () => {
    expect(ELECTRON_CSP).toBe(
      "default-src 'self' file:; " +
        "script-src 'self' file:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: file:; " +
        "connect-src 'self' file:; " +
        "font-src 'self' file:; " +
        "object-src 'none'; " +
        "frame-src 'none'; " +
        "base-uri 'none'",
    );
  });

  it('forbids unsafe-eval anywhere', () => {
    expect(ELECTRON_CSP).not.toContain("'unsafe-eval'");
  });

  it('does not allow unsafe-inline in script-src', () => {
    // The full string includes `'unsafe-inline'` inside style-src only.
    // Assert the script-src directive does not include it.
    const match = /script-src ([^;]+);/.exec(ELECTRON_CSP);
    expect(match).not.toBeNull();
    if (match === null) throw new Error('unreachable');
    expect(match[1]).not.toContain("'unsafe-inline'");
  });

  it('locks object-src and frame-src to none', () => {
    expect(ELECTRON_CSP).toContain("object-src 'none'");
    expect(ELECTRON_CSP).toContain("frame-src 'none'");
  });

  it('locks base-uri to none', () => {
    expect(ELECTRON_CSP).toContain("base-uri 'none'");
  });
});
