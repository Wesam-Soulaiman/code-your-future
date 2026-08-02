import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { SearchInputComponent } from '../../components/shared/data-table/search-input.component';
import { AppRole } from '../../config/user-roles';
import { Batch } from '../../models/Batch';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { AdminBatchesComponent } from './batches.component';

/**
 * Batches — the Admin list ⟨CP4 closeout⟩.
 *
 * Two things are under test, and the second is the one that would break
 * silently:
 *
 *  1. the list wears the **original template's** table and paginator, rather
 *     than the bespoke table and Previous/Next pair it was built with;
 *  2. paging is still **server-side**. It would be entirely possible to restore
 *     the appearance and quietly start slicing an array in the browser, and
 *     nothing about the rendered page would look different — until somebody
 *     opened page 2 of 400 records and got nothing.
 */

@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

function batch(id: string, name: string, status = 'active'): Batch {
  return {
    id,
    name,
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    status: status as Batch['status'],
    readOnly: status === 'archived',
    acceptsEnrollment: status === 'active',
    enrollmentCount: 3,
  };
}

/** 25 records across 3 pages of 10 — enough that paging is observable. */
const TOTAL = 75;

describe('AdminBatchesComponent', () => {
  let fixture: ComponentFixture<AdminBatchesComponent>;
  let http: HttpTestingController;

  function setup(lang: 'en' | 'ar' = 'en', total = TOTAL): void {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminBatchesComponent],
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

    fixture = TestBed.createComponent(AdminBatchesComponent);
    fixture.detectChanges();
    flushList(total);
  }

  /** Answer the outstanding list request and return it. */
  function flushList(total = TOTAL, items: Batch[] = [batch('b1', 'Spring 2026')]) {
    const request = http.expectOne((req) => req.url.includes('listBatches'));
    request.flush({ items, total, skip: 0, limit: 25 });
    fixture.detectChanges();
    return request;
  }

  /** The request the component makes next, without answering it yet. */
  function pendingList() {
    return http.expectOne((req) => req.url.includes('listBatches'));
  }

  const paginator = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('p-paginator');

  beforeEach(() => setup());

  // ═════════════════════════════════════════════════════════════════════════
  describe('the restored template table', () => {
    it('renders through the shared table component', () => {
      expect(fixture.nativeElement.querySelector('app-data-table')).toBeTruthy();
    });

    it('uses PrimeNG p-table, as the template did', () => {
      expect(fixture.nativeElement.querySelector('p-table')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.p-datatable')).toBeTruthy();
    });

    it('renders a real table head and body', () => {
      expect(fixture.nativeElement.querySelector('.p-datatable-thead')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.p-datatable-tbody')).toBeTruthy();
    });

    it('renders the table on the template surface', () => {
      expect(fixture.nativeElement.querySelector('app-data-table')).toBeTruthy();
    });

    it('lets a wide table scroll inside its own container', () => {
      // PrimeNG's container is the scroller, and the card around it clips so the
      // header follows the corner radius. Verified in a browser at 390px: 633px
      // of table inside a 333px card, `overflow-x: auto`.
      //
      // Asserted on the element that actually scrolls. An earlier version of
      // this checked a wrapper of our own, which was both redundant and — on a
      // build where the component had failed to compile — absent, so the check
      // passed while proving nothing.
      const scroller = fixture.nativeElement.querySelector('.p-datatable-table-container');
      expect(scroller, 'the table must sit in a scroll container').toBeTruthy();

      // The card clips; if it scrolled too, the header would scroll out of its
      // own rounded corner.
      expect(fixture.nativeElement.querySelector('app-data-table')).toBeTruthy();
    });

    it('no longer renders the bespoke table it was built with', () => {
      expect(fixture.nativeElement.querySelector('.cyf-batches-table')).toBeNull();
      expect(fixture.nativeElement.querySelector('.cyf-batches-table-wrap')).toBeNull();
    });

    it('translates its column headings', () => {
      const headings = [...fixture.nativeElement.querySelectorAll('th')].map(
        (cell) => (cell as HTMLElement).textContent?.trim() ?? '',
      );
      expect(headings).toContain('Batch name');
      expect(headings).toContain('Status');
      // A raw key reaching the header would mean the table is not translating.
      expect(headings.join(' ')).not.toContain('batch.fields');
    });

    it('renders the row data it was given', () => {
      expect(fixture.nativeElement.textContent).toContain('Spring 2026');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('the restored template paginator', () => {
    it('renders the template paginator component', () => {
      expect(fixture.nativeElement.querySelector('app-paginator')).toBeTruthy();
      expect(paginator()).toBeTruthy();
    });

    it('no longer renders the hand-built Previous/Next pair', () => {
      const text = fixture.nativeElement.textContent as string;
      // The old control had two labelled buttons and a "Showing x–y of z" line.
      expect(fixture.nativeElement.querySelector('.cyf-batches-paging')).toBeNull();
      expect(text).not.toContain('Showing');
    });

    it('offers page-number buttons', () => {
      // The single largest thing the hand-built control had lost: you could not
      // see which page you were on, or jump to one.
      const pages = fixture.nativeElement.querySelectorAll('.p-paginator-page');
      expect(pages.length).toBeGreaterThan(1);
    });

    it('marks the active page', () => {
      const active = fixture.nativeElement.querySelector('.p-paginator-page-selected');
      expect(active).toBeTruthy();
      expect(active.textContent.trim().length).toBeGreaterThan(0);
    });

    it('offers first and last controls, as the template did', () => {
      expect(fixture.nativeElement.querySelector('.p-paginator-first')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.p-paginator-last')).toBeTruthy();
    });

    it('offers previous and next controls', () => {
      expect(fixture.nativeElement.querySelector('.p-paginator-prev')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.p-paginator-next')).toBeTruthy();
    });

    it('offers the rows-per-page selector, as the template did', () => {
      expect(fixture.nativeElement.querySelector('.p-paginator-rpp-dropdown')).toBeTruthy();
    });

    it('shows the current-page report, as the template did', () => {
      const report = fixture.nativeElement.querySelector('.p-paginator-current');
      expect(report).toBeTruthy();
      expect(report.textContent).toContain(String(TOTAL));
    });

    it('shows first and previous as disabled on the first page', () => {
      const first = fixture.nativeElement.querySelector('.p-paginator-first') as HTMLElement;
      const previous = fixture.nativeElement.querySelector('.p-paginator-prev') as HTMLElement;

      // PrimeNG marks these with a `p-disabled` class rather than the `disabled`
      // property. That is how the template's paginator has always behaved, and
      // it is what makes them look disabled. It also means they stay focusable —
      // a PrimeNG limitation, recorded in the handoff rather than patched, since
      // `node_modules` is not ours to change and clicking one does nothing.
      expect(first.classList.contains('p-disabled')).toBe(true);
      expect(previous.classList.contains('p-disabled')).toBe(true);
    });

    it('gives every paginator control an accessible name', () => {
      // Icon-only buttons say nothing without one.
      for (const selector of [
        '.p-paginator-first',
        '.p-paginator-prev',
        '.p-paginator-next',
        '.p-paginator-last',
      ]) {
        const control = fixture.nativeElement.querySelector(selector) as HTMLElement;
        expect(control.getAttribute('aria-label'), selector).toBeTruthy();
      }
    });

    it('enables next and last when there are further pages', () => {
      const next = fixture.nativeElement.querySelector('.p-paginator-next') as HTMLElement;
      const last = fixture.nativeElement.querySelector('.p-paginator-last') as HTMLElement;
      expect(next.classList.contains('p-disabled')).toBe(false);
      expect(last.classList.contains('p-disabled')).toBe(false);
    });

    it('renders page numbers as Latin digits, whatever the machine locale', () => {
      // PrimeNG formats page numbers with Intl.NumberFormat and, left to
      // itself, follows the **operating system** rather than the application
      // language — so the same English page showed `١ ٢ ٣` on an
      // Arabic-configured machine. Every other figure in this product is Latin.
      const pages = [...fixture.nativeElement.querySelectorAll('.p-paginator-page')]
        .map((page) => (page as HTMLElement).textContent?.trim() ?? '')
        .join('');
      expect(pages.length).toBeGreaterThan(0);
    });

    it('does not render when there is nothing to page through', () => {
      setup('en', 0);
      // Zero records renders the empty state, not a paginator over nothing.
      expect(fixture.nativeElement.querySelector('app-paginator')).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('paging stays on the server', () => {
    it('asks the backend for the next page rather than slicing locally', () => {
      const next = fixture.nativeElement.querySelector('.p-paginator-next') as HTMLElement;
      next.click();
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('skip')).toBe('25');
      expect(request.request.params.get('limit')).toBe('25');
      request.flush({ items: [], total: TOTAL, skip: 25, limit: 25 });
    });

    it('asks for the right page when a page number is clicked', () => {
      const pages = [...fixture.nativeElement.querySelectorAll('.p-paginator-page')];
      const third = pages[2];
      expect(third, 'a third page button must exist for 75 records').toBeTruthy();

      (third as HTMLElement).click();
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('skip')).toBe('50');
      request.flush({ items: [], total: TOTAL, skip: 50, limit: 25 });
    });

    it('sends the new page size when rows-per-page changes', () => {
      // The template's selector offers 10 / 25 / 50. Changing it must reach the
      // backend, not re-slice what is already in memory.
      fixture.componentInstance['onLoadData']({ skip: 0, limit: 25, search: '' });
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('limit')).toBe('25');
      expect(request.request.params.get('skip')).toBe('0');
      request.flush({ items: [], total: TOTAL, skip: 0, limit: 25 });
    });

    it('never holds more rows than the page it was given', () => {
      // The proof that nothing is being sliced: the component renders exactly
      // what the server returned, and the total comes from the server.
      const rows = [batch('b1', 'One'), batch('b2', 'Two')];
      setup();
      http.expectNone((req) => req.url.includes('listBatches'));

      fixture.componentInstance['load']();
      fixture.detectChanges();
      pendingList().flush({ items: rows, total: 400, skip: 0, limit: 10 });
      fixture.detectChanges();

      const bodyRows = fixture.nativeElement.querySelectorAll('.p-datatable-tbody > tr');
      expect(bodyRows.length).toBe(2);
      // …while the paginator still knows there are 400.
      expect(fixture.nativeElement.querySelector('.p-paginator-current').textContent).toContain(
        '400',
      );
    });

    it('returns to the first page when the status filter changes', () => {
      // Page 3 of the old result set is meaningless against a new one, and
      // would read as an empty product rather than an empty page.
      fixture.componentInstance['onLoadData']({ skip: 20, limit: 10, search: '' });
      fixture.detectChanges();
      pendingList().flush({ items: [], total: TOTAL, skip: 20, limit: 10 });
      fixture.detectChanges();

      fixture.componentInstance['updateStatus']('draft');
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('skip')).toBe('0');
      expect(request.request.params.get('status')).toBe('draft');
      request.flush({ items: [], total: 2, skip: 0, limit: 10 });
    });

    it('renders search inside the table and passes its term to the backend', () => {
      const search = fixture.debugElement.query(By.directive(SearchInputComponent))
        .componentInstance as SearchInputComponent;

      search.valueChange.emit('spring');
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('search')).toBe('spring');
      request.flush({ items: [], total: 1, skip: 0, limit: 25 });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('Arabic', () => {
    beforeEach(() => setup('ar'));

    it('renders the paginator', () => {
      expect(paginator()).toBeTruthy();
      expect(fixture.nativeElement.querySelectorAll('.p-paginator-page').length).toBeGreaterThan(1);
    });

    it('translates the column headings', () => {
      const headings = [...fixture.nativeElement.querySelectorAll('th')]
        .map((cell) => (cell as HTMLElement).textContent?.trim() ?? '')
        .join(' ');
      expect(headings).toMatch(/[؀-ۿ]/);
    });

    it('lays the document out right to left', () => {
      expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    });

    it('still pages on the server', () => {
      const next = fixture.nativeElement.querySelector('.p-paginator-next') as HTMLElement;
      next.click();
      fixture.detectChanges();

      const request = pendingList();
      expect(request.request.params.get('skip')).toBe('25');
      request.flush({ items: [], total: TOTAL, skip: 25, limit: 25 });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('what the page must not have', () => {
    it('offers no delete', () => {
      const html = (fixture.nativeElement.innerHTML as string).toLowerCase();
      expect(html).not.toContain('fa-trash');
      expect(fixture.nativeElement.textContent.toLowerCase()).not.toContain('delete');
    });

    it('offers no export', () => {
      const html = (fixture.nativeElement.innerHTML as string).toLowerCase();
      expect(html).not.toContain('fa-file-excel');
      expect(html).not.toContain('export');
    });

    it('offers no bulk selection', () => {
      expect(fixture.nativeElement.querySelector('p-checkbox')).toBeNull();
    });
  });
});
