/** Canonical Syrian mobile number stored by the application. */
export const SYRIAN_MOBILE_PATTERN = /^\+9639[0-9]{8}$/;

const LOCAL_MOBILE_PATTERN = /^9[0-9]{8}$/;
const ALLOWED_PHONE_CHARACTERS = /^\+?[0-9\u0660-\u0669\u06f0-\u06f9\s().-]+$/;

/** Convert Arabic-Indic and Eastern Arabic-Indic digits to ASCII. */
function toAsciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

/**
 * Convert a Syrian mobile number to `+9639XXXXXXXX`.
 *
 * This is repeated server-side deliberately: callers cannot bypass canonical
 * storage by skipping the Angular form and sending a request directly.
 */
export function normaliseSyrianPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const text = toAsciiDigits(value.trim());
  if (!text || !ALLOWED_PHONE_CHARACTERS.test(text)) return null;

  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('00963')) digits = digits.slice(5);
  else if (digits.startsWith('963')) digits = digits.slice(3);

  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!LOCAL_MOBILE_PATTERN.test(digits)) return null;

  return `+963${digits}`;
}
