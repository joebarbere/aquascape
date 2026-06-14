import { TestBed } from '@angular/core/testing';

import { SimulationActionService } from './simulation-action.service';

describe('SimulationActionService', () => {
  let s: SimulationActionService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SimulationActionService] });
    s = TestBed.inject(SimulationActionService);
  });

  it('starts idle with no tool / sub-step', () => {
    expect(s.tool()).toBeNull();
    expect(s.phase()).toBe('idle');
    expect(s.subStep()).toBeNull();
    expect(s.active()).toBe(false);
  });

  it('selectTool enters tool-selected', () => {
    s.selectTool('feed');
    expect(s.tool()).toBe('feed');
    expect(s.phase()).toBe('tool-selected');
    expect(s.subStep()).toBeNull();
    expect(s.active()).toBe(true);
  });

  it('re-selecting the active tool deselects it (idle)', () => {
    s.selectTool('feed');
    s.selectTool('feed');
    expect(s.tool()).toBeNull();
    expect(s.phase()).toBe('idle');
  });

  it('selecting a different tool swaps without going through idle', () => {
    s.selectTool('feed');
    s.selectTool('water-change');
    expect(s.tool()).toBe('water-change');
    // The water-change tool opens straight into its first flow sub-step (params).
    expect(s.phase()).toBe('sub-step');
    expect(s.subStep()).toBe('params');
  });

  it('beginSubStep advances to sub-step phase', () => {
    s.selectTool('feed');
    s.beginSubStep('placing');
    expect(s.phase()).toBe('sub-step');
    expect(s.subStep()).toBe('placing');
    expect(s.feedPlacing()).toBe(true);
  });

  it('beginSubStep is a no-op when idle', () => {
    s.beginSubStep('placing');
    expect(s.phase()).toBe('idle');
    expect(s.subStep()).toBeNull();
  });

  it('feedPlacing is false for a non-feed tool in a sub-step', () => {
    s.selectTool('water-change');
    s.beginSubStep('place-siphon');
    expect(s.feedPlacing()).toBe(false);
  });

  it('backToToolStart returns to tool-selected, keeping the tool', () => {
    s.selectTool('feed');
    s.beginSubStep('placing');
    s.backToToolStart();
    expect(s.tool()).toBe('feed');
    expect(s.phase()).toBe('tool-selected');
    expect(s.subStep()).toBeNull();
  });

  it('backToToolStart is a no-op when idle', () => {
    s.backToToolStart();
    expect(s.phase()).toBe('idle');
  });

  it('pickFood arms the placing sub-step + stores the id', () => {
    s.selectTool('feed');
    s.pickFood('food.tetra.flakes');
    expect(s.selectedFoodId()).toBe('food.tetra.flakes');
    expect(s.phase()).toBe('sub-step');
    expect(s.subStep()).toBe('placing');
    expect(s.feedPlacing()).toBe(true);
  });

  it('pickFood null returns to the picker, clearing the id', () => {
    s.selectTool('feed');
    s.pickFood('food.tetra.flakes');
    s.pickFood(null);
    expect(s.selectedFoodId()).toBeNull();
    expect(s.phase()).toBe('tool-selected');
    expect(s.feedPlacing()).toBe(false);
  });

  it('pickFood is a no-op unless feed is the active tool', () => {
    s.selectTool('water-change');
    s.pickFood('food.tetra.flakes');
    expect(s.selectedFoodId()).toBeNull();
  });

  it('selecting a different tool clears the food selection', () => {
    s.selectTool('feed');
    s.pickFood('food.tetra.flakes');
    s.selectTool('water-change');
    expect(s.selectedFoodId()).toBeNull();
  });

  it('reset returns to idle from any state', () => {
    s.selectTool('feed');
    s.pickFood('food.tetra.flakes');
    s.reset();
    expect(s.tool()).toBeNull();
    expect(s.phase()).toBe('idle');
    expect(s.subStep()).toBeNull();
    expect(s.selectedFoodId()).toBeNull();
    expect(s.active()).toBe(false);
  });

  // ── Water-change flow (F15.2) ──────────────────────────────────────────────

  describe('water-change flow', () => {
    it('selecting the tool opens straight into the params sub-step (no nozzle yet)', () => {
      s.selectTool('water-change');
      expect(s.subStep()).toBe('params');
      expect(s.phase()).toBe('sub-step');
      expect(s.siphonActive()).toBe(false);
      expect(s.siphonMode()).toBe('idle');
    });

    it('walks params → place-siphon → siphon-out → siphon-in', () => {
      s.selectTool('water-change');
      s.confirmReplacement();
      expect(s.subStep()).toBe('place-siphon');
      expect(s.siphonActive()).toBe(true);
      expect(s.siphonPlaced()).toBe(false);

      s.markSiphonPlaced();
      expect(s.siphonPlaced()).toBe(true);

      s.siphonOut();
      expect(s.subStep()).toBe('siphon-out');
      expect(s.siphonMode()).toBe('out');
      expect(s.siphonActive()).toBe(true);

      s.siphonIn();
      expect(s.subStep()).toBe('siphon-in');
      expect(s.siphonMode()).toBe('in');
      expect(s.siphonActive()).toBe(true);
    });

    it('confirmReplacement only fires from the params sub-step', () => {
      s.selectTool('water-change');
      s.confirmReplacement();
      s.confirmReplacement(); // already past params — no-op
      expect(s.subStep()).toBe('place-siphon');
    });

    it('siphonOut requires the place-siphon (or post-in) sub-step', () => {
      s.selectTool('water-change');
      s.siphonOut(); // still in params — no-op
      expect(s.subStep()).toBe('params');
    });

    it('siphonIn requires a prior OUT', () => {
      s.selectTool('water-change');
      s.confirmReplacement();
      s.siphonIn(); // no OUT yet — no-op
      expect(s.subStep()).toBe('place-siphon');
    });

    it('can OUT again after an IN (multi-pass change)', () => {
      s.selectTool('water-change');
      s.confirmReplacement();
      s.siphonOut();
      s.siphonIn();
      s.siphonOut();
      expect(s.subStep()).toBe('siphon-out');
    });

    it('stores replacement params from the form', () => {
      s.selectTool('water-change');
      s.setReplacement({ temperatureC: 21, ph: 6.5, hardnessDgh: 3 });
      expect(s.replacement()).toEqual({ temperatureC: 21, ph: 6.5, hardnessDgh: 3 });
    });

    it('reset clears the flow + siphon state', () => {
      s.selectTool('water-change');
      s.confirmReplacement();
      s.markSiphonPlaced();
      s.siphonOut();
      s.reset();
      expect(s.tool()).toBeNull();
      expect(s.siphonActive()).toBe(false);
      expect(s.siphonMode()).toBe('idle');
      expect(s.siphonPlaced()).toBe(false);
    });

    it('siphonMode/siphonActive are idle/false for the feed tool', () => {
      s.selectTool('feed');
      expect(s.siphonActive()).toBe(false);
      expect(s.siphonMode()).toBe('idle');
    });
  });
});
