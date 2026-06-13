import { TestBed } from '@angular/core/testing';

import { GameModeService } from './game-mode.service';
import { NEUTRAL_INTENT } from './input-intent';

describe('GameModeService', () => {
  let svc: GameModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [GameModeService] });
    svc = TestBed.inject(GameModeService);
  });

  it('starts with no mode and at the objective state', () => {
    expect(svc.mode()).toBeNull();
    expect(svc.state()).toBe('objective');
    expect(svc.objective()).toBe('');
  });

  it('startGame sets the mode + descriptor + objective and resets the run', () => {
    svc.award(50);
    svc.startGame('survival');
    expect(svc.mode()).toBe('survival');
    expect(svc.descriptor()?.title).toBe('Survival');
    expect(svc.objective()).toContain('Stay alive');
    expect(svc.state()).toBe('objective');
    // Score reset by startGame.
    expect(svc.score().points).toBe(0);
  });

  it('dispatch drives the state machine', () => {
    svc.startGame('feeding');
    expect(svc.dispatch({ type: 'start' })).toBe('playing');
    expect(svc.state()).toBe('playing');
    expect(svc.isLive()).toBe(true);
  });

  it('playerVelocity is zero unless the run is live', () => {
    svc.startGame('predator');
    svc.setIntent({ ...NEUTRAL_INTENT, move: { x: 1, y: 0, z: 0 } });
    // Still in objective state → frozen.
    expect(svc.playerVelocity()).toEqual({ x: 0, y: 0, z: 0 });
    svc.dispatch({ type: 'start' });
    // Now live → predator speed (260) along +x.
    expect(svc.playerVelocity()).toEqual({ x: 260, y: 0, z: 0 });
  });

  it('pausing freezes the player velocity', () => {
    svc.startGame('survival');
    svc.dispatch({ type: 'start' });
    svc.setIntent({ ...NEUTRAL_INTENT, move: { x: 1, y: 0, z: 0 } });
    expect(svc.playerVelocity().x).toBeGreaterThan(0);
    svc.dispatch({ type: 'pause' });
    expect(svc.playerVelocity()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('award clamps the score at zero', () => {
    svc.startGame('cleaner');
    svc.award(10);
    svc.award(-100);
    expect(svc.score().points).toBe(0);
  });

  it('tick only advances elapsed time while live', () => {
    svc.startGame('feeding');
    svc.tick(1); // objective state — ignored
    expect(svc.score().elapsedSec).toBe(0);
    svc.dispatch({ type: 'start' });
    svc.tick(2);
    expect(svc.score().elapsedSec).toBe(2);
    svc.dispatch({ type: 'pause' });
    svc.tick(5); // paused — ignored
    expect(svc.score().elapsedSec).toBe(2);
  });

  it('exposes a placeholder vitality flagged as not-real', () => {
    svc.startGame('survival');
    expect(svc.vitality().isPlaceholder).toBe(true);
    svc.setVitalityPlaceholder(1.5, -0.2);
    expect(svc.vitality().health).toBe(1); // clamped
    expect(svc.vitality().food).toBe(0); // clamped
    expect(svc.vitality().isPlaceholder).toBe(true);
  });
});
