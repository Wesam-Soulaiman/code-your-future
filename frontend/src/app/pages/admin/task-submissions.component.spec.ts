import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { BatchTask } from '../../models/BatchTask';
import { useTranslations } from '../../testing/i18n-testing';
import { TaskSubmissionsComponent } from './task-submissions.component';

/**
 * The Admin publication panel ⟨CP8C⟩.
 *
 * These cover the pin, which is the one control added to this page. The
 * load-bearing assertions are the two the brief is specific about: pinning is
 * offered only for a Reel that is actually published, and the page renders the
 * state the server sends back rather than the state it hoped for.
 */

const FINAL_TASK: BatchTask = {
  id: 'task1',
  batchId: 'batch1',
  title: 'Capstone',
  description: 'Build something',
  type: 'FINAL_TASK',
  status: 'PUBLISHED',
} as BatchTask;

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub1',
    taskId: 'task1',
    studentId: 'user1',
    studentName: 'Lina Haddad',
    status: 'SUBMITTED',
    hasEverBeenSubmitted: true,
    publicConsent: true,
    projectTitle: 'A design system',
    projectDescription: 'Tokens and components',
    myContribution: 'All of it',
    technologies: ['Angular'],
    talentReelStatus: 'PUBLISHED',
    talentReelPinned: false,
    ...overrides,
  };
}

describe('TaskSubmissionsComponent — the pin ⟨CP8C⟩', () => {
  let fixture: ComponentFixture<TaskSubmissionsComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskSubmissionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskSubmissionsComponent);
    fixture.componentRef.setInput('task', FINAL_TASK);
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  /** Load the roster, then open one Submission into the dialog. */
  function openSubmission(overrides: Record<string, unknown> = {}): void {
    fixture.detectChanges();
    http
      .expectOne((candidate) => candidate.url.includes('listTaskSubmissions'))
      .flush({
        items: [
          {
            studentId: 'user1',
            studentName: 'Lina Haddad',
            submissionId: 'sub1',
            submissionStatus: 'SUBMITTED',
          },
        ],
        total: 1,
        skip: 0,
        limit: 25,
      });
    fixture.detectChanges();

    // The roster is a list of cards with a View button, not a table.
    const view = Array.from(fixture.nativeElement.querySelectorAll('button')).find((element) =>
      (element as HTMLElement).textContent?.includes('View'),
    ) as HTMLButtonElement | undefined;
    expect(view).toBeDefined();
    view?.click();
    fixture.detectChanges();

    http
      .expectOne((candidate) => candidate.url.includes('getTaskSubmission'))
      .flush(submission(overrides));
    fixture.detectChanges();
  }

  function buttonWith(label: string): HTMLButtonElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).find((element) =>
      (element as HTMLElement).textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
  }

  it('offers Pin for a published reel', () => {
    openSubmission();
    expect(buttonWith('Pin to top')).toBeDefined();
    expect(buttonWith('Remove from top')).toBeUndefined();
  });

  it('offers Unpin once it is pinned, and says so', () => {
    openSubmission({ talentReelPinned: true });
    expect(buttonWith('Remove from top')).toBeDefined();
    expect(buttonWith('Pin to top')).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('appears first');
  });

  it('offers no pin at all for a reel that is not published', () => {
    // Pinning somebody the public pages do not return would be a control that
    // appears to work and changes nothing anybody can see.
    openSubmission({ talentReelStatus: 'UNPUBLISHED', talentReelPinned: false });
    expect(buttonWith('Pin to top')).toBeUndefined();
    expect(buttonWith('Remove from top')).toBeUndefined();
  });

  it('sends the submission id and renders what the server sends back', () => {
    openSubmission();
    buttonWith('Pin to top')?.click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) => candidate.url.includes('pinTalentReel'));
    expect(request.request.body.submissionId).toBe('sub1');

    // The page trusts the response, not the click: the server is the one that
    // decides whether a pin was allowed.
    request.flush({ status: 'PUBLISHED', pinned: true, adminSuppressed: false });
    fixture.detectChanges();
    http.expectOne((candidate) => candidate.url.includes('listTaskSubmissions')).flush({
      items: [],
      total: 0,
      skip: 0,
      limit: 25,
    });
    fixture.detectChanges();

    expect(buttonWith('Remove from top')).toBeDefined();
  });

  it('unpins through its own endpoint', () => {
    openSubmission({ talentReelPinned: true });
    buttonWith('Remove from top')?.click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) => candidate.url.includes('unpinTalentReel'));
    request.flush({ status: 'PUBLISHED', pinned: false, adminSuppressed: false });
    fixture.detectChanges();
    http
      .expectOne((candidate) => candidate.url.includes('listTaskSubmissions'))
      .flush({ items: [], total: 0, skip: 0, limit: 25 });
    fixture.detectChanges();

    expect(buttonWith('Pin to top')).toBeDefined();
  });
});