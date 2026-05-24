// Security regression guard for the BrowserWindow webPreferences. Plan §3 —
// every flag below is non-negotiable. If any field is changed without
// updating this test, the test fails and forces a deliberate review.

import { buildWebPreferences } from './web-preferences';

describe('buildWebPreferences', () => {
  it('produces the non-negotiable secure webPreferences', () => {
    const result = buildWebPreferences('/abs/path/to/preload.js');

    expect(result).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      preload: '/abs/path/to/preload.js',
    });
  });

  it('contextIsolation is on', () => {
    expect(buildWebPreferences('p').contextIsolation).toBe(true);
  });

  it('sandbox is on', () => {
    expect(buildWebPreferences('p').sandbox).toBe(true);
  });

  it('nodeIntegration is off', () => {
    expect(buildWebPreferences('p').nodeIntegration).toBe(false);
  });

  it('nodeIntegrationInWorker is off', () => {
    expect(buildWebPreferences('p').nodeIntegrationInWorker).toBe(false);
  });

  it('nodeIntegrationInSubFrames is off', () => {
    expect(buildWebPreferences('p').nodeIntegrationInSubFrames).toBe(false);
  });

  it('webSecurity is on', () => {
    expect(buildWebPreferences('p').webSecurity).toBe(true);
  });

  it('does not include any "enableRemoteModule" / "remote" key (the remote module is removed)', () => {
    const result = buildWebPreferences('p') as Record<string, unknown>;
    expect('enableRemoteModule' in result).toBe(false);
    expect('remote' in result).toBe(false);
  });

  it('passes the preload path through verbatim', () => {
    expect(buildWebPreferences('/var/app/preload.js').preload).toBe('/var/app/preload.js');
  });
});
