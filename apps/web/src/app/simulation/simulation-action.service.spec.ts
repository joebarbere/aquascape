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
    expect(s.phase()).toBe('tool-selected');
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
});
