import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, DebugElement } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DatePicker } from 'primeng/datepicker';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Select } from 'primeng/select';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { ProfileCatalogItem, ProfileCatalogMap } from '../../models/ProfileCatalogItem';
import { StudentProfile } from '../../models/StudentProfile';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { StudentProfileComponent } from './student-profile.component';

/**
 * Complete Profile.
 *
 * Nothing here contacts a real backend: `HttpTestingController` intercepts every
 * call, and `verify()` fails the test if a request was opened that the test did
 * not expect — which is how "no extra call" is proven rather than asserted.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

function item(
  id: string,
  type: ProfileCatalogItem['type'],
  nameEn: string,
  nameAr: string,
  extra: Partial<ProfileCatalogItem> = {},
): ProfileCatalogItem {
  return { id, type, code: id.toUpperCase(), nameEn, nameAr, active: true, sortOrder: 10, ...extra };
}

const DAMASCUS = item('c1', 'CITY', 'Damascus', 'دمشق');
const ALEPPO = item('c2', 'CITY', 'Aleppo', 'حلب');
const DAMASCUS_UNIVERSITY = item('i1', 'INSTITUTION', 'Damascus University', 'جامعة دمشق', {
  institutionKind: 'UNIVERSITY',
});
const HIAST = item('i2', 'INSTITUTION', 'HIAST', 'المعهد العالي', {
  institutionKind: 'INSTITUTE',
});
const OTHER_INSTITUTION = item('i3', 'INSTITUTION', 'Other', 'أخرى', {
  institutionKind: 'OTHER',
  isOther: true,
  sortOrder: 999,
});
const COMPUTER_ENGINEERING = item('m1', 'MAJOR', 'Computer Engineering', 'الهندسة المعلوماتية');
const FRONTEND_ROLE = item('r1', 'TARGET_ROLE', 'Frontend Developer', 'مطوّر واجهات أمامية');

const CATALOG: ProfileCatalogMap = {
  CITY: [DAMASCUS, ALEPPO],
  INSTITUTION: [DAMASCUS_UNIVERSITY, HIAST, OTHER_INSTITUTION],
  MAJOR: [COMPUTER_ENGINEERING],
  TARGET_ROLE: [FRONTEND_ROLE],
};

/** A saved, complete profile. */
const SAVED_PROFILE: StudentProfile = {
  id: 'p1',
  fullName: 'Lina Haddad',
  verifiedEmail: 'lina@example.com',
  phone: '+963 944 123 456',
  city: DAMASCUS,
  institution: DAMASCUS_UNIVERSITY,
  major: COMPUTER_ENGINEERING,
  educationStatus: 'Graduate',
  hasPhoto: false,
  isComplete: true,
};

/** The empty shape a brand-new Student receives. */
const EMPTY_PROFILE: StudentProfile = {
  id: '',
  fullName: '',
  verifiedEmail: 'lina@example.com',
  hasPhoto: false,
  isComplete: false,
};

describe('StudentProfileComponent', () => {
  let fixture: ComponentFixture<StudentProfileComponent>;
  let http: HttpTestingController;

  async function setup(
    profile: StudentProfile = EMPTY_PROFILE,
    lang: 'en' | 'ar' = 'en',
    catalog: ProfileCatalogMap = CATALOG,
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudentProfileComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
        ConfirmationService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);

    TestBed.inject(SessionService).saveSession(
      { id: 'u1', roles: [AppRole.STUDENT], profileComplete: profile.isComplete },
      'r:token',
    );

    fixture = TestBed.createComponent(StudentProfileComponent);
    fixture.detectChanges();

    http.expectOne((req) => req.url.includes('getMyStudentProfile')).flush(profile);
    http.expectOne((req) => req.url.includes('getProfileCatalog')).flush(catalog);
    if (profile.hasPhoto) {
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
    }

    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const html = () => fixture.nativeElement.innerHTML as string;
  const field = (id: string): HTMLInputElement => fixture.nativeElement.querySelector(`#${id}`);

  /** Type into a field exactly as a person would. */
  function type(id: string, value: string): void {
    const input = field(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * Read a PrimeNG input.
   *
   * PrimeNG 21 mixes plain `@Input()` properties with signal inputs, so an
   * assertion written for one shape silently passes on the other by comparing
   * against a function. Unwrapping here keeps every assertion honest.
   */
  function inputOf<T>(host: object, name: string): T {
    const value = (host as Record<string, unknown>)[name];
    return (typeof value === 'function' ? (value as () => unknown)() : value) as T;
  }

  /** The PrimeNG Select whose focus target carries this id. */
  function selectFor(inputId: string): DebugElement {
    const found = fixture.debugElement
      .queryAll(By.directive(Select))
      .find((entry) => inputOf<string>(entry.componentInstance, 'inputId') === inputId);
    expect(found, `no p-select with inputId ${inputId}`).toBeTruthy();
    return found as DebugElement;
  }

  function datePickerFor(inputId: string): DebugElement {
    const found = fixture.debugElement
      .queryAll(By.directive(DatePicker))
      .find((entry) => inputOf<string>(entry.componentInstance, 'inputId') === inputId);
    expect(found, `no p-datepicker with inputId ${inputId}`).toBeTruthy();
    return found as DebugElement;
  }

  /** Choose an option, going through the same output the template listens to. */
  function pick(inputId: string, value: string | null): void {
    const select = selectFor(inputId).componentInstance as Select;
    select.onChange.emit({ originalEvent: new Event('change'), value });
    fixture.detectChanges();
  }

  function pickDate(inputId: string, value: Date): void {
    const picker = datePickerFor(inputId).componentInstance as DatePicker;
    picker.onSelect.emit(value);
    fixture.detectChanges();
  }

  function chooseStatus(index: 0 | 1): void {
    const radios = fixture.nativeElement.querySelectorAll(
      'input[name="educationStatus"]',
    ) as NodeListOf<HTMLInputElement>;
    radios[index].click();
    fixture.detectChanges();
  }

  /**
   * A real, tiny WebP as a data URL — what the cropper hands back.
   *
   * Nothing decodes it in the browser, but keeping it a genuine WebP means the
   * `File` built from it carries bytes that would survive the backend's
   * signature check too.
   */
  const CROPPED_WEBP =
    'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

  /** The last config the cropper was opened with, so it can be asserted. */
  let lastCropperConfig: DynamicDialogConfig | undefined;

  /**
   * Stand in for the cropper dialog.
   *
   * The real one reads the file and renders a canvas, neither of which a
   * synthetic `File` in a test environment supports — and neither of which is
   * what these tests are about. `result` is what the Student ends up with:
   * a data URL when they confirm a crop, `undefined` when they dismiss.
   */
  function stubCropper(result: string | undefined): void {
    const dialogService = fixture.debugElement.injector.get(DialogService);
    vi.spyOn(dialogService, 'open').mockImplementation((_component, config) => {
      lastCropperConfig = config;
      return { onClose: of(result), close: () => undefined } as unknown as DynamicDialogRef;
    });
  }

  /**
   * Pick a file, then settle the cropper with `result`.
   *
   * `null` means the Student dismissed the dialog. It is a sentinel rather than
   * `undefined` on purpose: a defaulted parameter swallows an explicit
   * `undefined` and silently re-applies the default, so the dismissal case
   * would have quietly tested the confirm case instead.
   */
  function choosePhoto(
    result: string | null = CROPPED_WEBP,
    { size = 1024, mime = 'image/png', name = 'me.png' } = {},
  ): void {
    stubCropper(result === null ? undefined : result);
    const file = new File([new Uint8Array(size)], name, { type: mime });
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Fill every required field with something valid. */
  function fillRequired(): void {
    type('fullName', 'Lina Haddad');
    type('phone', '+963 944 123 456');
    pick('cityId', DAMASCUS.id);
    pick('institutionId', DAMASCUS_UNIVERSITY.id);
    pick('majorId', COMPUTER_ENGINEERING.id);
    chooseStatus(1);
  }

  function submit(): void {
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  /** The session refresh every successful save performs. */
  function flushSession(profileComplete = true): void {
    http
      .expectOne((req) => req.url.includes('getSession'))
      .flush({ id: 'u1', roles: ['Student'], profileComplete });
  }

  beforeEach(async () => setup());

  describe('form structure', () => {
    it('presents four labelled sections', () => {
      const sections = fixture.nativeElement.querySelectorAll('section[aria-labelledby]');
      expect(sections.length).toBe(4);
      for (const heading of ['Identity', 'Personal information', 'Education', 'Career and links']) {
        expect(text()).toContain(heading);
      }
    });

    it('has exactly one h1', () => {
      expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    });

    it('marks required fields and optional fields distinctly', () => {
      expect(fixture.nativeElement.querySelectorAll('.cyf-profile-required').length).toBeGreaterThan(4);
      expect(fixture.nativeElement.querySelectorAll('.cyf-profile-optional').length).toBeGreaterThan(3);
    });

    it('shows a real count of what is still required, not a percentage', () => {
      expect(text()).toMatch(/required field/i);
      expect(text()).not.toMatch(/\d+\s*%/);
    });
  });

  describe('verified email', () => {
    it('shows the address from the backend', () => {
      expect(field('verifiedEmail').value).toBe('lina@example.com');
    });

    it('is read-only and disabled', () => {
      expect(field('verifiedEmail').readOnly).toBe(true);
      expect(field('verifiedEmail').disabled).toBe(true);
    });

    it('explains why it cannot be changed', () => {
      expect(text()).toContain('Verified through your Google account');
    });

    it('is never sent back to the server', () => {
      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body).not.toHaveProperty('verifiedEmail');
      expect(request.request.body).not.toHaveProperty('email');
      request.flush(SAVED_PROFILE);
      flushSession();
    });
  });

  // ── The four catalog selects ──────────────────────────────────────────────

  describe('catalog selects', () => {
    for (const [label, inputId] of [
      ['City', 'cityId'],
      ['Institution', 'institutionId'],
      ['Major', 'majorId'],
      ['Target role', 'targetRoleId'],
    ] as const) {
      it(`renders ${label} as a searchable PrimeNG Select`, () => {
        const select = selectFor(inputId).componentInstance as Select;
        expect(select.filter, `${label} must be searchable`).toBe(true);
        expect(select.options?.length).toBeGreaterThan(0);
      });

      it(`does not render ${label} as free text`, () => {
        // A text input with this id would mean the catalog rule is bypassable.
        const input = fixture.nativeElement.querySelector(`input#${inputId}[type="text"]`);
        expect(input).toBeNull();
      });
    }

    it('uses no native HTML select anywhere on the form', () => {
      expect(fixture.nativeElement.querySelectorAll('select').length).toBe(0);
    });

    it('offers the catalog items, not a hard-coded list', () => {
      const cities = (selectFor('cityId').componentInstance as Select).options as {
        value: string;
        label: string;
      }[];
      expect(cities.map((option) => option.label)).toEqual(['Damascus', 'Aleppo']);
    });

    it('sends catalog ids, never names', () => {
      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));

      expect(request.request.body.cityId).toBe(DAMASCUS.id);
      expect(request.request.body.institutionId).toBe(DAMASCUS_UNIVERSITY.id);
      expect(request.request.body.majorId).toBe(COMPUTER_ENGINEERING.id);
      for (const forbidden of ['city', 'institution', 'major', 'targetRole']) {
        expect(request.request.body).not.toHaveProperty(forbidden);
      }
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('makes the optional target role clearable and the required ones not', () => {
      // Clearing a required selection would only produce a required error, so
      // the affordance is offered exactly where it means something.
      expect(inputOf(selectFor('targetRoleId').componentInstance, 'showClear')).toBe(true);
      for (const required of ['cityId', 'institutionId', 'majorId']) {
        expect(inputOf(selectFor(required).componentInstance, 'showClear')).toBeFalsy();
      }
    });

    it('shows the required error when a required select is left empty', () => {
      submit();
      expect(text()).toContain('This field is required');
      http.expectNone((req) => req.url.includes('saveMyStudentProfile'));
    });
  });

  describe('an empty catalog', () => {
    beforeEach(async () => setup(EMPTY_PROFILE, 'en', { CITY: [], INSTITUTION: [], MAJOR: [], TARGET_ROLE: [] }));

    it('says so plainly instead of showing an empty dropdown', () => {
      expect(text()).toContain('No options available yet');
    });

    it('disables the selects rather than pretending they work', () => {
      expect(inputOf(selectFor('cityId').componentInstance, 'disabled')).toBe(true);
    });

    it('offers no free-text fallback', () => {
      expect(fixture.nativeElement.querySelector('input#cityId[type="text"]')).toBeNull();
    });
  });

  describe('a catalog that fails to load', () => {
    it('states the problem rather than showing four empty selects', async () => {
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [StudentProfileComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([{ path: '**', component: StubComponent }]),
          provideTranslateService({ fallbackLang: 'en' }),
          MessageService,
          ConfirmationService,
        ],
      });
      useTranslations(TestBed.inject(TranslateService), 'en');
      http = TestBed.inject(HttpTestingController);
      TestBed.inject(SessionService).saveSession({ id: 'u1', roles: [AppRole.STUDENT] }, 'r:token');

      fixture = TestBed.createComponent(StudentProfileComponent);
      fixture.detectChanges();
      http.expectOne((req) => req.url.includes('getMyStudentProfile')).flush(EMPTY_PROFILE);
      http
        .expectOne((req) => req.url.includes('getProfileCatalog'))
        .flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).toContain('could not load the options');
    });
  });

  describe('institution', () => {
    it('shows no custom name field by default', () => {
      expect(fixture.nativeElement.querySelector('#customInstitutionName')).toBeNull();
    });

    it('reveals the custom name field for the catalog "Other" item', () => {
      pick('institutionId', OTHER_INSTITUTION.id);
      expect(fixture.nativeElement.querySelector('#customInstitutionName')).toBeTruthy();
    });

    it('does not reveal it for an ordinary institution', () => {
      pick('institutionId', DAMASCUS_UNIVERSITY.id);
      expect(fixture.nativeElement.querySelector('#customInstitutionName')).toBeNull();
    });

    it('requires the custom name once Other is chosen', () => {
      fillRequired();
      pick('institutionId', OTHER_INSTITUTION.id);
      submit();

      http.expectNone((req) => req.url.includes('saveMyStudentProfile'));
      expect(text()).toContain('This field is required');
    });

    it('hides and clears the custom name when another institution is chosen', () => {
      pick('institutionId', OTHER_INSTITUTION.id);
      type('customInstitutionName', 'Some College');
      pick('institutionId', HIAST.id);
      expect(fixture.nativeElement.querySelector('#customInstitutionName')).toBeNull();

      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body).not.toHaveProperty('customInstitutionName');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('shows University and Institute context in the options', () => {
      const options = (selectFor('institutionId').componentInstance as Select).options as {
        kind?: string;
      }[];
      expect(options.map((option) => option.kind)).toEqual(['UNIVERSITY', 'INSTITUTE', 'OTHER']);
    });
  });

  // ── Target role ───────────────────────────────────────────────────────────

  describe('target role and its reason', () => {
    it('hides the reason until a role is chosen', () => {
      expect(fixture.nativeElement.querySelector('#targetRoleReason')).toBeNull();
    });

    it('reveals the reason once a role is chosen', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      expect(fixture.nativeElement.querySelector('#targetRoleReason')).toBeTruthy();
    });

    it('labels it with the exact English question', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      const label = fixture.nativeElement.querySelector('label[for="targetRoleReason"]');
      expect(label.textContent).toContain('Why did you choose this role?');
    });

    it('hides and clears the reason when the role is cleared', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      type('targetRoleReason', 'I enjoy building interfaces.');
      pick('targetRoleId', null);

      expect(fixture.nativeElement.querySelector('#targetRoleReason')).toBeNull();

      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body).not.toHaveProperty('targetRoleId');
      expect(request.request.body).not.toHaveProperty('targetRoleReason');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('sends the reason only alongside the role', () => {
      fillRequired();
      pick('targetRoleId', FRONTEND_ROLE.id);
      type('targetRoleReason', 'I enjoy building interfaces.');
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body.targetRoleId).toBe(FRONTEND_ROLE.id);
      expect(request.request.body.targetRoleReason).toBe('I enjoy building interfaces.');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('caps the reason at 500 characters in the markup', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      const textarea = fixture.nativeElement.querySelector('#targetRoleReason');
      expect(textarea.getAttribute('maxlength')).toBe('500');
    });

    it('rejects a reason longer than 500 characters', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      type('targetRoleReason', 'x'.repeat(501));
      expect(text()).toContain('This is too long');
    });

    it('shows a character count only once something is typed', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      expect(fixture.nativeElement.querySelector('.cyf-field-count')).toBeNull();
      type('targetRoleReason', 'Because.');
      expect(fixture.nativeElement.querySelector('.cyf-field-count')).toBeTruthy();
      expect(text()).toContain('8 / 500');
    });

    it('never blocks a save, because it is optional', () => {
      fillRequired();
      pick('targetRoleId', FRONTEND_ROLE.id);
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      request.flush(SAVED_PROFILE);
      flushSession();
      fixture.detectChanges();
      expect(text()).toContain('Your profile has been saved');
    });

    it('is not counted among the outstanding required fields', () => {
      const before = text().match(/(\d+) required field/);
      pick('targetRoleId', FRONTEND_ROLE.id);
      const after = text().match(/(\d+) required field/);
      expect(after?.[1]).toBe(before?.[1]);
    });

    it('never presents itself as an evaluation', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);

      // A plain textarea and nothing else: no numeric input, no slider, no
      // star row, and no control that could record a judgement.
      const reason = fixture.nativeElement.querySelector('#targetRoleReason');
      expect(reason.tagName).toBe('TEXTAREA');
      expect(
        fixture.nativeElement.querySelectorAll(
          'input[type="number"], input[type="range"], p-rating, p-slider',
        ).length,
      ).toBe(0);

      // The only place the vocabulary appears is the sentence that rules it
      // out, so an accidental "score this role" heading would still fail.
      const lowered = text().toLowerCase();
      for (const forbidden of ['score', 'rating', 'rank', 'evaluat', 'assess']) {
        const occurrences = lowered.split(forbidden).length - 1;
        const inDisclaimer = lowered.includes('never scored or ranked') &&
          (forbidden === 'score' || forbidden === 'rank');
        expect(occurrences, forbidden).toBe(inDisclaimer ? 1 : 0);
      }
    });
  });

  // ── Date pickers ──────────────────────────────────────────────────────────

  describe('date of birth', () => {
    it('uses a PrimeNG DatePicker, not a native date input', () => {
      expect(datePickerFor('dateOfBirth')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('input[type="date"]')).toBeNull();
    });

    it('shows a calendar icon and a clear action', () => {
      const picker = datePickerFor('dateOfBirth').componentInstance as DatePicker;
      expect(picker.showIcon).toBe(true);
      expect(inputOf(picker, 'showClear')).toBe(true);
    });

    it('offers a full date, not just a month', () => {
      expect((datePickerFor('dateOfBirth').componentInstance as DatePicker).view).toBe('date');
    });

    it('refuses a future date by bounding the picker at today', () => {
      const picker = datePickerFor('dateOfBirth').componentInstance as DatePicker;
      expect(picker.maxDate).toBeInstanceOf(Date);
      expect((picker.maxDate as Date).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('sends the chosen day as YYYY-MM-DD', () => {
      fillRequired();
      pickDate('dateOfBirth', new Date(2001, 4, 9));
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body.dateOfBirth).toBe('2001-05-09');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('sends nothing when it is left empty', () => {
      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body).not.toHaveProperty('dateOfBirth');
      request.flush(SAVED_PROFILE);
      flushSession();
    });
  });

  describe('expected graduation', () => {
    it('offers exactly two education statuses', () => {
      expect(fixture.nativeElement.querySelectorAll('input[name="educationStatus"]').length).toBe(2);
      expect(text()).toContain('Current student');
      expect(text()).toContain('Graduate');
    });

    it('shows no graduation field until a status is chosen', () => {
      expect(fixture.nativeElement.querySelector('#expectedGraduationMonth')).toBeNull();
    });

    it('reveals a month/year DatePicker for a current student', () => {
      chooseStatus(0);
      const picker = datePickerFor('expectedGraduationMonth').componentInstance as DatePicker;
      expect(picker.view).toBe('month');
      expect(picker.dateFormat).toBe('mm/yy');
    });

    it('is not a native month input', () => {
      chooseStatus(0);
      expect(fixture.nativeElement.querySelector('input[type="month"]')).toBeNull();
    });

    it('hides it again for a graduate', () => {
      chooseStatus(0);
      chooseStatus(1);
      expect(fixture.debugElement.queryAll(By.directive(DatePicker)).length).toBe(1);
    });

    it('requires the month for a current student', () => {
      fillRequired();
      chooseStatus(0);
      submit();
      http.expectNone((req) => req.url.includes('saveMyStudentProfile'));
    });

    it('sends the month as YYYY-MM', () => {
      fillRequired();
      chooseStatus(0);
      pickDate('expectedGraduationMonth', new Date(2027, 5, 1));
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body.expectedGraduationMonth).toBe('2027-06');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('clears a chosen month when the Student switches to Graduate', () => {
      fillRequired();
      chooseStatus(0);
      pickDate('expectedGraduationMonth', new Date(2027, 5, 1));
      chooseStatus(1);
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body).not.toHaveProperty('expectedGraduationMonth');
      request.flush(SAVED_PROFILE);
      flushSession();
    });
  });

  describe('validation', () => {
    it('shows nothing before the user has touched a field', () => {
      expect(text()).not.toContain('This field is required');
    });

    it('marks an invalid field with aria-invalid', () => {
      submit();
      expect(field('fullName').getAttribute('aria-invalid')).toBe('true');
    });

    it('rejects a phone number that is not one', () => {
      type('phone', 'call me maybe');
      expect(text()).toContain('Please check this value');
    });

    it('accepts an international phone number', () => {
      type('phone', '+49 151 23456789');
      expect(text()).not.toContain('Please check this value');
    });

    for (const [label, value] of [
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a data: URL', 'data:text/html,<script>'],
      ['a non-URL', 'not a url'],
    ] as const) {
      it(`rejects ${label} in the portfolio field`, () => {
        type('portfolioUrl', value);
        expect(text()).toContain('Please check this value');
      });
    }

    it('requires a GitHub link to be on github.com', () => {
      type('githubUrl', 'https://example.com/lina');
      expect(text()).toContain('Please use a link from the expected website');
    });

    it('accepts a real GitHub profile', () => {
      type('githubUrl', 'https://github.com/lina');
      expect(text()).not.toContain('Please use a link from the expected website');
    });

    it('requires a LinkedIn link to be on linkedin.com', () => {
      type('linkedinUrl', 'https://github.com/lina');
      expect(text()).toContain('Please use a link from the expected website');
    });
  });

  describe('saving', () => {
    it('sends only the writable fields', () => {
      fillRequired();
      submit();
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));

      for (const forbidden of ['verifiedEmail', 'isComplete', 'user', 'id', 'photo', 'ACL']) {
        expect(request.request.body).not.toHaveProperty(forbidden);
      }
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('prevents a duplicate save while one is in flight', () => {
      fillRequired();
      submit();
      submit();

      // expectOne fails if a second save was opened.
      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('disables the button while saving', () => {
      fillRequired();
      submit();
      // PrimeNG puts styleClass on the button element itself.
      const button = fixture.nativeElement.querySelector('button.cyf-profile-save-btn');
      expect(button.disabled).toBe(true);
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      flushSession();
    });

    it('confirms success and refreshes the session', () => {
      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      flushSession();
      fixture.detectChanges();
      expect(text()).toContain('Your profile has been saved');
    });

    it('navigates to the welcome page once the profile is complete', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      flushSession();
      await fixture.whenStable();

      expect(navigate).toHaveBeenCalledWith(['/student/welcome']);
    });

    it('shows the backend-unavailable state', () => {
      fillRequired();
      submit();
      http
        .expectOne((req) => req.url.includes('saveMyStudentProfile'))
        .flush(null, { status: 0, statusText: 'Offline' });
      fixture.detectChanges();
      expect(text()).toContain('cannot reach the server');
    });

    it('shows per-field messages from a backend rejection', () => {
      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(
        { code: 142, error: 'VALIDATION_FAILED:{"phone":"INVALID","cityId":"NOT_ALLOWED"}' },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).toContain('Please check this value');
      expect(text()).toContain('This value is not accepted');
    });

    it('renders no raw backend string', () => {
      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(
        { code: 1, error: 'PROFILE_SAVE_FAILED', stack: 'at repository.js:88' },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(text()).not.toContain('PROFILE_SAVE_FAILED');
      expect(text()).not.toContain('repository.js');
    });
  });

  describe('unsaved changes', () => {
    it('says nothing before an edit', () => {
      expect(text()).not.toContain('unsaved changes');
    });

    it('warns after an edit', () => {
      pick('cityId', DAMASCUS.id);
      expect(text()).toContain('You have unsaved changes');
    });

    it('clears the warning once saved', () => {
      fillRequired();
      expect(text()).toContain('You have unsaved changes');

      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      flushSession();
      fixture.detectChanges();

      expect(text()).not.toContain('You have unsaved changes');
    });
  });

  describe('editing an existing profile', () => {
    beforeEach(async () => setup(SAVED_PROFILE));

    it('loads the saved values into the form', () => {
      expect(field('fullName').value).toBe('Lina Haddad');
      expect((selectFor('cityId').componentInstance as Select).modelValue()).toBe(DAMASCUS.id);
      expect((selectFor('majorId').componentInstance as Select).modelValue()).toBe(
        COMPUTER_ENGINEERING.id,
      );
    });

    it('uses the editing heading', () => {
      expect(text()).toContain('Your profile');
      expect(text()).not.toContain('Complete your profile');
    });

    it('offers a way back to the welcome page', () => {
      expect(fixture.nativeElement.querySelector('.cyf-profile-back-btn')).toBeTruthy();
    });

    it('shows no outstanding-fields notice', () => {
      expect(text()).not.toMatch(/required field/i);
    });
  });

  describe('a selection an Admin has since retired', () => {
    it('still shows the stored value, marked as no longer offered', async () => {
      const retiredCity = { ...DAMASCUS, active: false };
      await setup({ ...SAVED_PROFILE, city: retiredCity }, 'en', {
        ...CATALOG,
        CITY: [ALEPPO],
      });

      const options = (selectFor('cityId').componentInstance as Select).options as {
        value: string;
        retired: boolean;
      }[];
      expect(options.map((option) => option.value)).toContain(DAMASCUS.id);
      expect(options.find((option) => option.value === DAMASCUS.id)?.retired).toBe(true);
    });
  });

  // ── The first-save photo flow ─────────────────────────────────────────────

  describe('choosing a photo before the profile exists', () => {
    it('uploads nothing on selection — it is a local preview', () => {
      choosePhoto();
      // The old behaviour uploaded here, against a profile that did not exist.
      http.expectNone((req) => req.url.includes('profile-photo'));
      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeTruthy();
    });

    it('says the photo will be sent with the next save', () => {
      choosePhoto();
      expect(text()).toContain('will be uploaded when you save');
    });

    it('counts as an unsaved change', () => {
      choosePhoto();
      expect(text()).toContain('You have unsaved changes');
    });

    it('saves the profile first, then uploads — never the other way round', () => {
      fillRequired();
      choosePhoto();
      submit();

      // Only the save is open at this point.
      http.expectNone((req) => req.url.includes('profile-photo'));
      const save = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      save.flush(SAVED_PROFILE);
      fixture.detectChanges();

      const upload = http.expectOne((req) => req.url.includes('profile-photo'));
      expect(upload.request.method).toBe('POST');
      expect(upload.request.body).toBeInstanceOf(FormData);
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });

      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('sends the image as multipart, never as base64 in a JSON body', () => {
      fillRequired();
      choosePhoto();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();

      const upload = http.expectOne((req) => req.url.includes('profile-photo'));
      const body = upload.request.body as FormData;
      expect(body.get('photo')).toBeInstanceOf(File);
      expect(JSON.stringify(upload.request.body)).not.toContain('base64');
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });
      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('does not upload when the profile save fails', () => {
      fillRequired();
      choosePhoto();
      submit();
      http
        .expectOne((req) => req.url.includes('saveMyStudentProfile'))
        .flush({ code: 142, error: 'VALIDATION_FAILED:{"phone":"INVALID"}' }, {
          status: 400,
          statusText: 'Bad Request',
        });
      fixture.detectChanges();

      http.expectNone((req) => req.url.includes('profile-photo'));
    });

    it('keeps the saved profile and offers a retry when only the upload fails', () => {
      fillRequired();
      choosePhoto();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush({ error: 'PHOTO_REJECTED' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(text()).toContain('Your details were saved');
      expect(text()).toContain('Try uploading it again');
      // The profile is not re-saved and nothing is rolled back.
      http.expectNone((req) => req.url.includes('saveMyStudentProfile'));
    });

    it('retries only the photo, without touching the form', () => {
      fillRequired();
      choosePhoto();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush({ error: 'PHOTO_REJECTED' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      const retry = fixture.nativeElement.querySelector('.cyf-profile-retry') as HTMLButtonElement;
      retry.click();
      fixture.detectChanges();

      http.expectNone((req) => req.url.includes('saveMyStudentProfile'));
      const upload = http.expectOne((req) => req.url.includes('profile-photo'));
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });
      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('never opens two uploads for one save', () => {
      fillRequired();
      choosePhoto();
      submit();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();

      const upload = http.expectOne((req) => req.url.includes('profile-photo'));
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });
      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('rejects an oversized file in the browser, before any request', () => {
      choosePhoto(CROPPED_WEBP, { size: 6 * 1024 * 1024 });
      http.expectNone((req) => req.url.includes('profile-photo'));
      expect(text()).toContain('too large');
    });

    it('rejects a type the backend would not accept', () => {
      choosePhoto(CROPPED_WEBP, { mime: 'application/pdf', name: 'cv.pdf' });
      http.expectNone((req) => req.url.includes('profile-photo'));
      expect(text()).toContain('could not be used');
    });

    it('discards a pending photo locally without calling the server', () => {
      choosePhoto();
      const remove = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
        (button as HTMLElement).textContent?.includes('Remove photo'),
      ) as HTMLButtonElement;
      remove.click();
      fixture.detectChanges();

      http.expectNone((req) => req.url.includes('profile-photo'));
      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeNull();
    });
  });

  describe('framing the photo', () => {
    it('opens the cropper instead of keeping the raw file', () => {
      choosePhoto();
      expect(lastCropperConfig).toBeTruthy();
    });

    it('asks for a square crop, to match the circular avatar', () => {
      choosePhoto();
      const data = lastCropperConfig?.data as Record<string, unknown>;
      expect(data['aspectRatio']).toBe(1);
      expect(data['maintainAspectRatio']).toBe(true);
    });

    it('asks for WebP, which is what gets stored anyway', () => {
      choosePhoto();
      const data = lastCropperConfig?.data as Record<string, unknown>;
      expect(data['format']).toBe('webp');
    });

    it('hands the chosen file to the cropper, not a copy of its name', () => {
      choosePhoto();
      const data = lastCropperConfig?.data as Record<string, unknown>;
      expect(data['imageFile']).toBeInstanceOf(File);
    });

    it('uploads nothing while the cropper is open or after it closes', () => {
      choosePhoto();
      http.expectNone((req) => req.url.includes('profile-photo'));
    });

    it('keeps the cropped result, not the file that was picked', () => {
      choosePhoto();
      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();

      const upload = http.expectOne((req) => req.url.includes('profile-photo'));
      const sent = (upload.request.body as FormData).get('photo') as File;
      // The cropper produced a WebP; the picked file was a PNG called me.png.
      expect(sent.type).toBe('image/webp');
      expect(sent.name).toBe('profile-photo.webp');
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });
      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('previews the cropped image, not the original', () => {
      choosePhoto();
      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeTruthy();
      expect(text()).toContain('will be uploaded when you save');
    });

    it('changes nothing when the Student dismisses the cropper', () => {
      choosePhoto(null);
      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeNull();
      expect(text()).not.toContain('will be uploaded when you save');
      http.expectNone((req) => req.url.includes('profile-photo'));
    });

    it('leaves an existing photo alone when the cropper is dismissed', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true });
      choosePhoto(null);

      // Still showing what was already there; nothing was sent or removed.
      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeTruthy();
      http.expectNone((req) => req.url.includes('profile-photo'));
      http.expectNone((req) => req.url.includes('removeMyProfilePhoto'));
    });

    it('never opens the cropper for a file the backend would refuse', () => {
      lastCropperConfig = undefined;
      choosePhoto(CROPPED_WEBP, { mime: 'application/pdf', name: 'cv.pdf' });
      expect(lastCropperConfig).toBeUndefined();
      expect(text()).toContain('could not be used');
    });

    it('never opens the cropper for an oversized file', () => {
      lastCropperConfig = undefined;
      choosePhoto(CROPPED_WEBP, { size: 6 * 1024 * 1024 });
      expect(lastCropperConfig).toBeUndefined();
      expect(text()).toContain('too large');
    });

    it('refuses a crop result that is not an accepted image type', () => {
      choosePhoto('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
      expect(text()).toContain('could not be used');
      http.expectNone((req) => req.url.includes('profile-photo'));
    });

    it('refuses a crop result that is not a data URL at all', () => {
      choosePhoto('https://example.test/not-a-data-url.png');
      expect(text()).toContain('could not be used');
    });

    it('opens the dialog in the reading direction of the page', async () => {
      await setup(EMPTY_PROFILE, 'ar');
      choosePhoto();
      const style = lastCropperConfig?.style as Record<string, unknown>;
      expect(style['direction']).toBe('rtl');
    });
  });

  describe('an existing photo', () => {
    it('renders from a blob object URL, never a remote URL', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true, photoVersion: 'f1-1' });
      const img = fixture.nativeElement.querySelector('.cyf-avatar-img');
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toMatch(/^blob:/);
      expect(img.getAttribute('src')).not.toContain('http://');
    });

    it('offers replace and remove', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true });
      expect(text()).toContain('Replace photo');
      expect(text()).toContain('Remove photo');
    });

    it('removes it through the API', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true });
      const remove = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
        (button as HTMLElement).textContent?.includes('Remove photo'),
      ) as HTMLButtonElement;
      remove.click();
      fixture.detectChanges();

      const request = http.expectOne((req) => req.url.includes('removeMyProfilePhoto'));
      expect(request.request.method).toBe('POST');
      request.flush({ ...SAVED_PROFILE, hasPhoto: false });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeNull();
    });

    it('accepts only the shared image types', () => {
      const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toContain('image/jpeg');
      expect(input.accept).toContain('image/png');
      expect(input.accept).toContain('image/webp');
      expect(input.accept).not.toContain('image/svg');
    });

    it('states the size limit', () => {
      expect(text()).toContain('5 MB');
    });
  });

  describe('no fake product data', () => {
    it('shows no percentage or statistic', () => {
      expect(text()).not.toMatch(/\d+\s*%/);
      expect(fixture.nativeElement.querySelectorAll('p-chart, p-progressbar, canvas').length).toBe(0);
    });

    it('offers no prohibited field', () => {
      const lowered = html().toLowerCase();
      for (const forbidden of ['salary', 'years of experience', 'skill rating', 'biography']) {
        expect(lowered).not.toContain(forbidden);
      }
    });

    it('adds no country, timezone, or remote-attendance field', () => {
      // Asserted against the *controls*, not the prose: the phone helper
      // legitimately mentions a country code, and matching on words alone
      // would fail for the wrong reason.
      const controls = [
        ...fixture.nativeElement.querySelectorAll('input, textarea, select, p-select, p-datepicker'),
      ] as HTMLElement[];

      for (const control of controls) {
        const identity = [
          control.getAttribute('id'),
          control.getAttribute('name'),
          control.getAttribute('inputid'),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        for (const forbidden of ['country', 'timezone', 'utc', 'remote', 'meeting']) {
          expect(identity, `${identity} must not be a ${forbidden} field`).not.toContain(forbidden);
        }
      }

      // And no label offers one either.
      const labels = [...fixture.nativeElement.querySelectorAll('label')] as HTMLElement[];
      const labelText = labels.map((label) => label.textContent?.toLowerCase() ?? '').join(' | ');
      for (const forbidden of ['country', 'timezone', 'time zone']) {
        expect(labelText).not.toContain(forbidden);
      }
    });

    it('mentions no future product feature', () => {
      const lowered = text().toLowerCase();
      for (const forbidden of ['batch', 'invitation', 'enrol', 'task', 'talent reel', 'live slide']) {
        expect(lowered).not.toContain(forbidden);
      }
    });

    it('offers only one education record', () => {
      expect(fixture.debugElement.queryAll(By.directive(Select)).length).toBe(4);
      expect(text().toLowerCase()).not.toContain('add education');
    });
  });

  describe('Arabic', () => {
    beforeEach(async () => setup(EMPTY_PROFILE, 'ar'));

    it('renders the Arabic heading', () => {
      expect(fixture.nativeElement.querySelector('h1').textContent).toContain('أكمل ملفك الشخصي');
    });

    it('renders Arabic section headings', () => {
      expect(text()).toContain('المعلومات الشخصية');
      expect(text()).toContain('التعليم');
    });

    it('renders Arabic validation messages', () => {
      submit();
      expect(text()).toContain('هذا الحقل مطلوب');
    });

    it('labels the target-role question with the exact Arabic text', () => {
      pick('targetRoleId', FRONTEND_ROLE.id);
      const label = fixture.nativeElement.querySelector('label[for="targetRoleReason"]');
      expect(label.textContent).toContain('لماذا اخترت هذا الدور؟');
    });

    it('shows catalog option labels in Arabic', () => {
      const options = (selectFor('cityId').componentInstance as Select).options as {
        label: string;
      }[];
      expect(options.map((option) => option.label)).toEqual(['دمشق', 'حلب']);
    });

    it('requests the catalog in Arabic, so the server sorts it in Arabic', async () => {
      // The initial load already used `lang=ar`; assert it explicitly.
      expect(localStorage.getItem('lang')).toBe('ar');
    });

    it('leaves no untranslated English marker', () => {
      expect(text()).not.toContain('Complete your profile');
      expect(text()).not.toContain('This field is required');
    });

    it('keeps phone and URL fields left-to-right inside an RTL page', () => {
      expect(field('phone').getAttribute('dir')).toBe('ltr');
      expect(field('githubUrl').getAttribute('dir')).toBe('ltr');
    });
  });

  // ── The Google name and photo ─────────────────────────────────────────────

  describe('a name suggested by Google', () => {
    const PREFILLED: StudentProfile = {
      ...EMPTY_PROFILE,
      fullName: 'Lina Haddad',
      nameFromProvider: true,
    };

    it('arrives already in the field', async () => {
      await setup(PREFILLED);
      expect(field('fullName').value).toBe('Lina Haddad');
    });

    it('says where it came from and that it can be changed', async () => {
      await setup(PREFILLED);
      expect(text()).toContain('Taken from your Google account');
    });

    it('stops saying so the moment it is edited', async () => {
      await setup(PREFILLED);
      type('fullName', 'Lina H.');
      expect(text()).not.toContain('Taken from your Google account');
    });

    it('says nothing when Google supplied no name', async () => {
      await setup(EMPTY_PROFILE);
      expect(field('fullName').value).toBe('');
      expect(text()).not.toContain('Taken from your Google account');
    });

    it('says nothing on a profile that has already been saved', async () => {
      await setup(SAVED_PROFILE);
      expect(text()).not.toContain('Taken from your Google account');
    });

    it('sends whatever the Student submits, not what Google suggested', async () => {
      await setup(PREFILLED);
      type('fullName', 'Lina Al-Haddad');
      type('phone', '+963 944 123 456');
      pick('cityId', DAMASCUS.id);
      pick('institutionId', DAMASCUS_UNIVERSITY.id);
      pick('majorId', COMPUTER_ENGINEERING.id);
      chooseStatus(1);
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body.fullName).toBe('Lina Al-Haddad');
      expect(request.request.body).not.toHaveProperty('nameFromProvider');
      request.flush(SAVED_PROFILE);
      flushSession();
    });

    it('accepts the suggestion unchanged if that is what the Student wants', async () => {
      await setup(PREFILLED);
      type('phone', '+963 944 123 456');
      pick('cityId', DAMASCUS.id);
      pick('institutionId', DAMASCUS_UNIVERSITY.id);
      pick('majorId', COMPUTER_ENGINEERING.id);
      chooseStatus(1);
      submit();

      const request = http.expectOne((req) => req.url.includes('saveMyStudentProfile'));
      expect(request.request.body.fullName).toBe('Lina Haddad');
      request.flush(SAVED_PROFILE);
      flushSession();
    });
  });

  describe('a photo imported from Google', () => {
    it('is fetched once the creating save reports one', () => {
      fillRequired();
      submit();
      // The server imported the avatar while creating the profile, so the DTO
      // reports a photo that was never uploaded from here.
      http
        .expectOne((req) => req.url.includes('saveMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true, photoVersion: 'p1-1' });
      fixture.detectChanges();

      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
      flushSession();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeTruthy();
    });

    it('is not fetched when the save reports no photo', () => {
      fillRequired();
      submit();
      http.expectOne((req) => req.url.includes('saveMyStudentProfile')).flush(SAVED_PROFILE);
      fixture.detectChanges();

      http.expectNone((req) => req.url.includes('profile-photo'));
      flushSession();
    });

    it('does not overwrite a photo the Student chose themselves', () => {
      choosePhoto();

      fillRequired();
      submit();
      // Even though the creating save reports an imported photo, the Student's
      // own file is uploaded and replaces it.
      http
        .expectOne((req) => req.url.includes('saveMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      fixture.detectChanges();

      const upload = http.expectOne(
        (req) => req.url.includes('profile-photo') && req.method === 'POST',
      );
      expect(upload.request.body).toBeInstanceOf(FormData);
      upload.flush({ ok: true, mimeType: 'image/webp', bytes: 900 });
      http
        .expectOne((req) => req.url.includes('getMyStudentProfile'))
        .flush({ ...SAVED_PROFILE, hasPhoto: true });
      http
        .expectOne((req) => req.url.includes('profile-photo'))
        .flush(new Blob([new Uint8Array([1])], { type: 'image/webp' }));
      flushSession();
    });

    it('can be removed like any other, and removal is a server call', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true });
      const remove = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
        (button as HTMLElement).textContent?.includes('Remove photo'),
      ) as HTMLButtonElement;
      remove.click();
      fixture.detectChanges();

      http
        .expectOne((req) => req.url.includes('removeMyProfilePhoto'))
        .flush({ ...SAVED_PROFILE, hasPhoto: false });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.cyf-avatar-img')).toBeNull();
    });

    it('never exposes a Google URL to the browser', async () => {
      await setup({ ...SAVED_PROFILE, hasPhoto: true });
      const markup = html();
      for (const forbidden of ['googleusercontent', 'lh3.google', 'pictureUrl']) {
        expect(markup).not.toContain(forbidden);
      }
      const img = fixture.nativeElement.querySelector('.cyf-avatar-img');
      expect(img.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  describe('layout safety', () => {
    it('declares no fixed pixel width', () => {
      expect(html()).not.toMatch(/style="[^"]*width:\s*\d+px/);
    });

    it('renders no page frame of its own ⟨CP4 closeout⟩', () => {
      // The skip link and the `main` landmark moved to the shared shell, which
      // now wraps every protected page. A page that still supplied its own
      // would produce two landmarks and a second skip target — see
      // `shell.component.spec.ts`, where both are asserted.
      expect(fixture.nativeElement.querySelectorAll('main').length).toBe(0);
      expect(fixture.nativeElement.querySelector('.cyf-skip-link')).toBeNull();
    });

    it('renders no navigation of its own', () => {
      // One primary navigation, in the sidebar. A second here would be two
      // places to keep in step and two active states to disagree.
      expect(fixture.nativeElement.querySelectorAll('nav').length).toBe(0);
    });

    it('renders every overlay into the body, so no card can clip a dropdown', () => {
      const overlays = [
        ...fixture.debugElement.queryAll(By.directive(Select)),
        ...fixture.debugElement.queryAll(By.directive(DatePicker)),
      ];
      expect(overlays.length).toBeGreaterThan(0);
      for (const entry of overlays) {
        expect(inputOf(entry.componentInstance, 'appendTo')).toBe('body');
      }
    });
  });
});
