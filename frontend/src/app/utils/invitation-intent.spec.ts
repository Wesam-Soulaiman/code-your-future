import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearInvitation,
  hasPendingInvitation,
  invitationReturnUrl,
  pendingInvitationToken,
  rememberInvitation,
} from './invitation-intent';

/**
 * Remembering an invitation across sign-in.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - it has to survive a Google round trip and a profile form, or the flow is
 *    broken for exactly the people it exists for;
 *  - it is a **credential**, so it must not outlive the tab, must not survive a
 *    sign-out, and must never become a redirect target somebody else supplied.
 */

/** A realistic 32-byte base64url token. */
const TOKEN = 'Qm9vbXNoYWxha2FfY2FuYXJ5X3Rva2VuX3ZhbHVl';

describe('invitation intent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('what it will remember', () => {
    it('remembers a well-formed token', () => {
      rememberInvitation(TOKEN);
      expect(pendingInvitationToken()).toBe(TOKEN);
      expect(hasPendingInvitation()).toBe(true);
    });

    it('refuses anything that is not token-shaped', () => {
      for (const bad of [
        '',
        'short',
        'has spaces in it',
        'a'.repeat(200),
        'plus+slash/equals=',
        '../../etc/passwd',
        'https://evil.example/steal',
        null,
        undefined,
        42,
        {},
        [],
      ]) {
        sessionStorage.clear();
        rememberInvitation(bad);
        expect(pendingInvitationToken(), `${JSON.stringify(bad)} must not be stored`).toBeNull();
      }
    });

    it('drops a value that was tampered with after being stored', () => {
      // Somebody with devtools can write whatever they like into storage. What
      // comes back out is re-validated, so a path or a URL planted there is
      // discarded rather than navigated to.
      sessionStorage.setItem('pendingInvitationToken', 'https://evil.example/steal');
      expect(pendingInvitationToken()).toBeNull();
      expect(sessionStorage.getItem('pendingInvitationToken')).toBeNull();
    });
  });

  describe('where it lives', () => {
    it('uses sessionStorage, so it dies with the tab', () => {
      rememberInvitation(TOKEN);
      expect(sessionStorage.getItem('pendingInvitationToken')).toBe(TOKEN);
      // localStorage would leave a working invitation on a shared machine
      // indefinitely.
      expect(JSON.stringify(localStorage)).not.toContain(TOKEN);
    });

    it('is forgotten on demand', () => {
      rememberInvitation(TOKEN);
      clearInvitation();
      expect(pendingInvitationToken()).toBeNull();
      expect(hasPendingInvitation()).toBe(false);
      expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN);
    });

    it('clearing when nothing is stored is not an error', () => {
      expect(() => clearInvitation()).not.toThrow();
    });
  });

  describe('the return URL', () => {
    it('is built from the token, never read from storage', () => {
      rememberInvitation(TOKEN);
      expect(invitationReturnUrl()).toBe(`/join/${TOKEN}`);
    });

    it('is null when there is nothing to return to', () => {
      expect(invitationReturnUrl()).toBeNull();
    });

    it('can only ever point at this application', () => {
      // The open-redirect check. Whatever is in storage, the produced URL is a
      // fixed internal route — there is no code path by which a stored value
      // becomes the *prefix* of the destination.
      for (const planted of [
        'https://evil.example',
        '//evil.example',
        'javascript:alert(1)',
        '/../admin',
      ]) {
        sessionStorage.setItem('pendingInvitationToken', planted);
        const url = invitationReturnUrl();
        expect(url === null || url.startsWith('/join/')).toBe(true);
      }
    });
  });
});
