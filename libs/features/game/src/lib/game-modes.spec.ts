import { GAME_MODES, describeGameMode, isGameMode } from './game-modes';

describe('game-modes', () => {
  it('lists the four sub-modes', () => {
    expect(GAME_MODES).toEqual(['survival', 'feeding', 'predator', 'cleaner']);
  });

  it('isGameMode recognises the allowlist + rejects others', () => {
    for (const m of GAME_MODES) expect(isGameMode(m)).toBe(true);
    expect(isGameMode('racing')).toBe(false);
    expect(isGameMode('')).toBe(false);
  });

  it('describeGameMode returns a populated descriptor for each mode', () => {
    for (const m of GAME_MODES) {
      const d = describeGameMode(m);
      expect(d.mode).toBe(m);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.objective.length).toBeGreaterThan(0);
      expect(d.playerSpeedMmPerSec).toBeGreaterThan(0);
    }
  });
});
