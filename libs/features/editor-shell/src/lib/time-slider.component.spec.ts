import { TestBed } from '@angular/core/testing';

import { PreviewTimeService } from './preview-time.service';
import { TimeSliderComponent } from './time-slider.component';

function build() {
  TestBed.configureTestingModule({ imports: [TimeSliderComponent] });
  const fixture = TestBed.createComponent(TimeSliderComponent);
  const svc = TestBed.inject(PreviewTimeService);
  fixture.detectChanges();
  return { fixture, svc };
}

describe('TimeSliderComponent', () => {
  it('starts in live ("Now") mode and labels as such', () => {
    const { fixture, svc } = build();
    expect(svc.previewAgeWeeks()).toBeNull();
    const label = fixture.nativeElement.querySelector('.label')?.textContent ?? '';
    expect(label).toBe('Now');
    const nowBtn = fixture.nativeElement.querySelector('button.now') as HTMLButtonElement;
    expect(nowBtn.classList.contains('active')).toBe(true);
  });

  it('sliding sets the preview age via the service', () => {
    const { fixture, svc } = build();
    const slider = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    slider.value = '12';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(svc.previewAgeWeeks()).toBe(12);
    expect(fixture.nativeElement.querySelector('.label')?.textContent).toBe('Wk 12');
    const nowBtn = fixture.nativeElement.querySelector('button.now') as HTMLButtonElement;
    expect(nowBtn.classList.contains('active')).toBe(false);
  });

  it('Week 0 is labelled "Week 0" (not "Now")', () => {
    const { fixture, svc } = build();
    const slider = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(svc.previewAgeWeeks()).toBe(0);
    expect(fixture.nativeElement.querySelector('.label')?.textContent).toBe('Week 0');
  });

  it('clicking "Now" resets back to live mode', () => {
    const { fixture, svc } = build();
    svc.setPreviewAge(8);
    fixture.detectChanges();
    expect(svc.previewAgeWeeks()).toBe(8);
    const nowBtn = fixture.nativeElement.querySelector('button.now') as HTMLButtonElement;
    nowBtn.click();
    fixture.detectChanges();
    expect(svc.previewAgeWeeks()).toBeNull();
  });

  it('rejects a slider input with a non-finite parse result', () => {
    const { fixture, svc } = build();
    svc.setPreviewAge(5);
    fixture.detectChanges();
    const slider = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    Object.defineProperty(slider, 'value', { get: () => 'not-a-number', configurable: true });
    slider.dispatchEvent(new Event('input'));
    // PreviewTimeService.setPreviewAge clamps non-finite to null; the
    // component's own guard short-circuits before that, so the previous
    // value of 5 is preserved.
    expect(svc.previewAgeWeeks()).toBe(5);
  });

  it('rejects a synthetic input event without a target', () => {
    const { fixture, svc } = build();
    svc.setPreviewAge(3);
    fixture.componentInstance.onInput(new Event('input'));
    expect(svc.previewAgeWeeks()).toBe(3);
  });

  it('reflects external service state (set by another component)', () => {
    const { fixture, svc } = build();
    svc.setPreviewAge(24);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.label')?.textContent).toBe('Wk 24');
    const slider = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    expect(Number(slider.value)).toBe(24);
  });
});
