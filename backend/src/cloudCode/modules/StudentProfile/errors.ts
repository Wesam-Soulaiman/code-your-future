/**
 * Stable, sanitised error codes for the Student profile.
 *
 * Same contract as the authentication codes: the token **is** the whole message.
 * No profile value, no database detail, and no library text ever travels with an
 * error — an error about a phone number must not quote the phone number.
 *
 * Field-level validation is the one place that needs more than a code, because
 * "something is wrong" is useless in a twelve-field form. Those responses carry
 * a `fields` map of **field name → stable reason code**, never a value and never
 * a sentence; the frontend turns each reason into translated copy.
 */

export const ProfileError = {
  /** The caller is not a Student. */
  NOT_A_STUDENT: 'NOT_A_STUDENT',
  /** One or more fields failed validation; see the `fields` map. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** The profile could not be read or written. */
  PROFILE_UNAVAILABLE: 'PROFILE_UNAVAILABLE',
  /** The uploaded photo was rejected. */
  PHOTO_REJECTED: 'PHOTO_REJECTED',
  /** There is no photo to act on. */
  PHOTO_NOT_FOUND: 'PHOTO_NOT_FOUND',
  /** Anything unexpected. */
  PROFILE_SAVE_FAILED: 'PROFILE_SAVE_FAILED',
} as const;

export type ProfileErrorCode = (typeof ProfileError)[keyof typeof ProfileError];

export const PROFILE_ERROR_CODES: readonly ProfileErrorCode[] = Object.values(ProfileError);

/** Reasons a single field can be rejected. Stable, translatable, value-free. */
export const FieldReason = {
  REQUIRED: 'REQUIRED',
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  INVALID: 'INVALID',
  NOT_ALLOWED: 'NOT_ALLOWED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  WRONG_DOMAIN: 'WRONG_DOMAIN',
} as const;

export type FieldReasonCode = (typeof FieldReason)[keyof typeof FieldReason];

export const FIELD_REASON_CODES: readonly FieldReasonCode[] = Object.values(FieldReason);

/** Field name → why it was rejected. Never contains a submitted value. */
export type FieldErrors = Record<string, FieldReasonCode>;

export function isProfileErrorCode(value: unknown): value is ProfileErrorCode {
  return typeof value === 'string' && (PROFILE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Build the Parse error for a code.
 *
 * Validation failures carry the field map in a dedicated property. Parse
 * serialises the message only, so the map is encoded into the message as JSON —
 * it holds nothing but field names and reason codes, both of which are fixed
 * vocabulary that this repository defines.
 */
export function profileError(code: ProfileErrorCode, fields?: FieldErrors): Parse.Error {
  const message =
    code === ProfileError.VALIDATION_FAILED && fields && Object.keys(fields).length > 0
      ? `${code}:${JSON.stringify(fields)}`
      : code;

  switch (code) {
    case ProfileError.NOT_A_STUDENT:
      return new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, message);
    case ProfileError.VALIDATION_FAILED:
    case ProfileError.PHOTO_REJECTED:
      return new Parse.Error(Parse.Error.VALIDATION_ERROR, message);
    case ProfileError.PHOTO_NOT_FOUND:
      return new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, message);
    default:
      return new Parse.Error(Parse.Error.OTHER_CAUSE, message);
  }
}
