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
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { Batch } from '../../models/Batch';
import { BatchTask, TaskInput, TaskList } from '../../models/BatchTask';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { TaskApiService } from '../../services/dataService/task-service';
import { formatInstant } from '../../utils/calendar-date';
import { saveBlob } from '../../utils/save-blob';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_BYTES,
  REQUIREMENT,
  REQUIREMENT_COLUMNS,
  Requirement,
  SUBMISSION_FIELDS,
  TASK_LIMITS,
  TASK_STATUS,
  TASK_TRANSITIONS,
  TASK_TYPE,
  TaskStatus,
  TaskType,
  formatAttachmentSize,
} from '../../utils/task-constants';
import { TaskErrorKey, mapTaskError } from '../../utils/task-error';
import { TaskSubmissionsComponent } from './task-submissions.component';

/** A Task row with everything the list needs already rendered. */
interface TaskRow {
  task: BatchTask;
  deadline: string;
  attachmentSize: string;
  /** The transitions this status allows. The server checks again. */
  nextStatuses: readonly TaskStatus[];
}

/** How each status is coloured. Kept beside the vocabulary, not in the template. */
const STATUS_TONE: Readonly<Record<TaskStatus, string>> = {
  [TASK_STATUS.DRAFT]: 'neutral',
  [TASK_STATUS.PUBLISHED]: 'success',
  [TASK_STATUS.CLOSED]: 'warning',
  [TASK_STATUS.ARCHIVED]: 'info',
};

/**
 * The Tasks of one Batch, as its Admin manages them ⟨CP7⟩.
 *
 * ── One tab, three views ────────────────────────────────────────────────────
 * The list, the form, and one Task's submissions. An Admin is only ever doing
 * one of these, and showing the others would be showing controls that do
 * nothing to what they are looking at.
 *
 * ── The lifecycle is the server's, not this page's ──────────────────────────
 * Every status change is a named operation, and each is re-checked server-side.
 * Two of the transitions carry conditions this page cannot see — returning to
 * Draft needs no Submission to exist, and reopening needs an active Batch with
 * an unexpired deadline — so the buttons offered here are a courtesy and the
 * server's refusal is the rule.
 *
 * ── A deadline that has passed does not change anything ─────────────────────
 * A Published Task past its deadline stays Published. It simply stops accepting
 * work, which the server reports as `isSubmissionOpen` and `availabilityReason`
 * on every read. Nothing here computes that from the browser's clock — that
 * clock belongs to whoever is sitting in front of it.
 *
 * ── What an Admin cannot do ─────────────────────────────────────────────────
 * There is no edit and no delete for a Student's Submission anywhere on this
 * page, because there is no such operation on the server. There is no grade, no
 * score, and no feedback, because the product has no review workflow.
 */
@Component({
  selector: 'cyf-batch-tasks',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DatePickerModule,
    AlertComponent,
    TaskSubmissionsComponent,
  ],
  templateUrl: './batch-tasks.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BatchTasksComponent {
  private api = inject(TaskApiService);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  /** The Batch these Tasks belong to. */
  batchId = input.required<string>();
  /** A read-only Batch. Archived is read-only, not invisible. */
  archived = input(false);

  protected readonly limits = TASK_LIMITS;
  protected readonly taskType = TASK_TYPE;
  protected readonly taskStatus = TASK_STATUS;
  protected readonly requirement = REQUIREMENT;
  protected readonly submissionFields = SUBMISSION_FIELDS;
  protected readonly attachmentAccept = ATTACHMENT_ACCEPT;
  protected readonly attachmentExtensions = ATTACHMENT_EXTENSIONS.join(' ');
  protected readonly attachmentMax = formatAttachmentSize(ATTACHMENT_MAX_BYTES);
  protected readonly statusTone = STATUS_TONE;

  // ── State ─────────────────────────────────────────────────────────────────

  protected loading = signal(false);
  protected busy = signal(false);
  protected errorKey = signal<TaskErrorKey | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});
  protected noticeKey = signal<string | null>(null);

  protected list = signal<TaskList | null>(null);
  protected view = signal<'list' | 'form' | 'submissions'>('list');
  /** The Task being edited. `null` while creating. */
  protected editing = signal<BatchTask | null>(null);
  protected openTask = signal<BatchTask | null>(null);

  // ── The form ──────────────────────────────────────────────────────────────

  protected formTitle = signal('');
  protected formDescription = signal('');
  protected formType = signal<TaskType>(TASK_TYPE.ASSIGNMENT);
  protected formDeadline = signal<Date | null>(null);
  protected formRequirements = signal<Record<string, Requirement>>(this.blankRequirements());
  protected chosenFile = signal<File | null>(null);

  // ── Dialogs ───────────────────────────────────────────────────────────────

  protected confirmingDelete = signal<BatchTask | null>(null);
  protected copying = signal<BatchTask | null>(null);
  protected copyTargets = signal<Batch[]>([]);
  protected copyTargetId = signal('');

  constructor() {
    effect(() => {
      const batchId = this.batchId();
      if (batchId) this.load(batchId);
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  protected rows = computed<TaskRow[]>(() => {
    const lang = this.langService.currentLang();
    return (this.list()?.items ?? []).map((task) => ({
      task,
      deadline: formatInstant(task.deadline, lang),
      attachmentSize: task.attachment ? formatAttachmentSize(task.attachment.size) : '',
      nextStatuses: TASK_TRANSITIONS[task.status] ?? [],
    }));
  });

  protected isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  /**
   * Whether a Final Task may still be created.
   *
   * A Batch holds at most one, so the option is hidden rather than offered and
   * then refused. The server enforces it with a unique index either way, which
   * is what makes two simultaneous creates end with exactly one Task.
   */
  protected canCreateFinal = computed(() => {
    if (this.list()?.hasFinalTask !== true) return true;
    // While editing the existing Final Task, its own type is still legitimate.
    return this.editing()?.type === TASK_TYPE.FINAL_TASK;
  });

  protected canSave = computed(() => {
    const title = this.formTitle().trim();
    const description = this.formDescription().trim();
    return (
      title.length >= this.limits.title.min &&
      title.length <= this.limits.title.max &&
      description.length >= this.limits.description.min &&
      description.length <= this.limits.description.max
    );
  });

  /** Whether the requirements and the attachment are frozen by a Submission. */
  protected frozen = computed(() => this.editing()?.requirementsFrozen === true);

  protected readOnly = computed(() => this.archived() || this.list()?.canCreate === false);

  protected chosenFileName = computed(() => this.chosenFile()?.name ?? '');

  /** A byte count the attachment row can show. */
  protected attachmentSizeOf(bytes: number): string {
    return formatAttachmentSize(bytes);
  }

  /**
   * Whether this transition is worth offering at all.
   *
   * The transition table says which moves exist; `canPublish` says whether the
   * Batch is in a state that accepts one. Publishing into a Batch that is not
   * active is refused server-side, and offering the button anyway meant an
   * Admin pressed it and got an error for no reason they could see — which is
   * how this was found, in a real log.
   *
   * Every other move stays offered, and the server still checks all of them.
   */
  protected canOffer(next: TaskStatus): boolean {
    if (next !== TASK_STATUS.PUBLISHED) return true;
    return this.list()?.canPublish !== false;
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private load(batchId: string): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .listTasks(batchId)
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
    this.load(this.batchId());
  }

  // ── The form ──────────────────────────────────────────────────────────────

  private blankRequirements(): Record<string, Requirement> {
    const requirements: Record<string, Requirement> = {};
    for (const column of REQUIREMENT_COLUMNS) requirements[column] = REQUIREMENT.NOT_USED;
    return requirements;
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.formTitle.set('');
    this.formDescription.set('');
    this.formType.set(TASK_TYPE.ASSIGNMENT);
    this.formDeadline.set(null);
    this.formRequirements.set(this.blankRequirements());
    this.chosenFile.set(null);
    this.clearMessages();
    this.view.set('form');
  }

  protected openEdit(task: BatchTask): void {
    this.editing.set(task);
    this.formTitle.set(task.title);
    this.formDescription.set(task.description);
    this.formType.set(task.type);
    this.formDeadline.set(task.deadline ? new Date(task.deadline) : null);

    const requirements = this.blankRequirements();
    for (const column of REQUIREMENT_COLUMNS) {
      const level = (task.requirements as unknown as Record<string, Requirement>)[column];
      if (level) requirements[column] = level;
    }
    this.formRequirements.set(requirements);

    this.chosenFile.set(null);
    this.clearMessages();
    this.view.set('form');
  }

  protected closeForm(): void {
    this.view.set('list');
    this.editing.set(null);
    this.chosenFile.set(null);
    this.clearMessages();
  }

  protected setRequirement(column: string, level: Requirement): void {
    this.formRequirements.update((current) => ({ ...current, [column]: level }));
  }

  /**
   * Save the Task.
   *
   * The deadline is sent as an instant in UTC. The picker works in the
   * Admin's own zone, which is the only zone they can reason about; converting
   * once, here, is what stops "17:00" meaning two different moments to two
   * people.
   */
  protected save(): void {
    if (!this.canSave() || this.busy()) return;

    const editing = this.editing();
    const deadline = this.formDeadline();
    const input: TaskInput = {
      title: this.formTitle().trim(),
      description: this.formDescription().trim(),
      deadline: deadline ? deadline.toISOString() : null,
    };

    // Requirements are frozen once work exists, so they are not sent at all
    // rather than sent and refused.
    if (!this.frozen()) {
      const requirements = this.formRequirements();
      for (const column of REQUIREMENT_COLUMNS) {
        (input as unknown as Record<string, Requirement>)[column] = requirements[column];
      }
    }

    this.busy.set(true);
    this.clearMessages();

    const request = editing
      ? this.api.updateTask(editing.id, input)
      : this.api.createTask(this.batchId(), { ...input, type: this.formType() });

    request.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (task) => {
        const file = this.chosenFile();
        if (file) {
          this.uploadAttachment(task, file);
          return;
        }
        this.noticeKey.set(editing ? 'admin.tasks.notices.updated' : 'admin.tasks.notices.created');
        this.closeFormAndReload();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private closeFormAndReload(): void {
    this.view.set('list');
    this.editing.set(null);
    this.chosenFile.set(null);
    this.reload();
    this.changeDetector.markForCheck();
  }

  // ── The attachment ────────────────────────────────────────────────────────

  /**
   * Take a file from the picker.
   *
   * Size and extension are refused in the browser purely so somebody does not
   * wait for a 20 MiB upload to be told no at the end. Neither check is
   * trusted: the server looks at the bytes themselves, which is the only thing
   * an uploader cannot simply rename.
   */
  protected chooseFile(input: HTMLInputElement): void {
    const file = input.files?.[0] ?? null;
    this.clearMessages();

    if (!file) {
      this.chosenFile.set(null);
      return;
    }

    if (file.size > ATTACHMENT_MAX_BYTES) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('tasks.errors.attachmentTooLarge');
      return;
    }

    if (file.size === 0) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('tasks.errors.attachmentInvalid');
      return;
    }

    const dot = file.name.lastIndexOf('.');
    const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
    if (!ATTACHMENT_EXTENSIONS.includes(extension)) {
      this.chosenFile.set(null);
      input.value = '';
      this.errorKey.set('tasks.errors.attachmentInvalid');
      return;
    }

    this.chosenFile.set(file);
  }

  private uploadAttachment(task: BatchTask, file: File): void {
    this.busy.set(true);

    this.api
      .uploadTaskAttachment(task.id, file)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.noticeKey.set('admin.tasks.notices.attachmentSaved');
          this.closeFormAndReload();
        },
        // The Task itself saved; only the brief did not. Said plainly, because
        // the alternative is an Admin who thinks nothing was stored.
        error: (error: unknown) => {
          this.fail(error);
          this.reload();
        },
      });
  }

  protected removeAttachment(task: BatchTask): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearMessages();

    this.api
      .removeTaskAttachment(task.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.noticeKey.set('admin.tasks.notices.attachmentRemoved');
          if (this.view() === 'form') this.closeFormAndReload();
          else this.reload();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected downloadAttachment(task: BatchTask): void {
    if (this.busy() || !task.attachment) return;
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

  // ── The lifecycle ─────────────────────────────────────────────────────────

  protected setStatus(task: BatchTask, status: TaskStatus): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.clearMessages();

    this.api
      .setTaskStatus(task.id, status)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.noticeKey.set(`admin.tasks.notices.status.${status}`);
          this.reload();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected askDelete(task: BatchTask): void {
    this.clearMessages();
    this.confirmingDelete.set(task);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected confirmDelete(): void {
    const task = this.confirmingDelete();
    if (!task || this.busy()) return;

    this.busy.set(true);
    this.api
      .deleteTask(task.id)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.confirmingDelete.set(null);
          this.noticeKey.set('admin.tasks.notices.deleted');
          this.reload();
        },
        error: (error: unknown) => {
          this.confirmingDelete.set(null);
          this.fail(error);
        },
      });
  }

  // ── Copying ───────────────────────────────────────────────────────────────

  protected askCopy(task: BatchTask): void {
    this.clearMessages();
    this.copyTargetId.set('');
    this.copying.set(task);

    this.batchApi.adminListBatches({ limit: 100 }).subscribe({
      next: (page) => {
        // A Task cannot be copied onto itself, and an archived Batch accepts
        // nothing new.
        this.copyTargets.set(
          page.items.filter(
            (batch) => batch.id !== this.batchId() && batch.status !== 'archived',
          ),
        );
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  protected cancelCopy(): void {
    this.copying.set(null);
    this.copyTargets.set([]);
  }

  protected confirmCopy(): void {
    const task = this.copying();
    const target = this.copyTargetId();
    if (!task || !target || this.busy()) return;

    this.busy.set(true);
    this.api
      .copyTask(task.id, target)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (result) => {
          this.copying.set(null);
          // Said explicitly. The brief does not travel, and an Admin who is not
          // told will find out by opening the copy and finding nothing there.
          this.noticeKey.set(
            result.attachmentCopied
              ? 'admin.tasks.notices.copied'
              : 'admin.tasks.notices.copiedWithoutAttachment',
          );
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.copying.set(null);
          this.fail(error);
        },
      });
  }

  // ── Submissions ───────────────────────────────────────────────────────────

  protected openSubmissions(task: BatchTask): void {
    this.clearMessages();
    this.openTask.set(task);
    this.view.set('submissions');
  }

  protected backToList(): void {
    this.openTask.set(null);
    this.view.set('list');
    this.reload();
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
