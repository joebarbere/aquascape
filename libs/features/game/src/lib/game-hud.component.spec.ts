import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GameHudComponent } from './game-hud.component';
import { GameModeService } from './game-mode.service';

describe('GameHudComponent', () => {
  let fixture: ComponentFixture<GameHudComponent>;
  let svc: GameModeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameHudComponent],
      providers: [GameModeService],
    }).compileComponents();
    svc = TestBed.inject(GameModeService);
    fixture = TestBed.createComponent(GameHudComponent);
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('renders the objective + title for the active mode', () => {
    svc.startGame('survival');
    fixture.detectChanges();
    expect(text()).toContain('Survival');
    expect(text()).toContain('Stay alive');
  });

  it('shows the objective briefing with a Start button at first', () => {
    svc.startGame('feeding');
    fixture.detectChanges();
    const start = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button',
    );
    expect(start?.textContent?.trim()).toBe('Start');
  });

  it('clicking Start moves the run into playing (keyboard-accessible <button>)', () => {
    svc.startGame('feeding');
    fixture.detectChanges();
    const start = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button',
    );
    // Native <button> → tagName confirms keyboard/Enter/Space activation works.
    expect(start?.tagName).toBe('BUTTON');
    expect(start?.getAttribute('type')).toBe('button');
    start?.click();
    fixture.detectChanges();
    expect(svc.state()).toBe('playing');
  });

  it('exposes vitality meters as ARIA progressbars with a placeholder marker', () => {
    svc.startGame('survival');
    fixture.detectChanges();
    const meters = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="progressbar"]',
    );
    expect(meters.length).toBe(2);
    expect(meters[0]?.getAttribute('aria-valuenow')).toBe('100'); // health stub = full
    expect(meters[1]?.getAttribute('aria-valuenow')).toBe('50'); // food stub = mid
    expect(text().toLowerCase()).toContain('preview'); // placeholder badge
  });

  it('the objective briefing is a labelled modal dialog', () => {
    svc.startGame('predator');
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Objective briefing');
  });

  it('shows the pause dialog with resume / restart / quit', () => {
    svc.startGame('survival');
    svc.dispatch({ type: 'start' });
    svc.dispatch({ type: 'pause' });
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Paused');
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Resume', 'Restart', 'Quit']));
  });

  it('shows the win screen + final score then the results screen', () => {
    svc.startGame('feeding');
    svc.dispatch({ type: 'start' });
    svc.award(30);
    svc.dispatch({ type: 'win' });
    fixture.detectChanges();
    expect(text()).toContain('You win!');
    expect(text()).toContain('Final score: 30');

    svc.dispatch({ type: 'showResults' });
    fixture.detectChanges();
    expect(text()).toContain('Results');
  });

  it('renders the score in the top strip', () => {
    svc.startGame('cleaner');
    svc.award(7);
    fixture.detectChanges();
    expect(text()).toContain('7');
  });

  function clickButtonLabelled(label: string): void {
    const btn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === label);
    expect(btn).toBeTruthy();
    btn?.click();
    fixture.detectChanges();
  }

  it('pause dialog buttons drive resume / restart', () => {
    svc.startGame('survival');
    svc.dispatch({ type: 'start' });
    svc.dispatch({ type: 'pause' });
    fixture.detectChanges();
    clickButtonLabelled('Resume');
    expect(svc.state()).toBe('playing');

    svc.dispatch({ type: 'pause' });
    fixture.detectChanges();
    clickButtonLabelled('Restart');
    expect(svc.state()).toBe('objective');
  });

  it('results dialog Play again restarts back to the objective', () => {
    svc.startGame('feeding');
    svc.dispatch({ type: 'start' });
    svc.dispatch({ type: 'lose' });
    svc.dispatch({ type: 'showResults' });
    fixture.detectChanges();
    clickButtonLabelled('Play again');
    expect(svc.state()).toBe('objective');
  });

  it('Quit dispatches a quit event (host-handled — state is unchanged)', () => {
    svc.startGame('survival');
    svc.dispatch({ type: 'start' });
    svc.dispatch({ type: 'lose' });
    svc.dispatch({ type: 'showResults' });
    fixture.detectChanges();
    // quit is a no-op on FSM state; assert it doesn't throw + leaves results.
    clickButtonLabelled('Quit');
    expect(svc.state()).toBe('results');
  });
});
