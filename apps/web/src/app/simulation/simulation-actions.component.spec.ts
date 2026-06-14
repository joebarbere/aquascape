import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SimulationActionService } from './simulation-action.service';
import { SimulationActionsComponent } from './simulation-actions.component';

describe('SimulationActionsComponent', () => {
  let fixture: ComponentFixture<SimulationActionsComponent>;
  let action: SimulationActionService;

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }
  function all(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimulationActionsComponent],
      providers: [SimulationActionService],
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
});
