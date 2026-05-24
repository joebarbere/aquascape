// The Electron CSP is a security-relevant constant — any change must be
// deliberate. These tests pin the exact strings so silent drift fails CI.

import { cspForEnvironment, DEV_CSP, ELECTRON_CSP } from './csp';

describe('ELECTRON_CSP (production / packaged)', () => {
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

  it('forbids unsafe-eval', () => {
    expect(ELECTRON_CSP).not.toContain("'unsafe-eval'");
  });

  it('does not allow unsafe-inline in script-src', () => {
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

describe('DEV_CSP (unpackaged / `nx serve desktop`)', () => {
  it('matches the documented dev policy exactly', () => {
    expect(DEV_CSP).toBe(
      "default-src 'self' file: http://localhost:* ws://localhost:*; " +
        "script-src 'self' file: http://localhost:*; " +
        "style-src 'self' 'unsafe-inline' http://localhost:*; " +
        "img-src 'self' data: blob: file: http://localhost:*; " +
        "connect-src 'self' file: http://localhost:* ws://localhost:*; " +
        "font-src 'self' file: http://localhost:*; " +
        "object-src 'none'; " +
        "frame-src 'none'; " +
        "base-uri 'none'",
    );
  });

  it('STILL forbids unsafe-eval — AJV is precompiled, so we never need it', () => {
    expect(DEV_CSP).not.toContain("'unsafe-eval'");
  });

  it('still locks object-src, frame-src, and base-uri to none', () => {
    expect(DEV_CSP).toContain("object-src 'none'");
    expect(DEV_CSP).toContain("frame-src 'none'");
    expect(DEV_CSP).toContain("base-uri 'none'");
  });

  it('relaxes script-src to allow the Angular dev server, but ONLY localhost', () => {
    const match = /script-src ([^;]+);/.exec(DEV_CSP);
    expect(match).not.toBeNull();
    if (match === null) throw new Error('unreachable');
    expect(match[1]).toContain('http://localhost:*');
    expect(match[1]).not.toContain("'unsafe-eval'");
  });
});

describe('cspForEnvironment', () => {
  it('returns the strict ELECTRON_CSP when packaged', () => {
    expect(cspForEnvironment({ isPackaged: true })).toBe(ELECTRON_CSP);
  });

  it('returns the localhost-relaxed DEV_CSP when not packaged', () => {
    expect(cspForEnvironment({ isPackaged: false })).toBe(DEV_CSP);
  });
});
