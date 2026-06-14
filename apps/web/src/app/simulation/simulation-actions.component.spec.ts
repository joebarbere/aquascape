import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { Scene } from '@aquascape/domain/scene-model';

import { SimulationActionService } from './simulation-action.service';
import { SimulationActionsComponent } from './simulation-actions.component';
import { WaterChangeService, type WaterChangeStepResult } from './water-change.service';
import { createShowcaseScene } from './showcase-scene';

interface WaterChangeCall {
  readonly step: 'out' | 'in';
  readonly scene: Scene | null;
  readonly replacement?: { ph: number };
}

describe('SimulationActionsComponent', () => {
  let fixture: ComponentFixture<SimulationActionsComponent>;
  let action: SimulationActionService;
  let wcCalls: WaterChangeCall[];

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }
  function all(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  beforeEach(async () => {
    wcCalls = [];
    const wcMock: Pick<WaterChangeService, 'siphonOut' | 'siphonIn' | 'clear'> = {
      siphonOut: (scene: Scene | null): WaterChangeStepResult | null => {
        wcCalls.push({ step: 'out', scene });
        return { fraction: 0.3, newLevelMm: 403, previousLevelMm: 575 };
      },
      siphonIn: (scene: Scene | null, replacement): WaterChangeStepResult | null => {
        wcCalls.push({ step: 'in', scene, replacement });
        return { fraction: 0.3, newLevelMm: 575, previousLevelMm: 403 };
      },
      clear: () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [SimulationActionsComponent],
      providers: [SimulationActionService, { provide: WaterChangeService, useValue: wcMock }],
    }).compileComponents();
    fixture = TestBed.createComponent(SimulationActionsComponent);
    action = TestBed.inject(SimulationActionService);
    fixture.detectChanges();
  });

  it('renders a labelled toolbar with one button per tool', () => {
    const toolbar = el('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute('aria-label')).toBe('Husbandry tools');
    const buttons = all('.actions__tool');
    expect(buttons.length).toBe(2);
    expect(buttons[0].getAttribute('aria-label')).toBe('Feed');
  });

  it('roving tabindex: only the focused button is tabbable', () => {
    const buttons = all('.actions__tool');
    expect(buttons[0].getAttribute('tabindex')).toBe('0');
    expect(buttons[1].getAttribute('tabindex')).toBe('-1');
  });

  it('clicking Feed enters the feeding tool + shows the food picker', () => {
    const feedBtn = all('.actions__tool')[0] as HTMLButtonElement;
    feedBtn.click();
    fixture.detectChanges();
    expect(action.tool()).toBe('feed');
    expect(feedBtn.getAttribute('aria-pressed')).toBe('true');
    const picker = el('[aria-label="Food types"]');
    expect(picker).not.toBeNull();
    expect(all('.actions__food').length).toBeGreaterThan(0);
  });

  it('picking a food arms the placing sub-step + shows the drop prompt', () => {
    (all('.actions__tool')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    const firstFood = all('.actions__food')[0] as HTMLButtonElement;
    firstFood.click();
    fixture.detectChanges();
    expect(action.feedPlacing()).toBe(true);
    expect(action.selectedFoodId()).not.toBeNull();
    expect(el('.actions__panel-title')?.textContent).toContain('Click the tank to drop');
    // The picker is replaced by the placing prompt.
    expect(el('[aria-label="Food types"]')).toBeNull();
  });

  it('re-clicking the active tool deselects it', () => {
    const feedBtn = all('.actions__tool')[0] as HTMLButtonElement;
    feedBtn.click();
    fixture.detectChanges();
    feedBtn.click();
    fixture.detectChanges();
    expect(action.tool()).toBeNull();
    expect(el('[aria-label="Feeding"]')).toBeNull();
  });

  it('ArrowRight moves roving focus to the next tool', () => {
    const toolbar = el('[role="toolbar"]') as HTMLElement;
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    const buttons = all('.actions__tool');
    expect(buttons[1].getAttribute('tabindex')).toBe('0');
    expect(buttons[0].getAttribute('tabindex')).toBe('-1');
  });

  // ── Water-change tool (F15.2) ──────────────────────────────────────────────

  describe('water-change tool', () => {
    function selectWaterChange(): void {
      (all('.actions__tool')[1] as HTMLButtonElement).click();
      fixture.detectChanges();
    }

    it('selecting the tool shows the replacement-params form', () => {
      selectWaterChange();
      expect(action.tool()).toBe('water-change');
      expect(action.subStep()).toBe('params');
      expect(el('[aria-label="Water change"]')).not.toBeNull();
      expect(el('input[aria-label="Replacement pH"]')).not.toBeNull();
    });

    it('editing a param updates the action service', () => {
      selectWaterChange();
      const phInput = el('input[aria-label="Replacement pH"]') as HTMLInputElement;
      phInput.value = '6.4';
      phInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(action.replacement().ph).toBeCloseTo(6.4);
    });

    it('confirming params advances to place-siphon (OUT disabled until placed)', () => {
      selectWaterChange();
      (el('.actions__primary') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(action.subStep()).toBe('place-siphon');
      const outBtn = el('.actions__primary') as HTMLButtonElement;
      expect(outBtn.disabled).toBe(true);
      action.markSiphonPlaced();
      fixture.detectChanges();
      expect((el('.actions__primary') as HTMLButtonElement).disabled).toBe(false);
    });

    it('OUT then IN drive the WaterChangeService + advance the siphon mode', () => {
      fixture.componentInstance.scene = createShowcaseScene();
      selectWaterChange();
      (el('.actions__primary') as HTMLButtonElement).click(); // confirm params
      action.markSiphonPlaced();
      fixture.detectChanges();

      (el('.actions__primary') as HTMLButtonElement).click(); // siphon out
      fixture.detectChanges();
      expect(action.subStep()).toBe('siphon-out');
      expect(action.siphonMode()).toBe('out');

      (el('.actions__primary') as HTMLButtonElement).click(); // siphon in
      fixture.detectChanges();
      expect(action.subStep()).toBe('siphon-in');
      expect(action.siphonMode()).toBe('in');

      expect(wcCalls.map((c) => c.step)).toEqual(['out', 'in']);
      expect(wcCalls[1].replacement?.ph).toBeCloseTo(action.replacement().ph);
    });
  });
});
