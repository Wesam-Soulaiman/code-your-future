import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  AdminTaskSubmission,
  BatchTask,
  TaskStudentList,
  TaskStudentRow,
} from '../../models/BatchTask';
import { ChangeLangService } from '../../services/change-lang.service';
import { TaskApiService } from '../../services/dataService/task-service';
import { formatInstant } from '../../utils/calendar-date';
import {
  PUBLICATION_STATUS,
  SUBMISSION_STATUS,
  TASK_TYPE,
  SubmissionStatus,
} from '../../utils/task-constants';
import { TaskErrorKey, mapTaskError } from '../../utils/task-error';

/** One Student's row, with its dates already rendered. */
interface StudentRow {
  row: TaskStudentRow;
  submitted: string;
  updated: string;
  /** `SUBMITTED`, `DRAFT`, or the derived `NOT_SUBMITTED`. */
  state: SubmissionStatus | 'NOT_SUBMITTED';
  tone: string;
}

const STATE_TONE: Readonly<Record<string, string>> = {
  SUBMITTED: 'success',
  DRAFT: 'warning',
  NOT_SUBMITTED: 'neutral',
};

/**
 * Who has submitted what, for one Task ⟨CP7⟩.
 *
 * ── Everybody appears ───────────────────────────────────────────────────────
 * Every enrolled Student is a row, including those who have not started. A
 * missing row *is* the answer to "who has not submitted", and deriving that
 * from absence is how somebody gets missed.
 *
 * ── Read-only, and not by convention ────────────────────────────────────────
 * There is no edit control and no delete control on this page, because there is
 * no such operation on the server: a Student's work is theirs, and an Admin who
 * could change it could change what somebody handed in. There is no grade, no
 * score, and no feedback either — the product deliberately has no review
 * workflow, so a control implying one would be promising something that does
 * not exist.
 *
 * ── The two Talent Reel controls ────────────────────────────────────────────
 * Unpublish hides a Reel and **stays** hidden: the suppression survives the
 * Student resubmitting, and only Publish Again clears it. Publish Again is not
 * a guarantee — the server re-checks eligibility, so a Student who has since
 * withdrawn consent stays unpublished, and this page says so rather than
 * pretending the button failed.
 */
@Component({
  selector: 'cyf-task-submissions',
  imports: [TranslateModule, ButtonModule, DialogModule, AlertComponent],
  templateUrl: './task-submissions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskSubmissionsComponent {
  private api = inject(TaskApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  /** The Task whose submissions these are. */
  task = input.required<BatchTask>();

  /** Go back to the Task list. */
  back = output<void>();

  protected readonly submissionStatus = SUBMISSION_STATUS;
  protected readonly publicationStatus = PUBLICATION_STATUS;
  protected readonly taskType = TASK_TYPE;

  protected loading = signal(false);
  protected busy = signal(false);
  protected errorKey = signal<TaskErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);

  protected list = signal<TaskStudentList | null>(null);
  /** The one Submission being read. Read-only, always. */
  protected open = signal<AdminTaskSubmission | null>(null);

  constructor() {
    effect(() => {
      const task = this.task();
      if (task) this.load(task.id);
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  protected rows = computed<StudentRow[]>(() => {
    const lang = this.langService.currentLang();
    return (this.list()?.items ?? []).map((row) => {
      const state = row.submissionStatus ?? 'NOT_SUBMITTED';
      return {
        row,
        state,
        submitted: formatInstant(row.submittedAt, lang),
        updated: formatInstant(row.updatedAt, lang),
        tone: STATE_TONE[state] ?? 'neutral',
      };
    });
  });

  protected isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  protected isFinal = computed(() => this.task().type === TASK_TYPE.FINAL_TASK);

  /**
   * The video link for a Reel, built from the id alone.
   *
   * The server stores eleven characters and nothing else — never embed HTML,
   * never a URL somebody pasted with a tracking string on it. The link is
   * rebuilt here, so what opens is always a plain YouTube watch page.
   */
  protected watchUrl(videoId: string | undefined): string {
    return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : '';
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private load(taskId: string): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .listTaskSubmissions(taskId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => {
          this.list.set(list);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected reload(): void {
    this.load(this.task().id);
  }

  // ── One Submission ────────────────────────────────────────────────────────

  protected openSubmission(row: TaskStudentRow): void {
    if (!row.submissionId || this.busy()) return;
    this.busy.set(true);
    this.clearMessages();

    this.api
      .getTaskSubmission(row.submissionId)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (submission) => {
          this.open.set(submission);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected closeSubmission(): void {
    this.open.set(null);
  }

  // ── Talent Reel ───────────────────────────────────────────────────────────

  /**
   * The Reel controls act on the publication, which this page reaches through
   * the Submission it belongs to. There is only ever one publication per
   * Submission, guaranteed by a unique index rather than by looking first.
   */
  protected unpublish(submission: AdminTaskSubmission): void {
    this.actOnReel(submission, 'unpublish');
  }

  protected republish(submission: AdminTaskSubmission): void {
    this.actOnReel(submission, 'republish');
  }

  /**
   * Highlight this Reel, or stop highlighting it ⟨CP8C⟩.
   *
   * Ordering on the public pages, and nothing else. It is deliberately the same
   * code path as the two publication controls: the server is the one that
   * decides whether a pin is allowed, and the page renders whatever comes back
   * rather than predicting it.
   */
  protected pin(submission: AdminTaskSubmission): void {
    this.actOnReel(submission, 'pin');
  }

  protected unpin(submission: AdminTaskSubmission): void {
    this.actOnReel(submission, 'unpin');
  }

  private actOnReel(
    submission: AdminTaskSubmission,
    action: 'unpublish' | 'republish' | 'pin' | 'unpin',
  ): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearMessages();

    const request =
      action === 'unpublish'
        ? this.api.unpublishTalentReel(submission.id)
        : action === 'republish'
          ? this.api.republishTalentReel(submission.id)
          : action === 'pin'
            ? this.api.pinTalentReel(submission.id)
            : this.api.unpinTalentReel(submission.id);

    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (publication) => {
        this.open.set({
          ...submission,
          talentReelStatus: publication.status,
          talentReelPinned: publication.pinned,
        });
        // Publish Again can legitimately leave a Reel unpublished — the Student
        // may have withdrawn consent since. Saying so is more useful than a
        // success message that does not match what the page now shows.
        // Named rather than derived from the action: appending "ed" worked for
        // the first two verbs and produced "pined" for the third.
        const NOTICES: Record<typeof action, string> = {
          unpublish: 'unpublished',
          republish: 'republished',
          pin: 'pinned',
          unpin: 'unpinned',
        };
        this.noticeKey.set(
          action === 'republish' && publication.status !== PUBLICATION_STATUS.PUBLISHED
            ? 'admin.tasks.reel.notices.stillUnpublished'
            : `admin.tasks.reel.notices.${NOTICES[action]}`,
        );
        this.reload();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private clearMessages(): void {
    this.errorKey.set(null);
    this.noticeKey.set(null);
  }

  private fail(error: unknown): void {
    this.errorKey.set(mapTaskError(error).key);
    this.changeDetector.markForCheck();
  }
}
