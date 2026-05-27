// DayNightControlComponent tests. Stage 11 F11.7 Wave 5.
//
// Verifies the slider + mode radiogroup wire through to the
// DayNightService singleton, the phase label snaps to the four named
// keypoints + falls back to HH:MM otherwise, and the per-panel collapse
// flag persists.

import { TestBed } from '@angular/core/testing';

import type { StorageService } from '@aquascape/platform/platform-api';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';

import {
  DAY_NIGHT_CONTROL_COLLAPSED_KEY,
  DayNightControlComponent,
  formatPhase,
} from './day-night-control.component';
import { DayNightService } from './day-night.service';

class FakeStorageService implements StorageService {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.data.get(key) as T | undefined) ?? null);
  }
  set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function configure(storage: FakeStorageService = new FakeStorageService()) {
  TestBed.configureTestingModule({
    imports: [DayNightControlComponent],
    providers: [{ provide: STORAGE_SERVICE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(DayNightControlComponent);
  fixture.detectChanges();
  const service = TestBed.inject(DayNightService);
  return { fixture, service, storage };
}

function rangeInput(fixture: ReturnType<typeof configure>['fixture']): HTMLInputElement {
  const el = fixture.nativeElement.querySelector(
    'input[type="range"]',
  ) as HTMLInputElement | null;
  if (el === null) throw new Error('range input not found');
  return el;
}

function modeButton(
  fixture: ReturnType<typeof configure>['fixture'],
  label: string,
): HTMLButtonElement {
  const buttons = fixture.nativeElement.querySelectorAll(
    '.day-night-control__mode',
  ) as NodeListOf<HTMLButtonElement>;
  for (const b of buttons) {
    if (b.textContent?.trim() === label) return b;
  }
  throw new Error(`mode button "${label}" not found`);
}

describe('DayNightControlComponent — rendering + bindings', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the phase slider and the three mode radio buttons', () => {
    const { fixture } = configure();
    const slider = rangeInput(fixture);
    expect(slider).toBeDefined();
    expect(slider.type).toBe('range');
    // Slider has min/max/step that match the [0, 1) phase domain.
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.step).toBe('0.01');

    const buttons = fixture.nativeElement.querySelectorAll(
      '.day-night-control__mode',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(3);
    expect(buttons[0]?.textContent?.trim()).toBe('Manual');
    expect(buttons[1]?.textContent?.trim()).toBe('Real-time');
    expect(buttons[2]?.textContent?.trim()).toBe('Equipment');
    // Each mode button has role=radio and aria-checked.
    for (const b of buttons) {
      expect(b.getAttribute('role')).toBe('radio');
      expect(b.hasAttribute('aria-checked')).toBe(true);
    }
  });

  it('slider initial value matches service.phase() (0.5 noon by default)', () => {
    const { fixture, service } = configure();
    expect(service.phase()).toBe(0.5);
    const slider = rangeInput(fixture);
    // Some browsers normalise to "0.5" string; tolerate both Number forms.
    expect(Number(slider.value)).toBeCloseTo(0.5, 5);
  });

  it('moving the slider calls service.setPhase(value)', () => {
    const { fixture, service } = configure();
    const slider = rangeInput(fixture);
    slider.value = '0.25';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(service.phase()).toBeCloseTo(0.25, 10);
  });

  it('moving the slider to 0 sets phase to 0 (midnight)', () => {
    const { fixture, service } = configure();
    const slider = rangeInput(fixture);
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(service.phase()).toBe(0);
  });

  it('ignores a non-finite slider value (defensive — covers a synthetic NaN event)', () => {
    const { fixture, service } = configure();
    service.setPhase(0.3);
    // Fire an Event whose target.value is NaN-equivalent. We construct
    // the event target manually because `<input type=range>` coerces a
    // string value to a number in the [min, max] range — there's no way
    // to set its `.value` to a non-finite literal through the DOM API.
    // The component reads `(event.target as HTMLInputElement).value`,
    // so a stub with a non-numeric value flows through the same branch.
    const event = {
      target: { value: 'NaN' } as unknown as HTMLInputElement,
    } as unknown as Event;
    fixture.componentInstance.onPhaseInput(event);
    fixture.detectChanges();
    expect(service.phase()).toBeCloseTo(0.3, 10);
  });

  it('clicking a mode button calls service.setMode(value)', () => {
    const { fixture, service } = configure();
    modeButton(fixture, 'Real-time').click();
    fixture.detectChanges();
    expect(service.mode()).toBe('real-time');

    modeButton(fixture, 'Equipment').click();
    fixture.detectChanges();
    expect(service.mode()).toBe('equipment');

    modeButton(fixture, 'Manual').click();
    fixture.detectChanges();
    expect(service.mode()).toBe('manual');
  });

  it('active mode button reflects aria-checked=true; others false', () => {
    const { fixture, service } = configure();
    service.setMode('real-time');
    fixture.detectChanges();
    expect(modeButton(fixture, 'Manual').getAttribute('aria-checked')).toBe('false');
    expect(modeButton(fixture, 'Real-time').getAttribute('aria-checked')).toBe('true');
    expect(modeButton(fixture, 'Equipment').getAttribute('aria-checked')).toBe('false');
  });
});

describe('DayNightControlComponent — phase label', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows "noon" at phase 0.5', () => {
    const { fixture, service } = configure();
    service.setPhase(0.5);
    fixture.detectChanges();
    const readout = fixture.nativeElement.querySelector(
      '.day-night-control__readout',
    ) as HTMLElement | null;
    expect(readout?.textContent?.trim()).toBe('noon');
  });

  it('shows "midnight" at phase 0', () => {
    const { fixture, service } = configure();
    service.setPhase(0);
    fixture.detectChanges();
    const readout = fixture.nativeElement.querySelector(
      '.day-night-control__readout',
    ) as HTMLElement | null;
    expect(readout?.textContent?.trim()).toBe('midnight');
  });

  it('shows "dawn" at phase 0.25', () => {
    const { fixture, service } = configure();
    service.setPhase(0.25);
    fixture.detectChanges();
    const readout = fixture.nativeElement.querySelector(
      '.day-night-control__readout',
    ) as HTMLElement | null;
    expect(readout?.textContent?.trim()).toBe('dawn');
  });

  it('shows "dusk" at phase 0.75', () => {
    const { fixture, service } = configure();
    service.setPhase(0.75);
    fixture.detectChanges();
    const readout = fixture.nativeElement.querySelector(
      '.day-night-control__readout',
    ) as HTMLElement | null;
    expect(readout?.textContent?.trim()).toBe('dusk');
  });

  it('shows "15:00" at phase 0.625 (mid-afternoon, not near a keypoint)', () => {
    const { fixture, service } = configure();
    service.setPhase(0.625);
    fixture.detectChanges();
    const readout = fixture.nativeElement.querySelector(
      '.day-night-control__readout',
    ) as HTMLElement | null;
    expect(readout?.textContent?.trim()).toBe('15:00');
  });

  it('formatPhase covers all four named keypoints exactly', () => {
    expect(formatPhase(0)).toBe('midnight');
    expect(formatPhase(0.25)).toBe('dawn');
    expect(formatPhase(0.5)).toBe('noon');
    expect(formatPhase(0.75)).toBe('dusk');
  });

  it('formatPhase returns HH:MM for off-keypoint values', () => {
    // 0.625 → 0.625 * 24 = 15.0h → 15:00.
    expect(formatPhase(0.625)).toBe('15:00');
    // 0.375 → 0.375 * 24 = 9.0h → 09:00.
    expect(formatPhase(0.375)).toBe('09:00');
    // 0.1 → 2.4h → round(144 min) → 02:24.
    expect(formatPhase(0.1)).toBe('02:24');
  });
});

describe('DayNightControlComponent — collapsible header', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the header as a button with aria-expanded=true by default', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('day-night-body');
  });

  it('clicking the header toggles the collapsed signal and hides the body', () => {
    const { fixture } = configure();
    const toggle = fixture.nativeElement.querySelector(
      '.panel-header__toggle',
    ) as HTMLButtonElement;
    const body = fixture.nativeElement.querySelector('#day-night-body') as HTMLElement;
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(body.hidden).toBe(false);
    toggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect(body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('persists collapsed state to StorageService on toggle', async () => {
    const { fixture, storage } = configure();
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    await flushPromises();
    expect(storage.data.get(DAY_NIGHT_CONTROL_COLLAPSED_KEY)).toBe(true);
  });

  it('hydrates collapsed state from StorageService on init', async () => {
    const storage = new FakeStorageService();
    await storage.set(DAY_NIGHT_CONTROL_COLLAPSED_KEY, true);
    const { fixture } = configure(storage);
    await flushPromises();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(true);
  });
});
