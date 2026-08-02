/**
 * Invitation constants.
 *
 * Kept beside the Batch constants rather than inside the model, because the
 * model, the repository, the cloud functions, and the tests all need them and
 * none of those should import a Parse class to read a string.
 */

/**
 * What an invitation row is, right now.
 *
 * Only `current` can be redeemed. The other three are history: they exist so an
 * Admin can see that a link was rotated or revoked, and so a caller presenting
 * an old token gets a truthful answer rather than a generic failure.
 */
export const INVITATION_STATE = {
  CURRENT: 'current',
  REPLACED: 'replaced',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;

export type InvitationState = (typeof INVITATION_STATE)[keyof typeof INVITATION_STATE];

export const INVITATION_STATES: readonly InvitationState[] = [
  INVITATION_STATE.CURRENT,
  INVITATION_STATE.REPLACED,
  INVITATION_STATE.REVOKED,
  INVITATION_STATE.EXPIRED,
];

/**
 * Token size, in bytes of raw randomness.
 *
 * 32 bytes is 256 bits. A join link is guessable only by brute force, and at
 * this size brute force is not a threat model — which is also why a plain
 * SHA-256 is the right way to store it: there is no dictionary to attack, so a
 * slow password KDF would buy nothing and cost every redemption.
 */
export const INVITATION_TOKEN_BYTES = 32;

/**
 * How many characters of the hash identify a version in the UI.
 *
 * Short enough to read aloud, long enough not to collide across the handful of
 * invitations one Batch will ever have, and derived from the **hash** so it
 * reveals nothing about the token.
 */
export const INVITATION_FINGERPRINT_LENGTH = 8;

/** The path an invitation link points at, under the app's hash route. */
export const INVITATION_ROUTE = '/join';

/** Narrow an arbitrary value to an invitation state, or `undefined`. */
export function toInvitationState(value: unknown): InvitationState | undefined {
  return INVITATION_STATES.find(state => state === value);
}
