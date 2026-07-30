import { computed, Injectable, signal } from '@angular/core';
import { User } from '../models/User';

const USER_KEY = 'currentUser';
const TOKEN_KEY = 'sessionToken';

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private userSignal = signal<User | null>(this.loadUser());
  private tokenSignal = signal<string | null>(this.loadToken());

  user = this.userSignal.asReadonly();
  token = this.tokenSignal.asReadonly();
  isLoggedIn = computed(() => !!this.tokenSignal());
  userRole = computed(() => this.userSignal()?.role?.[0] ?? '');
  userDisplayName = computed(() => {
    const user = this.userSignal();
    if (!user) return '';
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.username || '';
  });

  saveSession(user: User, token: string): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(TOKEN_KEY, token);
    this.userSignal.set(user);
    this.tokenSignal.set(token);
  }

  clearSession(): void {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    this.userSignal.set(null);
    this.tokenSignal.set(null);
  }

  private loadUser(): User | null {
    try {
      const user = localStorage.getItem(USER_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  }

  private loadToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }
}
