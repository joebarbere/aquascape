import { TestBed } from '@angular/core/testing';

import { SimulationUiService } from './simulation-ui.service';

describe('SimulationUiService', () => {
  let s: SimulationUiService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SimulationUiService] });
    s = TestBed.inject(SimulationUiService);
  });

  it('defaults to everything visible + console closed', () => {
    expect([s.infoVisible(), s.controlsVisible(), s.clockVisible(), s.perfVisible()]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(s.consoleOpen()).toBe(false);
  });

  it('toggleConsole flips the console flag', () => {
    s.toggleConsole();
    expect(s.consoleOpen()).toBe(true);
    s.toggleConsole();
    expect(s.consoleOpen()).toBe(false);
  });

  it('setHud hides a single target', () => {
    s.setHud('info', false);
    expect(s.infoVisible()).toBe(false);
    expect(s.controlsVisible()).toBe(true);
  });

  it('setHud all sets every target', () => {
    s.setHud('all', false);
    expect([s.infoVisible(), s.controlsVisible(), s.clockVisible(), s.perfVisible()]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('toggleHud flips a single target', () => {
    s.toggleHud('clock');
    expect(s.clockVisible()).toBe(false);
    s.toggleHud('clock');
    expect(s.clockVisible()).toBe(true);
  });

  it('toggleHud all hides when anything is visible, then shows', () => {
    s.toggleHud('all');
    expect(s.infoVisible()).toBe(false);
    s.toggleHud('all');
    expect(s.infoVisible()).toBe(true);
  });

  it('resetLayout restores defaults', () => {
    s.setHud('all', false);
    s.toggleConsole();
    s.resetLayout();
    expect(s.infoVisible()).toBe(true);
    expect(s.consoleOpen()).toBe(false);
  });
});
