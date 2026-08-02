import { describe, expect, it } from 'vitest';

import { formatCalendarDate, formatCalendarDateShort, formatInstant } from './calendar-date';

/**
 * Rendering Batch dates.
 *
 * The bug this guards against is the classic one: `new Date('2026-03-03')` is
 * parsed as **UTC midnight**, and rendering that in any timezone west of
 * Greenwich shows the 2nd. A Batch that starts on the 3rd would be advertised
 * as starting on the 2nd to everybody in the Americas — silently, and only for
 * them.
 */

describe('formatCalendarDate', () => {
  it('shows the day that was stored, not a timezone-shifted one', () => {
    const rendered = formatCalendarDate('2026-03-03', 'en');
    expect(rendered).toContain('3');
    expect(rendered).toContain('2026');
    expect(rendered).toContain('March');
    // The failure mode being guarded against.
    expect(rendered).not.toContain('2 March');
  });

  it('holds at both ends of the year, where an off-by-one changes the year', () => {
    const january = formatCalendarDate('2026-01-01', 'en');
    expect(january).toContain('2026');
    expect(january).not.toContain('2025');

    const december = formatCalendarDate('2026-12-31', 'en');
    expect(december).toContain('2026');
    expect(december).not.toContain('2027');
  });

  it('renders a leap day as itself', () => {
    const rendered = formatCalendarDate('2024-02-29', 'en');
    expect(rendered).toContain('29');
    expect(rendered).toContain('February');
  });

  it('localises the month name into Arabic', () => {
    const rendered = formatCalendarDate('2026-03-03', 'ar');
    // Arabic script is present…
    expect(rendered).toMatch(/[؀-ۿ]/);
    // …and the digits are Latin, matching every other number in the product.
    expect(rendered).toContain('2026');
    expect(rendered).not.toMatch(/[٠-٩]/);
  });

  it('returns an empty string for an absent value rather than a fake date', () => {
    for (const empty of [undefined, null, '']) {
      expect(formatCalendarDate(empty, 'en')).toBe('');
    }
  });

  it('returns a malformed value untouched rather than guessing at it', () => {
    // A wrong value should look wrong, not look like a plausible other day.
    for (const bad of ['not-a-date', '03/03/2026', '2026-3-3']) {
      expect(formatCalendarDate(bad, 'en')).toBe(bad);
    }
  });
});

describe('formatCalendarDateShort', () => {
  it('keeps the same day as the long form', () => {
    expect(formatCalendarDateShort('2026-03-03', 'en')).toContain('3');
    expect(formatCalendarDateShort('2026-03-03', 'en')).toContain('2026');
  });

  it('is shorter than the long form', () => {
    const long = formatCalendarDate('2026-09-15', 'en');
    const short = formatCalendarDateShort('2026-09-15', 'en');
    expect(short.length).toBeLessThanOrEqual(long.length);
  });
});

describe('formatInstant', () => {
  it('renders a real moment, including a time', () => {
    const rendered = formatInstant('2026-03-03T14:30:00.000Z', 'en');
    expect(rendered).toContain('2026');
    // A time component is present — this is a moment, not a calendar day.
    expect(rendered).toMatch(/\d{1,2}:\d{2}/);
  });

  it('returns an empty string for an absent or unparseable value', () => {
    for (const empty of [undefined, null, '', 'not-a-date']) {
      expect(formatInstant(empty, 'en')).toBe('');
    }
  });

  it('uses Latin digits in Arabic, like every other number in the product', () => {
    const rendered = formatInstant('2026-03-03T14:30:00.000Z', 'ar');
    expect(rendered).not.toMatch(/[٠-٩]/);
  });
});
