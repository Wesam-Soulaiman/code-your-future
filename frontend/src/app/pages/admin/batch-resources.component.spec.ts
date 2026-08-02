import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRole } from '../../config/user-roles';
import { BatchResource, BatchResourceList } from '../../models/BatchResource';
import { SessionService } from '../../services/session.service';
import { useTranslations } from '../../testing/i18n-testing';
import { BatchResourcesComponent } from './batch-resources.component';

/**
 * The Admin Resources panel ⟨CP5⟩.
 *
 * Nothing here contacts a real backend: `HttpTestingController` intercepts every
 * call, and `verify()` fails the test if a request was opened that the test did
 * not expect — which is how "the archived panel makes no write calls" is proved
 * rather than assumed.
 */
@Component({ selector: 'app-stub', template: 'stub' })
class StubComponent {}

const READING: BatchResource = {
  id: 'r1',
  title: 'Week one reading',
  description: 'The first chapter',
  filename: 'week-1.pdf',
  extension: '.pdf',
  kind: 'pdf',
  fileSize: 1536,
  displayOrder: 0,
  createdAt: '2026-01-01T09:00:00.000Z',
};

const SLIDES: BatchResource = {
  id: 'r2',
  title: 'Week one slides',
  filename: 'week-1.pptx',
  extension: '.pptx',
  kind: 'pptx',
  fileSize: 4 * 1024 * 1024,
  displayOrder: 1,
  createdAt: '2026-01-02T09:00:00.000Z',
};

const RULES = {
  extensions: ['.pdf', '.html', '.htm', '.docx', '.pptx', '.xlsx', '.txt', '.md'],
  maxBytes: 20 * 1024 * 1024,
};

function listResponse(overrides: Partial<BatchResourceList> = {}): BatchResourceList {
  return { items: [READING, SLIDES], rules: RULES, readOnly: false, ...overrides };
}

/** A real `File`, so the component's own size and extension checks run. */
function fileOf(name: string, size: number, type = 'application/pdf'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('BatchResourcesComponent', () => {
  let fixture: ComponentFixture<BatchResourcesComponent>;
  let http: HttpTestingController;

  async function setup(
    response: BatchResourceList = listResponse(),
    lang: 'en' | 'ar' = 'en',
  ): Promise<void> {
    localStorage.clear();
    localStorage.setItem('lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BatchResourcesComponent],
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

    fixture = TestBed.createComponent(BatchResourcesComponent);
    fixture.componentRef.setInput('batchId', 'b1');
    fixture.detectChanges();

    http.expectOne((req) => req.url.includes('listBatchResources')).flush(response);

    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = () => fixture.nativeElement.textContent as string;
  const rows = () => fixture.nativeElement.querySelectorAll('tbody tr');

  function buttonByLabel(label: string, index = 0): HTMLButtonElement {
    const found = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (entry) => (entry as HTMLElement).getAttribute('aria-label') === label,
    ) as HTMLButtonElement[];
    expect(found.length, `no button labelled "${label}"`).toBeGreaterThan(index);
    return found[index];
  }

  function clickText(needle: string): void {
    const button = [...document.querySelectorAll('button')].find((entry) =>
      (entry as HTMLElement).textContent?.includes(needle),
    ) as HTMLButtonElement;
    expect(button, `no button containing "${needle}"`).toBeTruthy();
    button.click();
    fixture.detectChanges();
  }

  /**
   * Click inside the open dialog.
   *
   * The dialog's submit and the toolbar's opener carry the same label, and the
   * toolbar's comes first in the document — clicking by text alone reopens the
   * dialog instead of submitting it.
   */
  function clickInDialog(needle: string): void {
    const dialog = document.querySelector('.p-dialog');
    expect(dialog, 'no dialog is open').toBeTruthy();
    const button = [...dialog!.querySelectorAll('button')].find((entry) =>
      (entry as HTMLElement).textContent?.includes(needle),
    ) as HTMLButtonElement;
    expect(button, `no dialog button containing "${needle}"`).toBeTruthy();
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

  afterEach(() => http.verify());

  describe('the list', () => {
    beforeEach(async () => setup());

    it('renders one row per Resource, in the order the server sent', () => {
      expect(rows().length).toBe(2);
      expect(text().indexOf('Week one reading')).toBeLessThan(text().indexOf('Week one slides'));
    });

    it('shows the title, the description, and the filename that will be saved', () => {
      expect(text()).toContain('Week one reading');
      expect(text()).toContain('The first chapter');
      expect(text()).toContain('week-1.pdf');
    });

    it('shows a readable size in binary units', () => {
      expect(text()).toContain('1.5');
      expect(text()).toContain('KB');
      expect(text()).toContain('4');
      expect(text()).toContain('MB');
    });

    it('never renders a URL or a storage key', () => {
      const html = fixture.nativeElement.innerHTML as string;
      expect(html).not.toContain('storageKey');
      expect(html).not.toMatch(/href="[^"]*batch-resource/);
    });

    it('says so plainly when there is nothing yet', async () => {
      await setup(listResponse({ items: [] }));
      expect(text()).toContain('No resources yet');
    });
  });

  describe('an archived Batch', () => {
    beforeEach(async () => setup(listResponse({ readOnly: true })));

    it('explains why the controls are gone', () => {
      expect(text()).toContain('archived');
    });

    it('offers no upload, edit, reorder, or delete', () => {
      const labels = [...fixture.nativeElement.querySelectorAll('button')].map((button) =>
        (button as HTMLElement).getAttribute('aria-label'),
      );
      expect(labels).not.toContain('Edit details');
      expect(labels).not.toContain('Delete');
      expect(labels).not.toContain('Move up');
      expect(labels).not.toContain('Move down');
      expect(text()).not.toContain('Upload file');
    });

    it('still offers every download', () => {
      // Archived is read-only, not invisible. A cohort that finished does not
      // lose the material it was given.
      const downloads = [...fixture.nativeElement.querySelectorAll('button')].filter(
        (button) => (button as HTMLElement).getAttribute('aria-label') === 'Download',
      );
      expect(downloads.length).toBe(2);
    });
  });

  describe('uploading', () => {
    beforeEach(async () => setup());

    it('refuses a file over the limit without contacting the server', () => {
      clickText('Upload file');
      const input = document.querySelector('#resource-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [fileOf('huge.pdf', RULES.maxBytes + 1)] });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // No request at all: `afterEach` verify() would fail if one were opened.
      expect(document.body.textContent).toContain('too large');
    });

    it('refuses an unaccepted extension without contacting the server', () => {
      clickText('Upload file');
      const input = document.querySelector('#resource-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [fileOf('payload.exe', 1024, 'application/octet-stream')],
      });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(document.body.textContent).toContain('not accepted');
    });

    it('refuses an empty file without contacting the server', () => {
      clickText('Upload file');
      const input = document.querySelector('#resource-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [fileOf('empty.pdf', 0)] });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(document.body.textContent).toContain('empty');
    });

    it('states the rules the server sent, not a copy of its own', () => {
      clickText('Upload file');
      const dialog = document.body.textContent ?? '';
      expect(dialog).toContain('pdf');
      expect(dialog).toContain('docx');
      expect(dialog).toContain('20');
    });

    it('sends the file as multipart, with the Batch and the title beside it', () => {
      clickText('Upload file');

      const input = document.querySelector('#resource-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [fileOf('week-2.pdf', 2048)] });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      typeInto('resource-title', 'Week two reading');
      clickInDialog('Upload file');

      const request = http.expectOne(
        (req) => req.method === 'POST' && req.url.endsWith('/batch-resource'),
      );
      const body = request.request.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('batchId')).toBe('b1');
      expect(body.get('title')).toBe('Week two reading');
      expect(body.get('file')).toBeInstanceOf(File);

      request.flush({ ...READING, id: 'r3', title: 'Week two reading', displayOrder: 2 });
      fixture.detectChanges();
      expect(rows().length).toBe(3);
    });

    it('offers the filename as a first title, editable', () => {
      clickText('Upload file');
      const input = document.querySelector('#resource-file') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [fileOf('week-2.pdf', 2048)] });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      const title = document.querySelector('#resource-title') as HTMLInputElement;
      expect(title.value).toBe('week-2');
    });
  });

  describe('editing', () => {
    beforeEach(async () => setup());

    it('says the file cannot be replaced', () => {
      buttonByLabel('Edit details').click();
      fixture.detectChanges();
      expect(document.body.textContent).toContain('cannot be replaced');
    });

    it('sends only the title and description', () => {
      buttonByLabel('Edit details').click();
      fixture.detectChanges();

      typeInto('resource-edit-title', 'Week one — revised');
      clickInDialog('Save');

      const request = http.expectOne((req) => req.url.includes('updateBatchResource'));
      const body = request.request.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['description', 'resourceId', 'title']);
      expect(body['title']).toBe('Week one — revised');

      request.flush({ ...READING, title: 'Week one — revised' });
      fixture.detectChanges();
      expect(text()).toContain('Week one — revised');
    });
  });

  describe('reordering', () => {
    beforeEach(async () => setup());

    it('sends the whole resulting order, not a single move', () => {
      // A full sequence is what makes two concurrent reorders resolve to one of
      // them rather than to an interleaving neither chose.
      buttonByLabel('Move down').click();
      fixture.detectChanges();

      const request = http.expectOne((req) => req.url.includes('reorderBatchResources'));
      expect(request.request.body).toEqual({ batchId: 'b1', orderedIds: ['r2', 'r1'] });

      request.flush({ items: [SLIDES, READING] });
      fixture.detectChanges();
      expect(text().indexOf('Week one slides')).toBeLessThan(text().indexOf('Week one reading'));
    });

    it('puts the list back if the server refuses', () => {
      buttonByLabel('Move down').click();
      fixture.detectChanges();

      http
        .expectOne((req) => req.url.includes('reorderBatchResources'))
        .flush({ error: 'RESOURCE_ACCESS_DENIED' }, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();

      expect(text().indexOf('Week one reading')).toBeLessThan(text().indexOf('Week one slides'));
    });

    it('does not offer a move that would go off either end', () => {
      // The first row cannot move up and the last cannot move down.
      expect(buttonByLabel('Move up', 0).disabled).toBe(true);
      expect(buttonByLabel('Move down', 1).disabled).toBe(true);
    });
  });

  describe('deleting', () => {
    beforeEach(async () => setup());

    it('asks first, and says the file goes too', () => {
      buttonByLabel('Delete').click();
      fixture.detectChanges();

      const dialog = document.body.textContent ?? '';
      expect(dialog).toContain('Week one reading');
      expect(dialog).toContain('cannot be undone');
    });

    it('removes the row once the server confirms', () => {
      buttonByLabel('Delete').click();
      fixture.detectChanges();
      clickInDialog('Delete');

      http
        .expectOne((req) => req.url.includes('deleteBatchResource'))
        .flush({ id: 'r1', deleted: true });
      fixture.detectChanges();

      expect(rows().length).toBe(1);
      expect(text()).not.toContain('Week one reading');
    });
  });

  describe('downloading', () => {
    beforeEach(async () => setup());

    it('fetches bytes and saves them, rather than opening a tab', () => {
      // A tab would ask the browser to render the document. An uploaded `.html`
      // rendered in this origin would run its own script with the reader's
      // session in scope.
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const createObjectURL = vi.fn(() => 'blob:local');
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

      buttonByLabel('Download').click();
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

    it('reports a refused download without saying whether it exists', () => {
      buttonByLabel('Download').click();
      fixture.detectChanges();

      // A blob request's error body arrives as a Blob, not as parsed JSON, so
      // the stable code inside it is unreadable. That is exactly why the bare
      // 404 fallback exists, and this is the path that exercises it.
      http
        .expectOne((req) => req.url.endsWith('/batch-resource/r1'))
        .flush(new Blob([JSON.stringify({ error: 'RESOURCE_NOT_FOUND' })]), {
          status: 404,
          statusText: 'Not Found',
        });
      fixture.detectChanges();

      expect(text()).toContain('could not be found');
    });
  });

  describe('in Arabic', () => {
    beforeEach(async () => setup(listResponse(), 'ar'));

    it('translates the panel', () => {
      expect(text()).toContain('الموارد');
    });

    it('keeps file sizes in Latin digits', () => {
      expect(text()).not.toMatch(/[٠-٩]/);
    });
  });
});
