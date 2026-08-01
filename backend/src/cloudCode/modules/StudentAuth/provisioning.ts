/**
 * Student provisioning from a verified Google identity.
 *
 * Everything in this file runs **after** `verifyGoogleCredential()` has returned
 * verified claims. Nothing here ever reads a client-supplied field: the caller
 * passes `GoogleIdentityClaims`, and those come from the signed token alone.
 *
 * ── Master-key operations, and why each one is required ─────────────────────
 * `_User`, `_Role`, and `StudentAuthIdentity` are all deny-by-default to
 * clients, so provisioning is a trusted server operation by definition. Four
 * master-key operations exist here, all narrow and all server-initiated:
 *
 *   1. read `StudentAuthIdentity` — the class denies every client read;
 *   2. read `_User` — `find`/`get` CLP are `{}`;
 *   3. create `_User` and add it to the `Student` role — the product forbids
 *      manual Student creation and client-chosen roles, so the server is the
 *      only actor that may do this;
 *   4. create `StudentAuthIdentity` — same reason.
 *
 * Session issuance adds a fifth (see `parseLoginAsIssuer`).
 *
 * ── Concurrency ─────────────────────────────────────────────────────────────
 * Two simultaneous first sign-ins for the same Google account both find no
 * identity and both try to create one. The unique index on
 * (provider, providerSubject) means the database — not an in-memory check —
 * decides the winner. The loser catches the duplicate-key error, deletes the
 * `_User` it had just created, re-reads the winning identity, and continues with
 * the winner's account. The outcome is exactly one Student and exactly one
 * identity, whichever request happened to be first.
 */

import {randomBytes} from 'node:crypto';
import {catchError} from '@90soft/parse-server-kit';

import StudentAuthIdentity from '../../models/StudentAuthIdentity';
import {AppRole} from '../../utils/constants/roles';
import {getAppRoles} from '../../utils/auth/authorize';
import {StudentAuthError, isStudentAuthErrorCode, studentAuthError} from './errors';
import {GOOGLE_PROVIDER} from './googleConfig';
import {GoogleIdentityClaims} from './googleVerifier';
import {authLog} from './logging';

/** Parse's duplicate-value code, plus MongoDB's raw duplicate-key code. */
const PARSE_DUPLICATE_VALUE = 137;
const PARSE_EMAIL_TAKEN = 203;
const PARSE_USERNAME_TAKEN = 202;
const PARSE_ACCOUNT_ALREADY_LINKED = 208;
const MONGO_DUPLICATE_KEY = 11000;

export interface ProvisionedStudent {
  user: Parse.User;
  /** True when this call created the `_User`. */
  userCreated: boolean;
  /** True when this call created the identity record. */
  identityCreated: boolean;
}

/**
 * A session issuer. Injectable so the provisioning logic can be tested without
 * a running Parse Server.
 */
export interface SessionIssuer {
  issue(userId: string): Promise<string>;
}

/**
 * Production issuer — Parse Server's own `/loginAs` endpoint, which exists
 * precisely so that a trusted server can create a session for a user it has
 * authenticated by other means.
 *
 * This is the fifth master-key operation. It is required because the Student has
 * **no password**: there is no credential to present to `logIn`, which is the
 * point. `/loginAs` refuses anything but a full master key (it rejects the
 * read-only key explicitly), creates a normal revocable `_Session`, and the
 * existing `logout` function invalidates it like any other.
 *
 * `loginAs` is absent from `@types/parse`, so the call is typed locally rather
 * than cast to `any`.
 */
export const parseLoginAsIssuer: SessionIssuer = {
  async issue(userId: string): Promise<string> {
    const userClass = Parse.User as unknown as {
      loginAs(id: string): Promise<Parse.User>;
    };

    // `Promise.resolve().then(...)` rather than calling directly: a synchronous
    // throw (a missing method, a misconfigured SDK) would otherwise escape
    // `catchError` untouched and carry its internal message to the client.
    const [error, user] = await catchError(
      Promise.resolve().then(() => userClass.loginAs(userId))
    );
    if (error || !user) {
      throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
    }

    const token = user.getSessionToken();
    if (!token) {
      throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
    }
    return token;
  },
};

let activeIssuer: SessionIssuer = parseLoginAsIssuer;

/** Replace the session issuer. Tests only. */
export function setSessionIssuer(issuer: SessionIssuer): void {
  activeIssuer = issuer;
}

/** Restore the production session issuer. */
export function resetSessionIssuer(): void {
  activeIssuer = parseLoginAsIssuer;
}

export function getSessionIssuer(): SessionIssuer {
  return activeIssuer;
}

/**
 * An opaque, server-generated login identifier.
 *
 * Parse requires a username on every `_User`. It must not be the Google email:
 * an email-shaped username is a guessable handle for the password endpoint and
 * would leak the address to anything that can see a username. This value is
 * random, meaningless, and never leaves the server — no DTO carries it.
 */
function internalUsername(): string {
  return `gid_${randomBytes(24).toString('base64url')}`;
}

/**
 * An unpredictable password nobody will ever hold.
 *
 * Parse requires a password to create a `_User`. It is generated with a CSPRNG,
 * used once inside `save()`, and then discarded — it is never stored outside the
 * password hash, never logged, never returned, and never transmitted. A Student
 * cannot use it even if it were guessed: `loginUser` verifies the Admin role
 * after authentication and destroys the session for anyone else.
 */
function internalPassword(): string {
  return randomBytes(48).toString('base64url');
}

function errorCode(error: unknown): number | undefined {
  const code = (error as {code?: unknown} | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/** True when a save failed because a unique index rejected it. */
function isDuplicateKeyError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === PARSE_DUPLICATE_VALUE || code === MONGO_DUPLICATE_KEY) return true;
  const message = String((error as {message?: unknown} | null)?.message ?? '');
  return message.includes('E11000') || message.includes('duplicate key');
}

/** True when a `_User` save failed because the identity is already taken. */
function isAccountConflictError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === PARSE_EMAIL_TAKEN ||
    code === PARSE_USERNAME_TAKEN ||
    code === PARSE_ACCOUNT_ALREADY_LINKED ||
    isDuplicateKeyError(error)
  );
}

/** Look up the identity for a provider subject. Master key: the class is closed. */
async function findIdentity(subject: string): Promise<StudentAuthIdentity | undefined> {
  const query = new Parse.Query<StudentAuthIdentity>('StudentAuthIdentity');
  query.equalTo('provider', GOOGLE_PROVIDER);
  query.equalTo('providerSubject', subject);

  const [error, identity] = await catchError(query.first({useMasterKey: true}));
  if (error) {
    authLog.error('Identity lookup failed', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'lookup',
      ok: false,
      code: StudentAuthError.SIGN_IN_FAILED,
    });
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }
  return identity ?? undefined;
}

/** Load a `_User` by id. Master key: `_User` denies client reads. */
async function loadUser(userId: string): Promise<Parse.User | undefined> {
  const query = new Parse.Query(Parse.User);
  const [error, user] = await catchError(query.get(userId, {useMasterKey: true}));
  if (error) return undefined;
  return (user as Parse.User) ?? undefined;
}

/**
 * Grant the `Student` role. Idempotent — Parse relations ignore a duplicate add,
 * and membership is checked first so a returning Student causes no write.
 */
async function ensureStudentRole(user: Parse.User): Promise<void> {
  const roleQuery = new Parse.Query(Parse.Role);
  roleQuery.equalTo('name', AppRole.STUDENT);

  const [lookupError, role] = await catchError(roleQuery.first({useMasterKey: true}));
  if (lookupError || !role) {
    authLog.error('Student role is missing; cannot provision', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'role',
      ok: false,
      code: StudentAuthError.SIGN_IN_FAILED,
    });
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }

  (role as Parse.Role).getUsers().add(user);
  const [saveError] = await catchError(
    (role as Parse.Role).save(null, {useMasterKey: true})
  );
  if (saveError) {
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }
}

/**
 * Decide whether an existing account may sign in as a Student.
 *
 * An Admin is refused outright: an Admin account is never converted to a
 * Student, and never gains a Student session. An account whose Student role has
 * been withdrawn is refused too, so removing the role removes access at the next
 * sign-in as well as on every subsequent request.
 */
async function assertEligible(user: Parse.User): Promise<void> {
  const roles = await getAppRoles(user);

  if (roles.includes(AppRole.ADMIN)) {
    authLog.warn('Google sign-in refused for an Admin account', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'lookup',
      ok: false,
      userId: user.id,
      code: StudentAuthError.ACCOUNT_NOT_ELIGIBLE,
    });
    throw studentAuthError(StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  }

  if (!roles.includes(AppRole.STUDENT)) {
    authLog.warn('Google sign-in refused: account no longer holds the Student role', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'lookup',
      ok: false,
      userId: user.id,
      code: StudentAuthError.ACCOUNT_NOT_ELIGIBLE,
    });
    throw studentAuthError(StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
  }
}

/** Returned by `createStudentUser` when another writer already claimed the account. */
const ACCOUNT_CONFLICT = Symbol('account-conflict');

/**
 * Resolve the account behind an identity, retrying briefly.
 *
 * The retry exists for one narrow race: a rival request may have saved its
 * `_User` (which is what our own save just collided with) but not yet saved its
 * `StudentAuthIdentity`. That window is a few milliseconds wide. Without the
 * retry the loser would report a conflict for an account that is in the middle
 * of becoming its own.
 */
async function resolveIdentityOwner(subject: string): Promise<Parse.User | undefined> {
  const delays = [0, 60, 180];

  for (const delay of delays) {
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));

    const identity = await findIdentity(subject);
    const ownerId = (identity?.get('user') as Parse.User | undefined)?.id;
    if (!ownerId) continue;

    const user = await loadUser(ownerId);
    if (user) return user;
  }

  return undefined;
}

/** Create the `_User` for a brand-new Google identity. */
async function createStudentUser(
  claims: GoogleIdentityClaims
): Promise<Parse.User | typeof ACCOUNT_CONFLICT> {
  const user = new Parse.User();
  user.setUsername(internalUsername());
  user.setPassword(internalPassword());
  user.setEmail(claims.email);
  if (claims.givenName) user.set('firstName', claims.givenName);
  if (claims.familyName) user.set('lastName', claims.familyName);

  const [error, saved] = await catchError(user.save(null, {useMasterKey: true}));

  if (error || !saved) {
    if (isAccountConflictError(error)) {
      // Some account already claims this email. It is either a rival request
      // for the *same* Google identity that got there first, or a genuinely
      // different account — most likely an Admin. The caller distinguishes the
      // two by looking for an identity on this subject; either way nothing is
      // merged, converted, or disclosed here.
      return ACCOUNT_CONFLICT;
    }

    authLog.error('Student account creation failed', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'provision',
      ok: false,
      code: StudentAuthError.SIGN_IN_FAILED,
    });
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }

  return saved as Parse.User;
}

/** Create the identity record. Returns `undefined` when a rival won the race. */
async function createIdentity(
  subject: string,
  user: Parse.User,
  pictureUrl?: string
): Promise<StudentAuthIdentity | undefined> {
  const identity = new StudentAuthIdentity();
  identity.set('provider', GOOGLE_PROVIDER);
  identity.set('providerSubject', subject);
  identity.set('user', user);
  // Captured once, on the sign-in that creates the account. It is read exactly
  // once more — by the first profile save — and never refreshed, so a Student
  // who later replaces or removes their photo keeps that decision.
  if (pictureUrl) identity.set('providerPictureUrl', pictureUrl);
  // Explicit empty ACL: readable and writable by nobody but the master key.
  identity.setACL(new Parse.ACL());

  const [error, saved] = await catchError(identity.save(null, {useMasterKey: true}));

  if (error || !saved) {
    if (isDuplicateKeyError(error)) return undefined;
    authLog.error('Identity creation failed', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'identity',
      ok: false,
      code: StudentAuthError.SIGN_IN_FAILED,
    });
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }

  return saved as StudentAuthIdentity;
}

/**
 * Resolve verified Google claims to a Student account, creating one on first
 * sign-in and reusing it every time afterwards.
 */
export async function provisionStudentFromGoogle(
  claims: GoogleIdentityClaims
): Promise<ProvisionedStudent> {
  // ── Returning Student ─────────────────────────────────────────────────────
  const existing = await findIdentity(claims.subject);

  if (existing) {
    const pointer = existing.get('user') as Parse.User | undefined;
    const userId = pointer?.id;
    const user = userId ? await loadUser(userId) : undefined;

    if (!user) {
      // The identity outlived its account. Fail closed rather than re-creating
      // a Student and silently re-pointing an existing identity record.
      authLog.error('Identity points at a missing account', {
        op: 'provisionStudent',
        provider: GOOGLE_PROVIDER,
        stage: 'lookup',
        ok: false,
        code: StudentAuthError.ACCOUNT_NOT_ELIGIBLE,
      });
      throw studentAuthError(StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    }

    await assertEligible(user);

    authLog.info('Returning Student recognised', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'complete',
      ok: true,
      userId: user.id,
      created: false,
    });

    return {user, userCreated: false, identityCreated: false};
  }

  // ── First sign-in ─────────────────────────────────────────────────────────
  const outcome = await createStudentUser(claims);

  if (outcome === ACCOUNT_CONFLICT) {
    // Another writer claimed the account first. If it belongs to this same
    // Google identity, this is a concurrent first sign-in and both callers must
    // end up on the winner's account. If it does not, a different account holds
    // this email and must never be merged or converted.
    const winner = await resolveIdentityOwner(claims.subject);

    if (!winner) {
      authLog.warn('Google sign-in refused: conflicting existing account', {
        op: 'provisionStudent',
        provider: GOOGLE_PROVIDER,
        stage: 'provision',
        ok: false,
        code: StudentAuthError.ACCOUNT_NOT_ELIGIBLE,
      });
      throw studentAuthError(StudentAuthError.ACCOUNT_NOT_ELIGIBLE);
    }

    await assertEligible(winner);

    authLog.info('Concurrent first sign-in resolved to the winning account', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'complete',
      ok: true,
      userId: winner.id,
      created: false,
    });

    return {user: winner, userCreated: false, identityCreated: false};
  }

  const user = outcome;
  await ensureStudentRole(user);

  const identity = await createIdentity(claims.subject, user, claims.pictureUrl);

  if (!identity) {
    // A concurrent request created the identity first. Remove the account this
    // request created so no duplicate Student survives, then continue with the
    // winner's account.
    await catchError(user.destroy({useMasterKey: true}));

    const winningUser = await resolveIdentityOwner(claims.subject);

    if (!winningUser) {
      throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
    }

    await assertEligible(winningUser);

    authLog.info('Concurrent first sign-in resolved to the existing Student', {
      op: 'provisionStudent',
      provider: GOOGLE_PROVIDER,
      stage: 'complete',
      ok: true,
      userId: winningUser.id,
      created: false,
    });

    return {user: winningUser, userCreated: false, identityCreated: false};
  }

  authLog.info('Student provisioned from a verified Google identity', {
    op: 'provisionStudent',
    provider: GOOGLE_PROVIDER,
    stage: 'complete',
    ok: true,
    userId: user.id,
    created: true,
  });

  return {user, userCreated: true, identityCreated: true};
}

/**
 * Issue a Parse session for a provisioned Student.
 *
 * Sanitises at this boundary as well as at the cloud-function boundary: an
 * issuer failure can carry a connection string, a host, or a stack, and none of
 * that may travel further. Only a stable code leaves this function.
 */
export async function issueStudentSession(userId: string): Promise<string> {
  const [error, token] = await catchError(
    Promise.resolve().then(() => activeIssuer.issue(userId))
  );

  if (error || !token) {
    const message = (error as {message?: unknown} | null)?.message;
    if (isStudentAuthErrorCode(message)) throw studentAuthError(message);
    throw studentAuthError(StudentAuthError.SIGN_IN_FAILED);
  }

  return token;
}
