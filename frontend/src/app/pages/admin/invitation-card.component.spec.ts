import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { InvitationStatus } from '../../models/Batch';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { InvitationCardComponent } from './invitation-card.component';

/**
 * The invitation panel.
 *
 * This is the only place in the product that ever holds a raw invitation token,
 * so most of what is asserted here is about where the token is *not*: not in
 * storage, not in a URL, not in a downloaded file name, and gone the moment the
 * link it belongs to stops working.
 */

@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

const TOKEN = 'Qm9vbXNoYWxha2FfY2FuYXJ5X3Rva2VuX3ZhbHVl';

const CURRENT: InvitationStatus = {
  exists: true,
  state: 'current',
  fingerprint: 'e3b0c442',
  version: 1,
  usable: true,
  canManage: true,
};

const NONE: InvitationStatus = { exists: false, usable: false, canManage: true };

const ARCHIVED: InvitationStatus = {
  exists: true,
  state: 'current',
  fingerprint: 'e3b0c442',
  version: 1,
  usable: true,
  canManage: false,
};

describe('InvitationCardComponent', () => {
  let fixture: ComponentFixture<InvitationCardComponent>;
  let http: HttpTestingController;

  function setup(status: InvitationStatus = CURRENT, lang: 'en' | 'ar' = 'en'): void {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [InvitationCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).saveSession({ id: 'a1', roles: [AppRole.ADMIN] }, 'r:token');

    fixture = TestBed.createComponent(InvitationCardComponent);
    fixture.componentRef.setInput('batchId', 'b1');
    fixture.componentRef.setInput('batchName', 'Spring 2026');
    fixture.componentRef.setInput('initialStatus', status);
    fixture.detectChanges();
  }

  const text = (): string => (fixture.nativeElement.textContent as string).toLowerCase();
  const html = (): string => fixture.nativeElement.innerHTML as string;

  /**
   * The link as it is actually shown.
   *
   * Read from the input's `value` **property**, not from markup: Angular sets
   * it as a DOM property, so the token never appears in `innerHTML` at all.
   * That is a genuine (small) benefit — it keeps the token out of anything that
   * serialises the DOM — but it also means an `innerHTML` assertion would pass
   * whether the link were present or not, which is exactly the kind of test
   * that proves nothing.
   */
  const shownLink = (): string => {
    const input = fixture.nativeElement.querySelector(
      '.cyf-invitation-link-input',
    ) as HTMLInputElement | null;
    return input?.value ?? '';
  };

  const clickByText = (needle: string): void => {
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
      (element as HTMLElement).textContent?.toLowerCase().includes(needle),
    ) as HTMLButtonElement | undefined;
    expect(button, `no button matching "${needle}"`).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  };

  /** Issue a link and return the raw response the panel received. */
  const issue = (): void => {
    clickByText('generate');
    http.expectOne((req) => req.url.includes('issueBatchInvitation')).flush({
      token: TOKEN,
      invitationUrl: `https://app.example.test/#/join/${TOKEN}`,
      invitationPath: `/#/join/${TOKEN}`,
      invitation: CURRENT,
    });
    fixture.detectChanges();
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('before a link exists', () => {
    it('says there is none and offers to generate one', () => {
      setup(NONE);
      expect(text()).toContain('no invitation link');
      expect(text()).toContain('generate link');
    });

    it('shows no fingerprint or version for a link that does not exist', () => {
      setup(NONE);
      expect(text()).not.toContain('e3b0c442');
    });
  });

  describe('the raw token', () => {
    it('is never written to any storage', () => {
      setup(NONE);
      issue();
      expect(JSON.stringify(localStorage)).not.toContain(TOKEN);
      expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN);
    });

    it('is shown once, with a warning that it will not be shown again', () => {
      setup(NONE);
      issue();
      expect(shownLink()).toContain(TOKEN);
      expect(text()).toContain('only time');
    });

    it('is not in the serialised markup even while it is on screen', () => {
      // It reaches the input as a DOM property. Anything that serialises the
      // page — an error reporter, a DOM snapshot — does not pick it up.
      setup(NONE);
      issue();
      expect(html()).not.toContain(TOKEN);
    });

    it('is gone from the page the moment the link is revoked', () => {
      setup(NONE);
      issue();
      expect(shownLink()).toContain(TOKEN);

      clickByText('revoke');
      http
        .expectOne((req) => req.url.includes('revokeBatchInvitation'))
        .flush({ ...CURRENT, state: 'revoked', usable: false });
      fixture.detectChanges();

      // Leaving a dead link on screen invites somebody to send it.
      expect(shownLink()).toBe('');
    });

    it('is gone once the link is expired', () => {
      setup(NONE);
      issue();

      clickByText('expire now');
      http
        .expectOne((req) => req.url.includes('expireBatchInvitation'))
        .flush({ ...CURRENT, state: 'expired', usable: false });
      fixture.detectChanges();

      expect(shownLink()).toBe('');
    });

    it('is never sent back to the server in a URL', () => {
      setup(NONE);
      clickByText('generate');
      const request = http.expectOne((req) => req.url.includes('issueBatchInvitation'));
      expect(request.request.urlWithParams).not.toContain(TOKEN);
      request.flush({
        token: TOKEN,
        invitationPath: `/#/join/${TOKEN}`,
        invitation: CURRENT,
      });
    });
  });

  describe('a link that exists but was not issued on this page', () => {
    it('describes it without pretending it can show it', () => {
      setup(CURRENT);
      expect(text()).toContain('e3b0c442');
      expect(text()).toContain('not stored anywhere');
      expect(shownLink()).toBe('');
    });

    it('shows the fingerprint and version, which reveal nothing', () => {
      setup(CURRENT);
      expect(text()).toContain('e3b0c442');
      expect(text()).toContain('reference');
    });

    it('offers rotation, which is how a lost link is replaced', () => {
      setup(CURRENT);
      expect(text()).toContain('generate a new link');
      expect(text()).toContain('stops the old one');
    });
  });

  describe('an archived Batch', () => {
    it('says the link cannot be changed and offers no action that would fail', () => {
      setup(ARCHIVED);
      expect(text()).toContain('archived');
      expect(text()).not.toContain('generate a new link');
      expect(text()).not.toContain('revoke');
    });
  });

  describe('the page copy', () => {
    it('renders no untranslated key', () => {
      setup(CURRENT);
      expect(html()).not.toMatch(/admin\.batches\.invitation\./);
    });

    it('works in Arabic', () => {
      setup(CURRENT, 'ar');
      expect(fixture.nativeElement.textContent).toMatch(/[؀-ۿ]/);
    });

    it('never renders the word "hash" at somebody who does not need it', () => {
      // The fingerprint is presented as a reference, not as a cryptographic
      // artefact — the label is for an Admin, not for a reviewer.
      setup(CURRENT);
      expect(text()).not.toContain('sha-256');
    });
  });
});
