// Pure clock formatter for the showcase HUD.
//
// Kept locale-independent + deterministic (explicit weekday/month tables, no
// `toLocaleString`) so the output is stable to assert in unit tests and reads
// the same on every machine. The HUD ticks a `Date` into it once a second.

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface ClockParts {
  /** 12-hour time with seconds + meridiem, e.g. "1:09:05 PM". */
  readonly time: string;
  /** Long date, e.g. "Friday, June 13, 2026". */
  readonly date: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a `Date` into a `{ time, date }` pair for the HUD clock. */
export function formatClock(d: Date): ClockParts {
  const hours24 = d.getHours();
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const time = `${hours12}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${meridiem}`;
  const date = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return { time, date };
}
