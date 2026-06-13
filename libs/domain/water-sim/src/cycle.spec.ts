import { cycleProgress, SAFE_NITROGEN_MG_L } from './cycle';
import { freshWaterState, type WaterState } from './chemistry';

function state(overrides: Partial<WaterState>): WaterState {
  return freshWaterState(overrides);
}

describe('cycleProgress', () => {
  it('a brand-new tank with nothing in it is uncycled', () => {
    expect(cycleProgress(state({}))).toBe('uncycled');
  });

  it('elevated ammonia with no colony reads as cycling (the spike)', () => {
    expect(cycleProgress(state({ ammonia: 2 }))).toBe('cycling');
  });

  it('elevated nitrite mid-establishment reads as cycling', () => {
    expect(cycleProgress(state({ nitrite: 1.5, aobColony: 2, nobColony: 0.2 }))).toBe('cycling');
  });

  it('established colonies with safe ammonia + nitrite read as cycled', () => {
    expect(
      cycleProgress(state({ ammonia: 0, nitrite: 0, aobColony: 3, nobColony: 3, nitrate: 40 })),
    ).toBe('cycled');
  });

  it('high nitrate does NOT prevent cycled (nitrate is the water-change signal)', () => {
    expect(
      cycleProgress(state({ ammonia: 0.1, nitrite: 0.1, aobColony: 4, nobColony: 4, nitrate: 160 })),
    ).toBe('cycled');
  });

  it('colonies present but ammonia still high → still cycling, not cycled', () => {
    expect(cycleProgress(state({ ammonia: 1, aobColony: 4, nobColony: 4 }))).toBe('cycling');
  });

  it('ammonia exactly at the safe threshold counts as safe', () => {
    expect(
      cycleProgress(
        state({ ammonia: SAFE_NITROGEN_MG_L, nitrite: 0, aobColony: 2, nobColony: 2 }),
      ),
    ).toBe('cycled');
  });

  it('AOB established but NOB not yet → cycling (nitrite stage incomplete)', () => {
    expect(cycleProgress(state({ ammonia: 0, nitrite: 0, aobColony: 3, nobColony: 0 }))).toBe(
      'cycling',
    );
  });

  it('defends against NaN/negative fields', () => {
    const bad = {
      ammonia: NaN,
      nitrite: -1,
      nitrate: NaN,
      ph: NaN,
      aobColony: NaN,
      nobColony: -2,
      ageWeeks: NaN,
      engineVersion: 1,
    } as WaterState;
    expect(cycleProgress(bad)).toBe('uncycled');
  });
});
