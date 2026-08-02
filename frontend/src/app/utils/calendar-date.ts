/**
 * Rendering Batch dates.
 *
 * ── Two different kinds of date, deliberately kept apart ────────────────────
 * A Batch's `startDate` and `endDate` are **calendar dates** — `YYYY-MM-DD`,
 * with no time and no zone. They mean "the 3rd of March" to everybody, wherever
 * they are. Parsing one with `new Date('2026-03-03')` reads it as UTC midnight
 * and then renders it in the reader's zone, which shows the 2nd to anyone west
 * of Greenwich. So the parts are read out of the string and rebuilt as a local
 * date; the day that was stored is the day that is shown.
 *
 * `joinedAt` and `expiresAt` are **instants** — a real moment in time — and
 * those genuinely should move with the reader's zone, so they go through the
 * ordinary path.
 *
 * ── Why Latin digits in Arabic ──────────────────────────────────────────────
 * `Intl` under `ar` defaults to Arabic-Indic numerals (٢٠٢٦). The rest of this
 * product — the PrimeNG DatePicker, counts, table pagination — renders Latin
 * digits, and a page that mixes the two reads as broken rather than localised.
 * The locale is extended with `-u-nu-latn` so the *words* localise and the
 * *digits* stay consistent with everything beside them.
 */

/** Matches a plain calendar date, and nothing else. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The app's two languages, mapped to locales with the numbering system pinned. */
function localeFor(lang: string): string {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
}

/**
 * A `YYYY-MM-DD` calendar date, in the reader's language.
 *
 * Anything that is not a calendar date is returned untouched rather than
 * guessed at — a malformed value should look wrong, not look like a plausible
 * different day.
 */
export function formatCalendarDate(value: string | undefined | null, lang: string): string {
  if (!value) return '';

  const parts = CALENDAR_DATE.exec(value);
  if (!parts) return value;

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  // Built as a *local* date, so no zone conversion can shift the day.
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** A short form for dense places — tables, chips, list rows. */
export function formatCalendarDateShort(
  value: string | undefined | null,
  lang: string,
): string {
  if (!value) return '';

  const parts = CALENDAR_DATE.exec(value);
  if (!parts) return value;

  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * An instant — a moment that really did happen at one point in time.
 *
 * Unlike a calendar date, this one is *supposed* to move with the reader's
 * zone: "you joined at 14:03" should mean 14:03 where they are.
 */
export function formatInstant(value: string | undefined | null, lang: string): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
