import { computed, Injectable, signal } from '@angular/core';
import { AppRole, toAppRole } from '../config/user-roles';
import { CurrentUser, SessionStatus } from '../models/User';

const USER_KEY = 'currentUser';
const TOKEN_KEY = 'sessionToken';

/**
 * Client-side session state — the single authority the UI reads.
 *
 * Holds the safe session DTO and the session token. The stored roles drive UI
 * visibility only: every request is re-authorised server-side against live
 * `_Role` membership, so editing localStorage grants no access. Unrecognised
 * role names — including the retired `SuperAdmin` and `Employee` — are discarded
 * on load, so a stale session cannot resurrect a legacy role.
 *
 * ── Explicit states ─────────────────────────────────────────────────────────
 * `status()` is one of:
 *
 *   restoring        a token exists but the server has not confirmed it yet;
 *   authenticated    the server confirmed the session and returned live roles;
 *   unauthenticated  no token, or the token was rejected.
 *
 * The distinction matters for guards: a cached role from localStorage is a
 * *hint*, never a decision. Roles become trustworthy only once restoration has
 * replaced them with the server's answer, which is why the app initializer
 * blocks bootstrap until `status()` leaves `restoring`.
 */
@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private userSignal = signal<CurrentUser | null>(this.loadUser());
  private tokenSignal = signal<string | null>(this.loadToken());

  /**
   * Start in `restoring` when a token is present: at that moment nothing has
   * been verified, and the cached roles are unproven.
   */
  private statusSignal = signal<SessionStatus>(
    this.loadToken() ? 'restoring' : 'unauthenticated',
  );

  user = this.userSignal.asReadonly();
  token = this.tokenSignal.asReadonly();
  status = this.statusSignal.asReadonly();

  isLoggedIn = computed(() => !!this.tokenSignal());
  isRestoring = computed(() => this.statusSignal() === 'restoring');

  /** True only once the server has confirmed the session. */
  isAuthenticated = computed(() => this.statusSignal() === 'authenticated');

  /** Live application roles held by the signed-in user. */
  roles = computed<AppRole[]>(() => this.userSignal()?.roles ?? []);

  isAdmin = computed(() => this.roles().includes(AppRole.ADMIN));
  isStudent = computed(() => this.roles().includes(AppRole.STUDENT));

  /**
   * Whether the signed-in Student has completed their profile ⟨CP3A⟩.
   *
   * Replaced by the server's answer on every restoration. The cached copy is a
   * hint for rendering only: a tampered value routes somebody to a form they
   * have already filled in, and the backend still refuses everything they are
   * not entitled to.
   */
  profileComplete = computed(() => this.userSignal()?.profileComplete === true);

  userDisplayName = computed(() => this.userSignal()?.displayName ?? '');

  /** True when the user holds at least one of the supplied roles. */
  hasAnyRole(allowed: readonly AppRole[]): boolean {
    const held = this.roles();
    return allowed.some((role) => held.includes(role));
  }

  /** Store a confirmed session. Used by both sign-in paths and by restoration. */
  saveSession(user: CurrentUser, token: string): void {
    const sanitized = this.sanitize(user);
    localStorage.setItem(USER_KEY, JSON.stringify(sanitized));
    localStorage.setItem(TOKEN_KEY, token);
    this.userSignal.set(sanitized);
    this.tokenSignal.set(token);
    this.statusSignal.set('authenticated');
  }

  clearSession(): void {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    this.userSignal.set(null);
    this.tokenSignal.set(null);
    this.statusSignal.set('unauthenticated');
  }

  /** Mark restoration as under way. Idempotent. */
  markRestoring(): void {
    this.statusSignal.set('restoring');
  }

  /**
   * Keep only the allow-listed DTO fields and only recognised roles. Guards a
   * component against reading a field the API does not send, and drops legacy
   * role names outright.
   */
  private sanitize(user: CurrentUser): CurrentUser {
    const roles = (Array.isArray(user.roles) ? user.roles : [])
      .map(toAppRole)
      .filter((role): role is AppRole => role !== undefined);

    const sanitized: CurrentUser = {
      id: String(user.id ?? ''),
      roles,
    };
    if (user.displayName) sanitized.displayName = String(user.displayName);
    // Only ever a boolean, and only for a Student.
    if (typeof user.profileComplete === 'boolean' && roles.includes(AppRole.STUDENT)) {
      sanitized.profileComplete = user.profileComplete;
    }
    return sanitized;
  }

  private loadUser(): CurrentUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      return this.sanitize(JSON.parse(raw) as CurrentUser);
    } catch {
      return null;
    }
  }

  private loadToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }
}
