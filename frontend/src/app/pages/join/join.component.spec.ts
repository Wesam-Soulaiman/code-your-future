import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { InvitationPreview } from '../../models/Batch';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { JoinComponent } from './join.component';

/**
 * The public invitation landing page.
 *
 * One URL has to work for six different people. These tests walk each of them
 * through it and assert two things every time: that the page asks for the right
 * next step, and that the token never ends up anywhere it could be read later.
 */

@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

/** A realistic 32-byte base64url token. */
const TOKEN = 'Qm9vbXNoYWxha2FfY2FuYXJ5X3Rva2VuX3ZhbHVl';

const JOINABLE: InvitationPreview = {
  joinable: true,
  batch: {
    name: 'Spring 2026',
    description: 'The spring cohort',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    status: 'active',
  },
};

describe('JoinComponent', () => {
  let fixture: ComponentFixture<JoinComponent>;
  let http: HttpTestingController;
  let router: Router;
  let lastRequestUrl = '';
  let lastRequestBody: Record<string, unknown> | null = null;

  type Who = 'visitor' | 'student' | 'incompleteStudent' | 'admin';

  async function setup(
    who: Who = 'visitor',
    preview: InvitationPreview | 'error' = JOINABLE,
    lang: 'en' | 'ar' = 'en',
  ): Promise<void> {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [JoinComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          // The page reads its token from the route snapshot.
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ token: TOKEN }) } },
        },
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);

    const session = TestBed.inject(SessionService);
    if (who === 'student') {
      session.saveSession(
        { id: 's1', roles: [AppRole.STUDENT], profileComplete: true },
        'r:token',
      );
    } else if (who === 'incompleteStudent') {
      session.saveSession(
        { id: 's1', roles: [AppRole.STUDENT], profileComplete: false },
        'r:token',
      );
    } else if (who === 'admin') {
      session.saveSession({ id: 'a1', roles: [AppRole.ADMIN] }, 'r:token');
    }

    fixture = TestBed.createComponent(JoinComponent);
    fixture.detectChanges();

    lastRequestBody = null;
    const request = http.expectOne((req) => req.url.includes('previewInvitation'));
    lastRequestUrl = request.request.urlWithParams;
    lastRequestBody = request.request.body as Record<string, unknown> | null;

    if (preview === 'error') {
      request.flush(
        { error: 'INVITATION_INVALID' },
        { status: 400, statusText: 'Bad Request' },
      );
    } else {
      request.flush(preview);
    }
    fixture.detectChanges();
  }

  const text = (): string => (fixture.nativeElement.textContent as string).toLowerCase();
  const html = (): string => fixture.nativeElement.innerHTML as string;

  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('the token', () => {
    it('travels in the request body, never in the URL', async () => {
      // A URL ends up in access logs, proxy logs, and browser history. A body
      // does not.
      await setup();
      expect(lastRequestUrl).not.toContain(TOKEN);
      expect(lastRequestBody?.['token']).toBe(TOKEN);
    });

    it('is remembered so a sign-in can come back to it', async () => {
      await setup('visitor');
      expect(sessionStorage.getItem('pendingInvitationToken')).toBe(TOKEN);
    });

    it('is never written to localStorage', async () => {
      await setup('visitor');
      expect(JSON.stringify(localStorage)).not.toContain(TOKEN);
    });

    it('is never rendered into the page', async () => {
      await setup('student');
      // A token on screen ends up in a screenshot, a screen share, or a photo.
      // Checked three ways, because markup alone would miss it: Angular sets
      // input values as DOM *properties*, so a token in a field would not
      // appear in `innerHTML` at all.
      expect(html()).not.toContain(TOKEN);
      expect(fixture.nativeElement.textContent).not.toContain(TOKEN);
      for (const input of fixture.nativeElement.querySelectorAll('input, textarea')) {
        expect((input as HTMLInputElement).value).not.toContain(TOKEN);
      }
    });

    it('is forgotten when the link turns out to be unusable', async () => {
      await setup('visitor', { joinable: false, reason: 'INVITATION_EXPIRED' });
      expect(sessionStorage.getItem('pendingInvitationToken')).toBeNull();
    });
  });

  describe('a Visitor', () => {
    it('is asked to sign in', async () => {
      await setup('visitor');
      expect(text()).toContain('continue with google');
    });

    it('sees what they were invited to before being asked for anything', async () => {
      await setup('visitor');
      expect(text()).toContain('spring 2026');
    });

    it('is offered no way to join without signing in', async () => {
      await setup('visitor');
      expect(text()).not.toContain('join this batch');
    });
  });

  describe('a Student with an unfinished profile', () => {
    it('is asked to complete it', async () => {
      await setup('incompleteStudent');
      expect(text()).toContain('complete my profile');
    });

    it('is told they will be brought back', async () => {
      await setup('incompleteStudent');
      expect(text()).toContain('bring you back');
    });

    it('keeps the invitation while they go and fill in the form', async () => {
      await setup('incompleteStudent');
      expect(sessionStorage.getItem('pendingInvitationToken')).toBe(TOKEN);
    });
  });

  describe('a Student who can join', () => {
    it('is offered the join action', async () => {
      await setup('student');
      expect(text()).toContain('join this batch');
    });

    it('joins, and the invitation is forgotten afterwards', async () => {
      await setup('student');

      const button = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
        (element as HTMLElement).textContent?.toLowerCase().includes('join this batch'),
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();

      http.expectOne((req) => req.url.includes('joinBatchWithInvitation')).flush({
        alreadyEnrolled: false,
        batch: { id: 'b1', name: 'Spring 2026', startDate: '2026-03-01', status: 'active' },
      });
      fixture.detectChanges();

      expect(text()).toContain('you are in');
      expect(sessionStorage.getItem('pendingInvitationToken')).toBeNull();
    });

    it('says so plainly when they had already joined', async () => {
      await setup('student');

      const button = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
        (element as HTMLElement).textContent?.toLowerCase().includes('join this batch'),
      ) as HTMLButtonElement;
      button.click();
      fixture.detectChanges();

      http.expectOne((req) => req.url.includes('joinBatchWithInvitation')).flush({
        alreadyEnrolled: true,
        batch: { id: 'b1', name: 'Spring 2026', startDate: '2026-03-01', status: 'active' },
      });
      fixture.detectChanges();

      expect(text()).toContain('already joined');
    });
  });

  describe('an Admin', () => {
    it('is told plainly rather than shown an action that would fail', async () => {
      await setup('admin');
      expect(text()).toContain('admin account');
      expect(text()).not.toContain('join this batch');
    });
  });

  describe('an unusable link', () => {
    const reasons: [string, string][] = [
      ['INVITATION_EXPIRED', 'expired'],
      ['INVITATION_REVOKED', 'revoked'],
      ['INVITATION_REPLACED', 'replaced'],
      ['INVITATION_INVALID', 'not valid'],
    ];

    for (const [reason, expected] of reasons) {
      it(`says why for ${reason}`, async () => {
        await setup('visitor', { joinable: false, reason });
        expect(text()).toContain(expected);
      });
    }

    it('offers no join action whoever is holding it', async () => {
      await setup('student', { joinable: false, reason: 'INVITATION_EXPIRED' });
      expect(text()).not.toContain('join this batch');
    });

    it('reveals nothing about a Batch it did not resolve to', async () => {
      await setup('visitor', { joinable: false, reason: 'INVITATION_INVALID' });
      expect(text()).not.toContain('spring 2026');
    });
  });

  describe('when the server cannot be reached', () => {
    it('says so rather than showing a broken page', async () => {
      await setup('visitor', 'error');
      expect(text().length).toBeGreaterThan(0);
      expect(text()).not.toContain('undefined');
      expect(text()).not.toContain('[object');
    });
  });

  describe('the page itself', () => {
    it('renders no untranslated key', async () => {
      await setup('visitor');
      expect(html()).not.toMatch(/join\.[a-zA-Z.]+/);
      expect(html()).not.toMatch(/batch\.fields\./);
    });

    it('works in Arabic', async () => {
      await setup('visitor', JOINABLE, 'ar');
      expect(fixture.nativeElement.textContent).toMatch(/[؀-ۿ]/);
    });

    it('has exactly one main landmark and a skip link', async () => {
      await setup('visitor');
      expect(fixture.nativeElement.querySelectorAll('main').length).toBe(1);
      expect(fixture.nativeElement.querySelector('.cyf-skip-link')).toBeTruthy();
    });

    it('navigates a signed-out visitor to sign-in when they sign in', async () => {
      await setup('visitor');
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const button = [...fixture.nativeElement.querySelectorAll('button')].find((element) =>
        (element as HTMLElement).textContent?.toLowerCase().includes('continue with google'),
      ) as HTMLButtonElement;
      button.click();

      expect(navigate).toHaveBeenCalledWith(['/auth/student']);
    });
  });
});
