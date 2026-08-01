import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { ProfileCatalogItem } from '../../models/ProfileCatalogItem';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { CATALOG_TYPES } from '../../utils/profile-catalog-constants';
import { ProfileCatalogsComponent } from './profile-catalogs.component';

/**
 * Profile Catalogs — the Admin screen.
 *
 * Nothing here contacts a real backend: `HttpTestingController` intercepts every
 * call, and `verify()` fails the test if a request was opened that the test did
 * not expect.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

const DAMASCUS: ProfileCatalogItem = {
  id: 'c1',
  type: 'CITY',
  code: 'DAMASCUS',
  nameEn: 'Damascus',
  nameAr: 'دمشق',
  active: true,
  sortOrder: 10,
};

const ALEPPO: ProfileCatalogItem = {
  id: 'c2',
  type: 'CITY',
  code: 'ALEPPO',
  nameEn: 'Aleppo',
  nameAr: 'حلب',
  active: false,
  sortOrder: 20,
};

describe('ProfileCatalogsComponent', () => {
  let fixture: ComponentFixture<ProfileCatalogsComponent>;
  let http: HttpTestingController;

  async function setup(
    items: ProfileCatalogItem[] = [DAMASCUS, ALEPPO],
    lang: 'en' | 'ar' = 'en',
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProfileCatalogsComponent],
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

    TestBed.inject(SessionService).saveSession({ id: 'a1', roles: [AppRole.ADMIN] }, 'r:token');

    fixture = TestBed.createComponent(ProfileCatalogsComponent);
    fixture.detectChanges();

    http
      .expectOne((req) => req.url.includes('listProfileCatalogItems'))
      .flush({ type: 'CITY', items, supportsOther: false });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const rows = () => fixture.nativeElement.querySelectorAll('tbody tr');
  const tabs = () =>
    [...fixture.nativeElement.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];

  function clickText(needle: string): void {
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((entry) =>
      (entry as HTMLElement).textContent?.includes(needle),
    ) as HTMLButtonElement;
    expect(button, `no button containing "${needle}"`).toBeTruthy();
    button.click();
    fixture.detectChanges();
  }

  function typeInto(id: string, value: string): void {
    const input = document.querySelector(`#${id}`) as HTMLInputElement;
    expect(input, `no field #${id}`).toBeTruthy();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => setup());

  describe('tabs', () => {
    it('offers exactly the four approved categories', () => {
      expect(tabs().length).toBe(4);
      expect(CATALOG_TYPES.length).toBe(4);
      for (const label of ['Cities', 'Universities & Institutes', 'Majors', 'Target Roles']) {
        expect(text()).toContain(label);
      }
    });

    it('starts on Cities and marks it selected', () => {
      expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs()[1].getAttribute('aria-selected')).toBe('false');
    });

    it('loads only the chosen category when a tab is clicked', () => {
      tabs()[2].click();
      fixture.detectChanges();

      const request = http.expectOne((req) => req.url.includes('listProfileCatalogItems'));
      expect(request.request.params.get('type')).toBe('MAJOR');
      request.flush({ type: 'MAJOR', items: [], supportsOther: false });
    });

    it('never asks for a category outside the allow-list', () => {
      for (const tab of tabs()) {
        tab.click();
        fixture.detectChanges();
        const pending = http.match((req) => req.url.includes('listProfileCatalogItems'));
        for (const request of pending) {
          const type = request.request.params.get('type');
          expect(CATALOG_TYPES as readonly string[]).toContain(type);
          request.flush({ type, items: [], supportsOther: false });
        }
      }
    });
  });

  describe('the list', () => {
    it('shows every item, active and inactive alike', () => {
      expect(rows().length).toBe(2);
      expect(text()).toContain('Damascus');
      expect(text()).toContain('Aleppo');
    });

    it('shows both names and the code', () => {
      expect(text()).toContain('دمشق');
      expect(text()).toContain('DAMASCUS');
    });

    it('labels the status in words, never by colour alone', () => {
      expect(text()).toContain('Active');
      expect(text()).toContain('Inactive');
    });

    it('filters as you type, without a server round trip', () => {
      const search = fixture.nativeElement.querySelector('#catalog-search') as HTMLInputElement;
      search.value = 'aleppo';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(rows().length).toBe(1);
      expect(text()).toContain('Aleppo');
      http.expectNone((req) => req.url.includes('listProfileCatalogItems'));
    });

    it('says so when nothing matches', () => {
      const search = fixture.nativeElement.querySelector('#catalog-search') as HTMLInputElement;
      search.value = 'nowhere';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(text()).toContain('Nothing matches your search');
    });

    it('gives every row action an accessible name', () => {
      const buttons = [
        ...fixture.nativeElement.querySelectorAll('.cyf-catalogs-actions button'),
      ] as HTMLElement[];
      expect(buttons.length).toBe(6);
      for (const button of buttons) {
        expect(button.getAttribute('aria-label')).toBeTruthy();
      }
    });
  });

  describe('an empty category', () => {
    beforeEach(async () => setup([]));

    it('says it is empty rather than inventing data', () => {
      expect(text()).toContain('No items yet');
      expect(rows().length).toBe(0);
    });

    it('explains what a Student will see until it is filled in', () => {
      expect(text()).toContain('No options available');
    });

    it('offers a way to add the first item', () => {
      expect(text()).toContain('Add item');
    });
  });

  describe('creating', () => {
    it('opens a dialog with both name fields and a code', () => {
      clickText('Add item');
      expect(document.querySelector('#catalog-nameEn')).toBeTruthy();
      expect(document.querySelector('#catalog-nameAr')).toBeTruthy();
      expect(document.querySelector('#catalog-code')).toBeTruthy();
    });

    it('previews the normalised code before saving', () => {
      clickText('Add item');
      typeInto('catalog-code', 'Damascus Univ.');
      expect(document.body.textContent).toContain('DAMASCUS_UNIV');
    });

    it('sends the category with the item', () => {
      clickText('Add item');
      typeInto('catalog-nameEn', 'Homs');
      typeInto('catalog-nameAr', 'حمص');
      typeInto('catalog-code', 'HOMS');
      clickText('Save');

      const request = http.expectOne((req) => req.url.includes('createProfileCatalogItem'));
      expect(request.request.body.type).toBe('CITY');
      expect(request.request.body.nameEn).toBe('Homs');
      request.flush({ ...DAMASCUS, id: 'c3', code: 'HOMS', nameEn: 'Homs', nameAr: 'حمص' });

      http
        .expectOne((req) => req.url.includes('listProfileCatalogItems'))
        .flush({ type: 'CITY', items: [DAMASCUS], supportsOther: false });
    });

    it('sends no institution-only field for a city', () => {
      clickText('Add item');
      typeInto('catalog-nameEn', 'Homs');
      typeInto('catalog-nameAr', 'حمص');
      typeInto('catalog-code', 'HOMS');
      clickText('Save');

      const request = http.expectOne((req) => req.url.includes('createProfileCatalogItem'));
      expect(request.request.body).not.toHaveProperty('institutionKind');
      expect(request.request.body).not.toHaveProperty('isOther');
      request.flush(DAMASCUS);
      http
        .expectOne((req) => req.url.includes('listProfileCatalogItems'))
        .flush({ type: 'CITY', items: [DAMASCUS], supportsOther: false });
    });

    it('shows the duplicate-code message from the backend', () => {
      clickText('Add item');
      typeInto('catalog-nameEn', 'Damascus');
      typeInto('catalog-nameAr', 'دمشق');
      typeInto('catalog-code', 'DAMASCUS');
      clickText('Save');

      http
        .expectOne((req) => req.url.includes('createProfileCatalogItem'))
        .flush({ error: 'CATALOG_DUPLICATE' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(text()).toContain('already uses that code');
    });

    it('shows per-field messages from a backend rejection', () => {
      clickText('Add item');
      typeInto('catalog-code', 'X');
      clickText('Save');

      http.expectOne((req) => req.url.includes('createProfileCatalogItem')).flush(
        { error: 'CATALOG_VALIDATION_FAILED:{"nameEn":"REQUIRED","code":"TOO_SHORT"}' },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();

      expect(document.body.textContent).toContain('This field is required');
      expect(document.body.textContent).toContain('This is too short');
    });
  });

  describe('institutions', () => {
    beforeEach(async () => {
      await setup();
      tabs()[1].click();
      fixture.detectChanges();
      http.expectOne((req) => req.url.includes('listProfileCatalogItems')).flush({
        type: 'INSTITUTION',
        items: [
          {
            id: 'i1',
            type: 'INSTITUTION',
            code: 'DAMASCUS_UNIVERSITY',
            nameEn: 'Damascus University',
            nameAr: 'جامعة دمشق',
            active: true,
            sortOrder: 10,
            institutionKind: 'UNIVERSITY',
          },
        ],
        supportsOther: true,
      });
      await fixture.whenStable();
      fixture.detectChanges();
    });

    it('shows a Kind column that other categories do not have', () => {
      expect(text()).toContain('Kind');
      expect(text()).toContain('University');
    });

    it('offers University, Institute, and Other in the dialog', () => {
      clickText('Add item');
      expect(document.querySelector('#catalog-kind')).toBeTruthy();
    });

    it('offers the "Other" flag only where the backend supports it', () => {
      clickText('Add item');
      expect(document.body.textContent).toContain('This is the "Other" option');
    });

    it('sends the kind with an institution', () => {
      clickText('Add item');
      typeInto('catalog-nameEn', 'New University');
      typeInto('catalog-nameAr', 'جامعة جديدة');
      typeInto('catalog-code', 'NEW_UNIVERSITY');
      clickText('Save');

      const request = http.expectOne((req) => req.url.includes('createProfileCatalogItem'));
      expect(request.request.body.type).toBe('INSTITUTION');
      expect(request.request.body.institutionKind).toBe('UNIVERSITY');
      request.flush({ id: 'i2', type: 'INSTITUTION', code: 'NEW_UNIVERSITY', nameEn: 'x', nameAr: 'x', active: true, sortOrder: 20 });
      http
        .expectOne((req) => req.url.includes('listProfileCatalogItems'))
        .flush({ type: 'INSTITUTION', items: [], supportsOther: true });
    });
  });

  describe('editing', () => {
    it('loads the item into the dialog', () => {
      clickText('');
      const edit = fixture.nativeElement.querySelectorAll(
        '.cyf-catalogs-actions button',
      )[0] as HTMLButtonElement;
      edit.click();
      fixture.detectChanges();

      expect((document.querySelector('#catalog-nameEn') as HTMLInputElement).value).toBe('Damascus');
      expect((document.querySelector('#catalog-nameAr') as HTMLInputElement).value).toBe('دمشق');
    });

    it('sends the id and the category', () => {
      const edit = fixture.nativeElement.querySelectorAll(
        '.cyf-catalogs-actions button',
      )[0] as HTMLButtonElement;
      edit.click();
      fixture.detectChanges();
      clickText('Save');

      const request = http.expectOne((req) => req.url.includes('updateProfileCatalogItem'));
      expect(request.request.body.id).toBe(DAMASCUS.id);
      expect(request.request.body.type).toBe('CITY');
      request.flush(DAMASCUS);
      http
        .expectOne((req) => req.url.includes('listProfileCatalogItems'))
        .flush({ type: 'CITY', items: [DAMASCUS], supportsOther: false });
    });
  });

  describe('activation', () => {
    it('deactivates an active item', () => {
      const toggle = fixture.nativeElement.querySelectorAll(
        '.cyf-catalogs-actions button',
      )[1] as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      const request = http.expectOne((req) => req.url.includes('setProfileCatalogItemActive'));
      expect(request.request.body).toEqual({ id: DAMASCUS.id, type: 'CITY', active: false });
      request.flush({ ...DAMASCUS, active: false });
      fixture.detectChanges();

      expect(text()).toContain('Item deactivated');
    });

    it('reactivates an inactive item', () => {
      const toggle = fixture.nativeElement.querySelectorAll(
        '.cyf-catalogs-actions button',
      )[4] as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      const request = http.expectOne((req) => req.url.includes('setProfileCatalogItemActive'));
      expect(request.request.body.active).toBe(true);
      request.flush({ ...ALEPPO, active: true });
      fixture.detectChanges();

      expect(text()).toContain('Item activated');
    });

    it('explains that a deactivated item stays on existing profiles', () => {
      clickText('Add item');
      expect(document.body.textContent).toContain('stay on the profiles that already use them');
    });
  });

  describe('deleting', () => {
    function openDelete(): void {
      const remove = fixture.nativeElement.querySelectorAll(
        '.cyf-catalogs-actions button',
      )[2] as HTMLButtonElement;
      remove.click();
      fixture.detectChanges();
    }

    it('confirms before deleting, and sends nothing until confirmed', () => {
      openDelete();
      expect(document.body.textContent).toContain('Delete this item?');
      http.expectNone((req) => req.url.includes('deleteProfileCatalogItem'));
    });

    it('warns that a referenced item cannot be deleted', () => {
      openDelete();
      expect(document.body.textContent).toContain('cannot be deleted');
    });

    it('deletes an unused item', () => {
      openDelete();
      clickText('Delete');

      const request = http.expectOne((req) => req.url.includes('deleteProfileCatalogItem'));
      expect(request.request.body).toEqual({ id: DAMASCUS.id, type: 'CITY' });
      request.flush({ id: DAMASCUS.id, deleted: true });
      fixture.detectChanges();

      expect(text()).toContain('Item deleted');
      expect(rows().length).toBe(1);
    });

    it('explains CATALOG_IN_USE and points at deactivation instead', () => {
      openDelete();
      clickText('Delete');
      http
        .expectOne((req) => req.url.includes('deleteProfileCatalogItem'))
        .flush({ error: 'CATALOG_IN_USE' }, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();

      expect(text()).toContain('cannot be deleted because a Student profile uses it');
      expect(text()).toContain('Deactivate it instead');
      // The row is still there — nothing was removed optimistically.
      expect(rows().length).toBe(2);
    });
  });

  describe('failures', () => {
    it('renders no raw backend string', async () => {
      localStorage.clear();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [ProfileCatalogsComponent],
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
      TestBed.inject(SessionService).saveSession({ id: 'a1', roles: [AppRole.ADMIN] }, 'r:token');

      fixture = TestBed.createComponent(ProfileCatalogsComponent);
      fixture.detectChanges();
      http
        .expectOne((req) => req.url.includes('listProfileCatalogItems'))
        .flush({ error: 'CATALOG_SAVE_FAILED', stack: 'at repository.js:12' }, {
          status: 400,
          statusText: 'Bad Request',
        });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text()).not.toContain('CATALOG_SAVE_FAILED');
      expect(text()).not.toContain('repository.js');
      expect(text()).toContain('Something went wrong');
    });
  });

  describe('Arabic', () => {
    beforeEach(async () => setup([DAMASCUS, ALEPPO], 'ar'));

    it('renders the Arabic heading and tabs', () => {
      expect(fixture.nativeElement.querySelector('h1').textContent).toContain(
        'قوائم الملف الشخصي',
      );
      expect(text()).toContain('المدن');
      expect(text()).toContain('الجامعات والمعاهد');
    });

    it('leaves no untranslated English marker', () => {
      expect(text()).not.toContain('Profile Catalogs');
      expect(text()).not.toContain('Add item');
    });

    it('keeps the Arabic name column marked as Arabic', () => {
      const cell = fixture.nativeElement.querySelector('td[dir="rtl"]');
      expect(cell.getAttribute('lang')).toBe('ar');
    });
  });

  describe('no fake product data', () => {
    it('shows no percentage or chart', () => {
      expect(text()).not.toMatch(/\d+\s*%/);
      expect(fixture.nativeElement.querySelectorAll('p-chart, canvas').length).toBe(0);
    });

    it('mentions no future product feature', () => {
      const lowered = text().toLowerCase();
      for (const forbidden of ['batch', 'invitation', 'task', 'talent reel', 'live slide']) {
        expect(lowered).not.toContain(forbidden);
      }
    });

    it('lets a wide table scroll inside itself, never the page', () => {
      expect(fixture.nativeElement.querySelector('.cyf-catalogs-table-wrap')).toBeTruthy();
    });
  });
});
