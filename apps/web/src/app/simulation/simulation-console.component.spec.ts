import { TestBed } from '@angular/core/testing';

import { SimulationConsoleComponent } from './simulation-console.component';
import { SimulationConsoleService, type ConsoleLine } from './simulation-console.service';
import { SimulationUiService } from './simulation-ui.service';

function setup(execOut: ConsoleLine[] = [{ kind: 'out', text: 'ok' }]) {
  const consoleSvc = {
    execute: jest.fn(() => execOut),
    complete: jest.fn(() => ['fish']),
    commands: [],
  };
  TestBed.configureTestingModule({
    providers: [{ provide: SimulationConsoleService, useValue: consoleSvc }, SimulationUiService],
  });
  const ui = TestBed.inject(SimulationUiService);
  ui.consoleOpen.set(true);
  const fixture = TestBed.createComponent(SimulationConsoleComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, consoleSvc, ui };
}

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name });
}

describe('SimulationConsoleComponent', () => {
  it('renders the log + an input field', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.console__field')).not.toBeNull();
    expect(root.textContent).toContain('Aquascape simulation console');
  });

  it('submits a command on Enter and prints the echo + output', async () => {
    const { cmp, consoleSvc } = setup();
    cmp.input.set('help');
    cmp.onKey(key('Enter'));
    expect(consoleSvc.execute).toHaveBeenCalledWith('help');
    expect(cmp.input()).toBe('');
    // The echo prints synchronously; the (async) output appends a tick later.
    expect(cmp.lines().map((l) => l.text)).toContain('> help');
    await Promise.resolve();
    await Promise.resolve();
    expect(cmp.lines().map((l) => l.text)).toContain('ok');
  });

  it('clears the log on the "clear" command without calling execute', () => {
    const { cmp, consoleSvc } = setup();
    cmp.input.set('clear');
    cmp.onKey(key('Enter'));
    expect(consoleSvc.execute).not.toHaveBeenCalled();
    expect(cmp.lines()).toEqual([]);
  });

  it('Tab-completes a unique command name', () => {
    const { cmp, consoleSvc } = setup();
    cmp.input.set('f');
    cmp.onKey(key('Tab'));
    expect(consoleSvc.complete).toHaveBeenCalledWith('f');
    expect(cmp.input()).toBe('fish ');
  });

  it('recalls the previous command with ArrowUp', () => {
    const { cmp } = setup();
    cmp.input.set('help');
    cmp.onKey(key('Enter'));
    expect(cmp.input()).toBe('');
    cmp.onKey(key('ArrowUp'));
    expect(cmp.input()).toBe('help');
  });

  it('ignores a blank submit', () => {
    const { cmp, consoleSvc } = setup();
    cmp.input.set('   ');
    cmp.onKey(key('Enter'));
    expect(consoleSvc.execute).not.toHaveBeenCalled();
  });
});
