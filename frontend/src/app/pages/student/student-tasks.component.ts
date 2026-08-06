import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  StudentTask,
  SubmissionInput,
  TaskSubmission,
} from '../../models/BatchTask';
import { ChangeLangService } from '../../services/change-lang.service';
import { TaskApiService } from '../../services/dataService/task-service';
import { formatInstant } from '../../utils/calendar-date';
import { saveBlob } from '../../utils/save-blob';
import {
  PUBLICATION_STATUS,
  REQUIREMENT,
  SUBMISSION_FIELDS,
  SUBMISSION_STATUS,
  SubmissionFieldSpec,
  TASK_LIMITS,
  TASK_TYPE,
  TECHNOLOGY_COUNT,
  formatAttachmentSize,
} from '../../utils/task-constants';
import { TaskErrorKey, mapTaskError } from '../../utils/task-error';

/** A Task row with its dates and its own state already rendered. */
interface StudentTaskRow {
  task: StudentTask;
  deadline: string;
  state: 'SUBMITTED' | 'DRAFT' | 'NOT_STARTED';
  tone: string;
}

const STATE_TONE: Readonly<Record<string, string>> = {
  SUBMITTED: 'success',
  DRAFT: 'warning',
  NOT_STARTED: 'neutral',
};

/**
 * A Student's Tasks in one Batch ⟨CP7⟩.
 *
 * ── Only what this Task collects is shown ───────────────────────────────────
 * The Admin configures five fields, each Not Used, Optional, or Required. A
 * field configured Not Used is not rendered **and not sent** — the server
 * refuses it rather than ignoring it, so a form that showed it anyway would
 * fail the whole save rather than quietly dropping one value.
 *
 * ── Save Draft and Submit are different promises ────────────────────────────
 * A Draft may be incomplete; a Submit may not. Everything typed must still be
 * valid either way, because storing a malformed link now and discovering it at
 * the deadline helps nobody.
 *
 * ── There are no late submissions ───────────────────────────────────────────
 * When the deadline passes the Task stays Published and simply stops accepting
 * work. Nothing here computes that: `isSubmissionOpen` comes from the server on
 * every read, because the only clock that can decide it is the server's — this
 * one belongs to whoever is sitting in front of it.
 *
 * ── Consent is never assumed ────────────────────────────────────────────────
 * The Talent Reel box starts unticked every time, is never ticked by anything
 * but the Student, and unticking it withdraws publication. Nothing on this page
 * pre-fills it, and no Admin can set it.
 */
@Component({
  selector: 'cyf-student-tasks',
  imports: [TranslateModule, FormsModule, ButtonModule, DialogModule, AlertComponent],
  templateUrl: './student-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentTasksComponent {
  private api = inject(TaskApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  /** The Batch these Tasks belong to. */
  batchId = input.required<string>();

  protected readonly limits = TASK_LIMITS;
  protected readonly taskType = TASK_TYPE;
  protected readonly requirement = REQUIREMENT;
  protected readonly submissionStatus = SUBMISSION_STATUS;
  protected readonly publicationStatus = PUBLICATION_STATUS;
  protected readonly technologyCount = TECHNOLOGY_COUNT;

  // ── State ─────────────────────────────────────────────────────────────────

  protected loading = signal(false);
  protected busy = signal(false);
  protected errorKey = signal<TaskErrorKey | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});
  protected noticeKey = signal<string | null>(null);

  protected tasks = signal<StudentTask[]>([]);
  protected openTask = signal<StudentTask | null>(null);
  protected submission = signal<TaskSubmission | null>(null);

  // ── The form ──────────────────────────────────────────────────────────────

  protected values = signal<Record<string, string>>({});
  protected technologies = signal<string[]>([]);
  protected technologyDraft = signal('');
  protected publicConsent = signal(false);
  protected confirmingDiscard = signal(false);

  constructor() {
    effect(() => {
      const batchId = this.batchId();
      if (batchId) this.load(batchId);
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  protected rows = computed<StudentTaskRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.tasks().map((task) => {
      const state =
        task.mySubmissionStatus === SUBMISSION_STATUS.SUBMITTED
          ? 'SUBMITTED'
          : task.mySubmissionStatus === SUBMISSION_STATUS.DRAFT
            ? 'DRAFT'
            : 'NOT_STARTED';
      return {
        task,
        state,
        deadline: formatInstant(task.deadline, lang),
        tone: STATE_TONE[state] ?? 'neutral',
      };
    });
  });

  protected isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  /** The fields this Task actually collects, in the order they are rendered. */
  protected activeFields = computed<SubmissionFieldSpec[]>(() => {
    const task = this.openTask();
    if (!task) return [];
    const requirements = task.requirements as unknown as Record<string, string>;
    return SUBMISSION_FIELDS.filter(
      (spec) => requirements[spec.requirement] !== REQUIREMENT.NOT_USED,
    );
  });

  protected isFinal = computed(() => this.openTask()?.type === TASK_TYPE.FINAL_TASK);

  protected isOpen = computed(() => this.openTask()?.isSubmissionOpen === true);

  protected hasSubmitted = computed(
    () => this.submission()?.hasEverBeenSubmitted === true,
  );

  /** A Draft that was never submitted may be discarded. Nothing else may. */
  protected canDiscard = computed(
    () => this.submission() !== null && !this.hasSubmitted() && this.isOpen(),
  );

  protected deadlineText = computed(() => {
    const task = this.openTask();
    return task ? formatInstant(task.deadline, this.langService.currentLang()) : '';
  });

  protected attachmentSize = computed(() => {
    const attachment = this.openTask()?.attachment;
    return attachment ? formatAttachmentSize(attachment.size) : '';
  });

  protected requirementOf(spec: SubmissionFieldSpec): string {
    const requirements = this.openTask()?.requirements as unknown as Record<string, string>;
    return requirements?.[spec.requirement] ?? REQUIREMENT.NOT_USED;
  }

  protected isRequired(spec: SubmissionFieldSpec): boolean {
    return this.requirementOf(spec) === REQUIREMENT.REQUIRED;
  }

  protected maxLengthOf(spec: SubmissionFieldSpec): number {
    return spec.field === 'studentNote' ? this.limits.studentNote.max : this.limits.url.max;
  }

  /**
   * Whether every required field is filled.
   *
   * A courtesy: the server checks the same thing and its answer is the one that
   * counts. This only decides whether Submit is offered.
   */
  protected canSubmit = computed(() => {
    if (!this.isOpen()) return false;
    const values = this.values();
    for (const spec of this.activeFields()) {
      if (this.isRequired(spec) && !(values[spec.field] ?? '').trim()) return false;
    }
    if (!this.isFinal()) return true;

    // A Final Task's public fields are only mandatory when the Student is
    // consenting to publication. Withholding consent is always allowed.
    if (!this.publicConsent()) return true;
    return (
      (values['publicProjectTitle'] ?? '').trim().length > 0 &&
      (values['publicProjectDescription'] ?? '').trim().length > 0 &&
      (values['myContribution'] ?? '').trim().length > 0 &&
      this.technologies().length >= this.technologyCount.min
    );
  });

  protected canAddTechnology = computed(() => {
    const draft = this.technologyDraft().trim();
    if (draft.length === 0 || draft.length > this.limits.technologyItem.max) return false;
    if (this.technologies().length >= this.technologyCount.max) return false;
    // Case-insensitive, matching the server: "React" and "react" are one
    // technology, and a Reel listing both looks careless.
    return !this.technologies().some((item) => item.toLowerCase() === draft.toLowerCase());
  });

  // ── Loading ───────────────────────────────────────────────────────────────

  private load(batchId: string): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .listMyTasks(batchId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => {
          this.tasks.set(list.items);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected reload(): void {
    this.load(this.batchId());
  }

  // ── One Task ──────────────────────────────────────────────────────────────

  protected open(task: StudentTask): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearMessages();

    this.api
      .getMyTask(task.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (detail) => {
          this.openTask.set(detail.task);
          this.submission.set(detail.submission ?? null);
          this.fillForm(detail.submission);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected close(): void {
    this.openTask.set(null);
    this.submission.set(null);
    this.values.set({});
    this.technologies.set([]);
    this.technologyDraft.set('');
    this.publicConsent.set(false);
    this.clearMessages();
    this.reload();
  }

  private fillForm(submission: TaskSubmission | undefined): void {
    const values: Record<string, string> = {};
    if (submission) {
      for (const spec of SUBMISSION_FIELDS) {
        const stored = (submission as unknown as Record<string, unknown>)[spec.field];
        if (typeof stored === 'string') values[spec.field] = stored;
      }
      values['publicProjectTitle'] = submission.publicProjectTitle ?? '';
      values['publicProjectDescription'] = submission.publicProjectDescription ?? '';
      values['myContribution'] = submission.myContribution ?? '';
      values['demoTitle'] = submission.demoTitle ?? '';
      values['demoVideoUrl'] = submission.demoVideoUrl ?? '';
    }
    this.values.set(values);
    this.technologies.set(submission?.technologies ? [...submission.technologies] : []);
    this.technologyDraft.set('');
    // Consent is read back from what the Student actually agreed to. It is
    // never defaulted to true and never inferred from the fields being filled.
    this.publicConsent.set(submission?.publicConsent === true);
  }

  /**
   * One form value.
   *
   * A method rather than an index into the signal, so a missing key reads as
   * an empty string in one place instead of every template line carrying its
   * own fallback.
   */
  protected valueOf(field: string): string {
    return this.values()[field] ?? '';
  }

  protected setValue(field: string, value: string): void {
    this.values.update((current) => ({ ...current, [field]: value }));
  }

  /**
   * The stored YouTube value is a bare video id, but the field takes a URL —
   * that is what a Student has to hand. Showing the id back would look like the
   * app mangled their link, so it is rebuilt into the watch URL it came from.
   */
  protected displayValue(spec: SubmissionFieldSpec): string {
    const raw = this.values()[spec.field] ?? '';
    if (spec.field !== 'youtubeVideoId' || raw.length === 0) return raw;
    return /^[A-Za-z0-9_-]{11}$/.test(raw) ? `https://www.youtube.com/watch?v=${raw}` : raw;
  }

  // ── Technologies ──────────────────────────────────────────────────────────

  protected addTechnology(): void {
    if (!this.canAddTechnology()) return;
    this.technologies.update((current) => [...current, this.technologyDraft().trim()]);
    this.technologyDraft.set('');
  }

  protected removeTechnology(item: string): void {
    this.technologies.update((current) => current.filter((entry) => entry !== item));
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  private buildInput(): SubmissionInput {
    const values = this.values();
    const input: SubmissionInput = {};

    // Only the fields this Task collects. A `NOT_USED` field is refused by the
    // server, so sending one would fail the whole save.
    for (const spec of this.activeFields()) {
      const value = (values[spec.field] ?? '').trim();
      if (value) (input as unknown as Record<string, string>)[spec.field] = value;
    }

    if (this.isFinal()) {
      const title = (values['publicProjectTitle'] ?? '').trim();
      const description = (values['publicProjectDescription'] ?? '').trim();
      const contribution = (values['myContribution'] ?? '').trim();
      if (title) input.publicProjectTitle = title;
      if (description) input.publicProjectDescription = description;
      if (contribution) input.myContribution = contribution;
      if (this.technologies().length > 0) input.technologies = [...this.technologies()];

      // CP8. Both optional, and sent only when filled — an empty string would
      // be a value the server has to decide what to do with.
      const demoTitle = (values['demoTitle'] ?? '').trim();
      const demoVideo = (values['demoVideoUrl'] ?? '').trim();
      if (demoTitle) input.demoTitle = demoTitle;
      if (demoVideo) input.demoVideoUrl = demoVideo;

      input.publicConsent = this.publicConsent();
    }

    return input;
  }

  protected saveDraft(): void {
    this.write('draft');
  }

  protected submit(): void {
    this.write('submit');
  }

  private write(mode: 'draft' | 'submit'): void {
    const task = this.openTask();
    if (!task || this.busy() || !this.isOpen()) return;
    if (mode === 'submit' && !this.canSubmit()) return;

    this.busy.set(true);
    this.clearMessages();

    const input = this.buildInput();
    const request =
      mode === 'draft'
        ? this.api.saveMyTaskDraft(task.id, input)
        : this.api.submitMyTask(task.id, input);

    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (saved) => {
        this.submission.set(saved);
        this.fillForm(saved);
        this.noticeKey.set(
          mode === 'draft' ? 'student.tasks.notices.draftSaved' : 'student.tasks.notices.submitted',
        );
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Discarding a Draft ────────────────────────────────────────────────────

  protected askDiscard(): void {
    this.clearMessages();
    this.confirmingDiscard.set(true);
  }

  protected cancelDiscard(): void {
    this.confirmingDiscard.set(false);
  }

  /**
   * Discard a Draft that was never submitted.
   *
   * Work that has been handed in cannot be discarded, by anybody. The control
   * is not offered once `hasEverBeenSubmitted` is true, and the server refuses
   * regardless — saving back to Draft must not become a way to erase the fact
   * that something was submitted.
   */
  protected confirmDiscard(): void {
    const task = this.openTask();
    if (!task || !this.canDiscard() || this.busy()) return;

    this.busy.set(true);
    this.api
      .deleteMyTaskDraft(task.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.confirmingDiscard.set(false);
          this.submission.set(null);
          this.fillForm(undefined);
          this.noticeKey.set('student.tasks.notices.draftDiscarded');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.confirmingDiscard.set(false);
          this.fail(error);
        },
      });
  }

  // ── The brief ─────────────────────────────────────────────────────────────

  protected downloadAttachment(): void {
    const task = this.openTask();
    if (!task?.attachment || this.busy()) return;

    this.busy.set(true);
    this.clearMessages();

    this.api
      .downloadTaskAttachment(task.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (blob) => {
          saveBlob(blob, task.attachment?.filename ?? 'task-brief');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private clearMessages(): void {
    this.errorKey.set(null);
    this.fieldErrors.set({});
    this.noticeKey.set(null);
  }

  private fail(error: unknown): void {
    const failure = mapTaskError(error);
    this.errorKey.set(failure.key);
    this.fieldErrors.set(failure.fields);
    this.changeDetector.markForCheck();
  }
}
