import { formatClock } from './simulation-clock';

describe('formatClock', () => {
  it('formats an afternoon time + long date', () => {
    // 2026-06-13 is a Saturday; 13:09:05 → 1:09:05 PM.
    const d = new Date(2026, 5, 13, 13, 9, 5);
    expect(formatClock(d)).toEqual({ time: '1:09:05 PM', date: 'Saturday, June 13, 2026' });
  });

  it('renders midnight as 12 AM and noon as 12 PM', () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 0, 0)).time).toBe('12:00:00 AM');
    expect(formatClock(new Date(2026, 0, 1, 12, 0, 0)).time).toBe('12:00:00 PM');
  });

  it('zero-pads minutes + seconds, not the hour', () => {
    expect(formatClock(new Date(2026, 2, 4, 9, 5, 7)).time).toBe('9:05:07 AM');
  });

  it('names the weekday + month from the date', () => {
    // 2026-12-25 is a Friday.
    expect(formatClock(new Date(2026, 11, 25, 8, 30, 0)).date).toBe('Friday, December 25, 2026');
  });
});
