import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StudentTask, StudentTaskDetail, TaskSubmission } from '../../models/BatchTask';
import { useTranslations } from '../../testing/i18n-testing';
import { StudentTasksComponent } from './student-tasks.component';

/**
 * The Student Tasks page ⟨CP7⟩.
 *
 * The load-bearing assertions are about what is **not** sent and what is **not**
 * shown: a field the Admin did not ask for never leaves the browser, consent is
 * never ticked by anything but the Student, and a closed Task offers no way to
 * hand work in.
 *
 * `HttpTestingController.verify()` fails a test that opened a request it did not
 * expect, which is how "this sends nothing" is proved rather than assumed.
 */

const OPEN_ASSIGNMENT: StudentTask = {
  id: 't1',
  batchId: 'b1',
  title: 'Build a portfolio',
  description: 'Ship something you are proud of.',
  type: 'ASSIGNMENT',
  deadline: '2099-01-01T17:00:00.000Z',
  requirements: {
    githubRequirement: 'REQUIRED',
    liveDemoRequirement: 'OPTIONAL',
    driveRequirement: 'NOT_USED',
    videoRequirement: 'NOT_USED',
    studentNoteRequirement: 'OPTIONAL',
  },
  isSubmissionOpen: true,
  availabilityReason: 'OPEN',
};

const CLOSED_BY_DEADLINE: StudentTask = {
  ...OPEN_ASSIGNMENT,
  id: 't2',
  title: 'Last week exercise',
  isSubmissionOpen: false,
  availabilityReason: 'DEADLINE_PASSED',
};

const FINAL_TASK: StudentTask = {
  ...OPEN_ASSIGNMENT,
  id: 't3',
  title: 'Capstone',
  type: 'FINAL_TASK',
  requirements: {
    githubRequirement: 'REQUIRED',
    liveDemoRequirement: 'OPTIONAL',
    driveRequirement: 'NOT_USED',
    videoRequirement: 'REQUIRED',
    studentNoteRequirement: 'NOT_USED',
  },
};

describe('StudentTasksComponent ⟨CP7⟩', () => {
  let fixture: ComponentFixture<StudentTasksComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentTasksComponent);
    fixture.componentRef.setInput('batchId', 'b1');
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  /**
   * Let NgModel finish writing.
   *
   * A one-way `[ngModel]` binding does not touch the DOM during the change
   * detection pass that sets it: NgModel queues the write in a microtask. A
   * test that asserted straight after `detectChanges()` would read the DOM one
   * beat early and see an empty, enabled control every time — which looks
   * exactly like the component being broken.
   */
  const settle = (): Promise<void> => Promise.resolve().then(() => fixture.detectChanges());

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  /** Answer the initial list request. */
  function listTasks(items: StudentTask[]): void {
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-tasks/listMyBatchTasks'),
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items });
    fixture.detectChanges();
  }

  /** Open the first Task in the list and answer the detail request. */
  async function openFirst(detail: StudentTaskDetail): Promise<void> {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('p-button button'),
    ) as HTMLButtonElement[];
    buttons[buttons.length - 1].click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-tasks/getMyBatchTask'),
    );
    request.flush(detail);
    fixture.detectChanges();
    await settle();
  }

  /**
   * A form control, by the id the template gives it.
   *
   * Not by `name`: an input carrying `ngModel` hands its `[name]` binding to
   * the directive rather than to the DOM, so a `[name="..."]` selector finds
   * nothing even when the field is on screen. The ids are stable and are what
   * the labels point at anyway.
   */
  const FIELD_ID: Record<string, string> = {
    githubUrl: 'field-githubUrl',
    liveDemoUrl: 'field-liveDemoUrl',
    googleDriveUrl: 'field-googleDriveUrl',
    youtubeVideoId: 'field-youtubeVideoId',
    studentNote: 'field-studentNote',
    publicProjectTitle: 'public-title',
    publicProjectDescription: 'public-description',
    myContribution: 'public-contribution',
    publicConsent: 'public-consent',
  };

  function inputNamed(name: string): HTMLInputElement | HTMLTextAreaElement | null {
    return fixture.nativeElement.querySelector(`#${FIELD_ID[name] ?? name}`);
  }

  async function saveDraft(): Promise<void> {
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('p-button button'),
    ).find((element) =>
      (element as HTMLElement).textContent?.includes('Save draft'),
    ) as HTMLButtonElement | undefined;
    button?.click();
    fixture.detectChanges();
    await settle();
  }

  // ── The list ──────────────────────────────────────────────────────────────

  it('asks only for its own Batch, and never names a Student', () => {
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-tasks/listMyBatchTasks'),
    );
    expect(request.request.params.get('batchId')).toBe('b1');
    // Who is submitting comes from the session, so there is no id to tamper
    // with and no parameter to get wrong.
    expect(request.request.params.get('studentId')).toBeNull();
    request.flush({ items: [] });
  });

  it('says so plainly when a Batch has no published Tasks', () => {
    listTasks([]);
    expect(text()).toContain('No tasks have been published');
  });

  it('shows why a Task is closed instead of a button that does nothing', () => {
    listTasks([CLOSED_BY_DEADLINE]);
    expect(text()).toContain('The deadline has passed');
    expect(text()).toContain('no late submissions');
  });

  // ── What the form renders ─────────────────────────────────────────────────

  it('renders only the fields this Task collects', async () => {
    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT });

    expect(inputNamed('githubUrl')).not.toBeNull();
    expect(inputNamed('liveDemoUrl')).not.toBeNull();
    expect(inputNamed('studentNote')).not.toBeNull();
    // Configured NOT_USED. The server refuses these outright, so a form that
    // showed them would fail the whole save rather than dropping one value.
    expect(inputNamed('googleDriveUrl')).toBeNull();
    expect(inputNamed('youtubeVideoId')).toBeNull();
  });

  it('never sends a field the Task does not collect', async () => {
    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT });

    const github = inputNamed('githubUrl') as HTMLInputElement;
    github.value = 'https://github.com/lina/portfolio';
    github.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();

    await saveDraft();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-tasks/saveMyTaskDraft'),
    );
    const body = request.request.body as Record<string, unknown>;
    expect(body['githubUrl']).toBe('https://github.com/lina/portfolio');
    expect(body).not.toHaveProperty('googleDriveUrl');
    expect(body).not.toHaveProperty('youtubeVideoId');
    // An Assignment has no public project, so none of those fields travel.
    expect(body).not.toHaveProperty('publicConsent');
    expect(body).not.toHaveProperty('technologies');
    request.flush({ id: 's1', taskId: 't1', status: 'DRAFT', hasEverBeenSubmitted: false, publicConsent: false });
  });

  it('sends nothing at all until a button is pressed', async () => {
    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT });

    const github = inputNamed('githubUrl') as HTMLInputElement;
    github.value = 'https://github.com/lina/portfolio';
    github.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();
    // `verify()` in afterEach fails this test if typing opened a request.
  });

  // ── A closed Task ─────────────────────────────────────────────────────────

  it('offers no way to hand work in once the deadline has passed', async () => {
    listTasks([CLOSED_BY_DEADLINE]);
    await openFirst({ task: CLOSED_BY_DEADLINE });

    expect(text()).not.toContain('Save draft');
    expect(text()).not.toContain('Submit');
    // The fields are still readable — closed is not invisible.
    expect((inputNamed('githubUrl') as HTMLInputElement | null)?.disabled).toBe(true);
  });

  // ── Consent ───────────────────────────────────────────────────────────────

  it('leaves the consent box unticked when nothing has been submitted', async () => {
    listTasks([FINAL_TASK]);
    await openFirst({ task: FINAL_TASK });

    const consent = inputNamed('publicConsent') as HTMLInputElement;
    expect(consent).not.toBeNull();
    // Never defaulted, never inferred from the other fields being filled.
    expect(consent.checked).toBe(false);
  });

  it('reads consent back from what the Student actually agreed to', async () => {
    const submission: TaskSubmission = {
      id: 's1',
      taskId: 't3',
      status: 'SUBMITTED',
      hasEverBeenSubmitted: true,
      publicConsent: true,
      publicProjectTitle: 'Recipe exchange',
      technologies: ['Angular'],
    };

    listTasks([FINAL_TASK]);
    await openFirst({ task: FINAL_TASK, submission });

    expect((inputNamed('publicConsent') as HTMLInputElement).checked).toBe(true);
  });

  it('explains exactly what consent publishes and what it never publishes', async () => {
    listTasks([FINAL_TASK]);
    await openFirst({ task: FINAL_TASK });

    const shown = text();
    expect(shown).toContain('become public');
    // The three things that never become public, named rather than implied.
    expect(shown).toContain('Your note');
    expect(shown).toContain('Drive link');
    expect(shown).toContain('phone number');
  });

  // ── Discarding ────────────────────────────────────────────────────────────

  it('offers no discard for work that has been submitted', async () => {
    const submitted: TaskSubmission = {
      id: 's1',
      taskId: 't1',
      status: 'SUBMITTED',
      hasEverBeenSubmitted: true,
      publicConsent: false,
    };

    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT, submission: submitted });

    // Handing work in is a fact about what happened. It cannot be erased.
    expect(text()).not.toContain('Discard draft');
    expect(text()).toContain('You have submitted this task');
  });

  it('discards a draft by naming the Task, not the Submission', async () => {
    /*
      The regression only end-to-end HTTP caught.

      The service sent `submissionId` and the server takes `taskId`, so Discard
      failed with a validation error every single time. Both sides had tests and
      both passed: nothing crossed the boundary between them.

      Naming the Task is also the safer contract — the server resolves the row
      from the Task and the session, so there is no submission id for a caller
      to substitute.
    */
    const draft: TaskSubmission = {
      id: 's1',
      taskId: 't1',
      status: 'DRAFT',
      hasEverBeenSubmitted: false,
      publicConsent: false,
    };

    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT, submission: draft });

    const discard = Array.from(
      fixture.nativeElement.querySelectorAll('p-button button'),
    ).find((element) =>
      (element as HTMLElement).textContent?.includes('Discard draft'),
    ) as HTMLButtonElement;
    discard.click();
    fixture.detectChanges();
    await settle();

    // Confirm in the dialog.
    const confirm = Array.from(
      fixture.nativeElement.querySelectorAll('p-dialog p-button button'),
    ).find((element) =>
      (element as HTMLElement).textContent?.includes('Discard draft'),
    ) as HTMLButtonElement;
    confirm.click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-tasks/deleteMyTaskDraft'),
    );
    const body = request.request.body as Record<string, unknown>;
    expect(body['taskId']).toBe('t1');
    expect(body).not.toHaveProperty('submissionId');
    request.flush({ id: 's1', deleted: true });
  });

  it('offers discard for a draft that was never submitted', async () => {
    const draft: TaskSubmission = {
      id: 's1',
      taskId: 't1',
      status: 'DRAFT',
      hasEverBeenSubmitted: false,
      publicConsent: false,
    };

    listTasks([OPEN_ASSIGNMENT]);
    await openFirst({ task: OPEN_ASSIGNMENT, submission: draft });

    expect(text()).toContain('Discard draft');
  });

  // ── The stored YouTube id ─────────────────────────────────────────────────

  it('shows a stored video id back as the link it came from', async () => {
    const submission: TaskSubmission = {
      id: 's1',
      taskId: 't3',
      status: 'DRAFT',
      hasEverBeenSubmitted: false,
      publicConsent: false,
      youtubeVideoId: 'dQw4w9WgXcQ',
    };

    listTasks([FINAL_TASK]);
    await openFirst({ task: FINAL_TASK, submission });

    // Showing the bare id back would look like the app mangled their link.
    expect((inputNamed('youtubeVideoId') as HTMLInputElement).value).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });
});
