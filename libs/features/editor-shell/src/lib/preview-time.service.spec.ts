import { PreviewTimeService } from './preview-time.service';

describe('PreviewTimeService', () => {
  it('starts in live mode (previewAgeWeeks = null)', () => {
    const svc = new PreviewTimeService();
    expect(svc.previewAgeWeeks()).toBeNull();
  });

  it('setPreviewAge(n) writes a finite, non-negative value', () => {
    const svc = new PreviewTimeService();
    svc.setPreviewAge(12);
    expect(svc.previewAgeWeeks()).toBe(12);
  });

  it('setPreviewAge(null) returns to live mode', () => {
    const svc = new PreviewTimeService();
    svc.setPreviewAge(5);
    svc.setPreviewAge(null);
    expect(svc.previewAgeWeeks()).toBeNull();
  });

  it('non-finite inputs collapse to null (defensive)', () => {
    const svc = new PreviewTimeService();
    svc.setPreviewAge(Number.NaN);
    expect(svc.previewAgeWeeks()).toBeNull();
    svc.setPreviewAge(10);
    svc.setPreviewAge(Number.POSITIVE_INFINITY);
    expect(svc.previewAgeWeeks()).toBeNull();
  });

  it('negative inputs collapse to null (no time travel)', () => {
    const svc = new PreviewTimeService();
    svc.setPreviewAge(-5);
    expect(svc.previewAgeWeeks()).toBeNull();
  });

  it('reset() returns to live mode', () => {
    const svc = new PreviewTimeService();
    svc.setPreviewAge(20);
    svc.reset();
    expect(svc.previewAgeWeeks()).toBeNull();
  });
});
