import { computed, Injectable, signal } from '@angular/core';
import { AppRole, toAppRole } from '../config/user-roles';
import { CurrentUser } from '../models/User';

const USER_KEY = 'currentUser';
const TOKEN_KEY = 'sessionToken';

/**
 * Client-side session state.
 *
 * Holds the safe current-user DTO and the session token. The stored roles drive
 * UI visibility only: every request is re-authorised server-side against live
 * `_Role` membership, so editing localStorage grants no access.
 *
 * Unrecognised role names — including the retired `SuperAdmin` and `Employee` —
 * are discarded on load, so a stale session cannot resurrect a legacy role.
 */
@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private userSignal = signal<CurrentUser | null>(this.loadUser());
  private tokenSignal = signal<string | null>(this.loadToken());

  user = this.userSignal.asReadonly();
  token = this.tokenSignal.asReadonly();
  isLoggedIn = computed(() => !!this.tokenSignal());

  /** Live application roles held by the signed-in user. */
  roles = computed<AppRole[]>(() => this.userSignal()?.roles ?? []);

  isAdmin = computed(() => this.roles().includes(AppRole.ADMIN));
  isStudent = computed(() => this.roles().includes(AppRole.STUDENT));

  userDisplayName = computed(() => {
    const user = this.userSignal();
    if (!user) return '';
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.username || '';
  });

  /** True when the user holds at least one of the supplied roles. */
  hasAnyRole(allowed: readonly AppRole[]): boolean {
    const held = this.roles();
    return allowed.some((role) => held.includes(role));
  }

  saveSession(user: CurrentUser, token: string): void {
    const sanitized = this.sanitize(user);
    localStorage.setItem(USER_KEY, JSON.stringify(sanitized));
    localStorage.setItem(TOKEN_KEY, token);
    this.userSignal.set(sanitized);
    this.tokenSignal.set(token);
  }

  clearSession(): void {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    this.userSignal.set(null);
    this.tokenSignal.set(null);
  }

  /**
   * Keep only the allow-listed DTO fields and only recognised roles. Guards a
   * component against reading a field the API no longer sends, and drops legacy
   * role names outright.
   */
  private sanitize(user: CurrentUser): CurrentUser {
    const roles = (Array.isArray(user.roles) ? user.roles : [])
      .map(toAppRole)
      .filter((role): role is AppRole => role !== undefined);

    const sanitized: CurrentUser = {
      id: String(user.id ?? ''),
      username: String(user.username ?? ''),
      roles,
    };
    if (user.firstName) sanitized.firstName = user.firstName;
    if (user.lastName) sanitized.lastName = user.lastName;
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
