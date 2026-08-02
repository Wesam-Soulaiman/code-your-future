import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { MessageService } from 'primeng/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { StudentBatchResource } from '../../models/BatchResource';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { StudentBatchResourcesComponent } from './student-batch-resources.component';

/**
 * The Student Resources panel ⟨CP5⟩.
 *
 * What matters most here is what is missing: a Student has no upload, edit,
 * reorder, or delete operation, so the panel must not draw a control for one —
 * not even a disabled one, which would suggest the ability exists somewhere.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

const READING: StudentBatchResource = {
  id: 'r1',
  title: 'Week one reading',
  description: 'The first chapter',
  filename: 'week-1.pdf',
  extension: '.pdf',
  kind: 'pdf',
  fileSize: 1536,
  createdAt: '2026-01-01T09:00:00.000Z',
};

describe('StudentBatchResourcesComponent', () => {
  let fixture: ComponentFixture<StudentBatchResourcesComponent>;
  let http: HttpTestingController;

  async function setup(
    items: StudentBatchResource[] = [READING],
    lang: 'en' | 'ar' = 'en',
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudentBatchResourcesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService), lang);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).saveSession({ id: 's1', roles: [AppRole.STUDENT] }, 'r:token');

    fixture = TestBed.createComponent(StudentBatchResourcesComponent);
    fixture.componentRef.setInput('batchId', 'b1');
    fixture.detectChanges();

    http.expectOne((req) => req.url.includes('listMyBatchResources')).flush({ items });

    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;

  afterEach(() => http.verify());

  it('asks the Student endpoint, not the Admin one', async () => {
    // Two routes, deliberately. A shared entry point with a role branch inside
    // is where an authorisation default eventually goes wrong.
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [StudentBatchResourcesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: StubComponent }]),
        provideTranslateService({ fallbackLang: 'en' }),
        MessageService,
      ],
    });
    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(StudentBatchResourcesComponent);
    fixture.componentRef.setInput('batchId', 'b1');
    fixture.detectChanges();

    const request = http.expectOne((req) => req.url.includes('listMyBatchResources'));
    expect(request.request.url).toContain('/student-resources/');
    expect(request.request.params.get('batchId')).toBe('b1');
    request.flush({ items: [] });
  });

  it('lists what was shared', async () => {
    await setup();
    expect(text()).toContain('Week one reading');
    expect(text()).toContain('The first chapter');
    expect(text()).toContain('week-1.pdf');
  });

  it('offers no control that would change anything', async () => {
    await setup();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')].map((button) =>
      (button as HTMLElement).textContent?.trim(),
    );
    const joined = buttons.join(' ');
    for (const forbidden of ['Upload', 'Edit', 'Delete', 'Move']) {
      expect(joined, `a Student must not see "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('never renders a URL or a storage key', async () => {
    await setup();
    const html = fixture.nativeElement.innerHTML as string;
    expect(html).not.toContain('storageKey');
    expect(html).not.toMatch(/href="[^"]*batch-resource/);
  });

  it('says so plainly when nothing has been shared', async () => {
    await setup([]);
    expect(text()).toContain('Nothing shared yet');
  });

  it('fetches bytes and saves them, rather than opening a tab', async () => {
    await setup();

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const createObjectURL = vi.fn(() => 'blob:local');
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    const download = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLElement).textContent?.includes('Download'),
    ) as HTMLButtonElement;
    download.click();
    fixture.detectChanges();

    const request = http.expectOne((req) => req.url.endsWith('/batch-resource/r1'));
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    fixture.detectChanges();

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    click.mockRestore();
    open.mockRestore();
  });

  it('shows one message whether the Batch is missing or simply not theirs', async () => {
    // The server refuses to distinguish them; the page must not either.
    await setup();

    const reload = fixture.nativeElement
      .querySelector('.fa-rotate-right')
      ?.closest('button') as HTMLButtonElement;
    reload.click();
    fixture.detectChanges();

    http
      .expectOne((req) => req.url.includes('listMyBatchResources'))
      .flush({ error: 'RESOURCE_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(text()).toContain('could not be found');
  });

  it('translates into Arabic without switching the digits', async () => {
    await setup([READING], 'ar');
    expect(text()).toContain('الموارد');
    const numericCells = [...fixture.nativeElement.querySelectorAll('.cyf-numeric')]
      .map((cell) => (cell as HTMLElement).textContent ?? '')
      .join(' ');
    expect(numericCells).not.toMatch(/[٠-٩]/);
  });
});
