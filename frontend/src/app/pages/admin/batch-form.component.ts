import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { ADMIN_BATCHES } from '../../guards/home-route';
import { Batch, BatchInput } from '../../models/Batch';
import { BatchApiService } from '../../services/dataService/batch-service';
import {
  BATCH_CREATE_STATUSES,
  BATCH_LIMITS,
  BATCH_STATUS,
  BatchStatus,
} from '../../utils/batch-constants';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';

/** The form's working copy. Dates are `Date` because that is what the picker binds. */
interface BatchForm {
  name: string;
  description: string;
  startDate: Date | null;
  endDate: Date | null;
  status: BatchStatus;
}

const EMPTY_FORM: BatchForm = {
  name: '',
  description: '',
  startDate: null,
  endDate: null,
  status: BATCH_STATUS.DRAFT,
};

/**
 * Create or edit a Batch.
 *
 * One component serves both, because the two differ in exactly two ways: an
 * edit loads first, and a create offers the initial status. Splitting them would
 * duplicate every field and every validation rule so that the two could drift.
 *
 * ── Dates are calendar dates, not instants ──────────────────────────────────
 * The picker hands back a local `Date`. It is serialised by reading the local
 * year, month, and day off it — **not** with `toISOString()`, which converts to
 * UTC and, for anyone east of Greenwich in the evening, sends the following day.
 *
 * ── The client checks; the server decides ───────────────────────────────────
 * Validation here exists to catch mistakes early. Every rule is re-applied
 * server-side, and a field-level rejection from the backend replaces whatever
 * this form concluded.
 *
 * ── An archived Batch never reaches this page ───────────────────────────────
 * Archived is terminal and read-only. The detail page offers no edit action for
 * one, and if somebody arrives here anyway the load reports it and the form
 * stays disabled rather than collecting changes the server will refuse.
 */
@Component({
  selector: 'app-admin-batch-form',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    AlertComponent,
  ],
  templateUrl: './batch-form.component.html',
  styleUrl: './batch-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminBatchFormComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private batchApi = inject(BatchApiService);
  private changeDetector = inject(ChangeDetectorRef);

  protected readonly limits = BATCH_LIMITS;

  /** Only Draft and Active may be chosen at creation. The rest are transitions. */
  protected readonly creationStatuses = BATCH_CREATE_STATUSES.map((status) => ({
    value: status,
    labelKey: `batch.status.${status}`,
  }));

  private batchId = signal('');
  protected isEditing = computed(() => this.batchId().length > 0);

  protected form = signal<BatchForm>({ ...EMPTY_FORM });
  protected loading = signal(false);
  protected saving = signal(false);
  protected errorKey = signal<BatchErrorKey | null>(null);
  protected serverFieldErrors = signal<Record<string, string>>({});
  protected touched = signal<Record<string, boolean>>({});

  /** True when the loaded Batch can no longer be changed. */
  protected readOnly = signal(false);

  /** An end date can never precede the start, so the picker will not offer one. */
  protected minEndDate = computed(() => this.form().startDate ?? null);

  constructor() {
    const id = String(this.route.snapshot.paramMap.get('batchId') ?? '');
    // `/batches/new` is the create route; anything else is an id to load.
    if (id && id !== 'new') {
      this.batchId.set(id);
      this.load(id);
    }
  }

  private load(id: string): void {
    this.loading.set(true);

    this.batchApi
      .adminGetBatch(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ batch }) => {
          this.form.set({
            name: batch.name,
            description: batch.description ?? '',
            startDate: this.toDate(batch.startDate),
            endDate: this.toDate(batch.endDate),
            status: batch.status,
          });
          this.readOnly.set(batch.readOnly);
          if (batch.readOnly) this.errorKey.set('batch.errors.readOnly');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapBatchError(error).key);
          this.readOnly.set(true);
          this.changeDetector.markForCheck();
        },
      });
  }

  // ── Form plumbing ─────────────────────────────────────────────────────────

  protected update<K extends keyof BatchForm>(field: K, value: BatchForm[K]): void {
    this.form.update((current) => ({ ...current, [field]: value }));
    // A field the server complained about stops complaining once it is touched;
    // the server gets to complain again on the next save if it still applies.
    if (this.serverFieldErrors()[field as string]) {
      this.serverFieldErrors.update((errors) => {
        const next = { ...errors };
        delete next[field as string];
        return next;
      });
    }
  }

  protected markTouched(field: keyof BatchForm): void {
    this.touched.update((current) => ({ ...current, [field]: true }));
  }

  /**
   * The message for a field, or null.
   *
   * A server rejection always wins over a local rule: it is the authoritative
   * answer, and showing the local guess instead would tell somebody their input
   * is fine when the save just refused it.
   */
  protected fieldError(field: keyof BatchForm): string | null {
    const fromServer = this.serverFieldErrors()[field as string];
    if (fromServer) return fromServer;

    if (!this.touched()[field]) return null;
    return this.localError(field);
  }

  private localError(field: keyof BatchForm): string | null {
    const form = this.form();

    if (field === 'name') {
      const name = form.name.trim();
      if (name.length === 0) return 'student.profile.fieldErrors.required';
      if (name.length < this.limits.name.min) return 'student.profile.fieldErrors.tooShort';
      if (name.length > this.limits.name.max) return 'student.profile.fieldErrors.tooLong';
    }

    if (field === 'description' && form.description.length > this.limits.description.max) {
      return 'student.profile.fieldErrors.tooLong';
    }

    if (field === 'startDate' && !form.startDate) {
      return 'student.profile.fieldErrors.required';
    }

    if (field === 'endDate' && form.endDate && form.startDate && form.endDate < form.startDate) {
      return 'admin.batches.fieldErrors.endBeforeStart';
    }

    return null;
  }

  protected canSubmit = computed(() => {
    const form = this.form();
    if (this.saving() || this.loading() || this.readOnly()) return false;
    if (form.name.trim().length < this.limits.name.min) return false;
    if (form.name.trim().length > this.limits.name.max) return false;
    if (form.description.length > this.limits.description.max) return false;
    if (!form.startDate) return false;
    if (form.endDate && form.endDate < form.startDate) return false;
    return true;
  });

  protected descriptionCount = computed(() => this.form().description.length);

  // ── Saving ────────────────────────────────────────────────────────────────

  protected submit(): void {
    // Everything is marked touched so a blocked save explains itself rather
    // than leaving a disabled button with no reason beside it.
    this.touched.set({
      name: true,
      description: true,
      startDate: true,
      endDate: true,
      status: true,
    });
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.errorKey.set(null);
    this.serverFieldErrors.set({});

    const input = this.toInput();
    const request = this.isEditing()
      ? this.batchApi.adminUpdateBatch(this.batchId(), input)
      : this.batchApi.adminCreateBatch(input);

    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (batch: Batch) => this.router.navigate([ADMIN_BATCHES, batch.id]),
      error: (error: unknown) => {
        const failure = mapBatchError(error);
        this.errorKey.set(failure.key);
        this.serverFieldErrors.set(failure.fields);
        this.changeDetector.markForCheck();
      },
    });
  }

  protected cancel(): void {
    if (this.isEditing()) {
      this.router.navigate([ADMIN_BATCHES, this.batchId()]);
      return;
    }
    this.router.navigate([ADMIN_BATCHES]);
  }

  /** Exactly the writable fields. Status is sent only on create. */
  private toInput(): BatchInput {
    const form = this.form();
    const input: BatchInput = {
      name: form.name.trim(),
      startDate: this.toCalendarDate(form.startDate)!,
    };

    const description = form.description.trim();
    if (description) input.description = description;

    const endDate = this.toCalendarDate(form.endDate);
    if (endDate) input.endDate = endDate;

    // On edit, status is changed through its own transition operation, which
    // enforces the allowed moves. Sending it here would be a second, weaker
    // path to the same state.
    if (!this.isEditing()) input.status = form.status;

    return input;
  }

  /**
   * A `Date` from the picker to `YYYY-MM-DD`.
   *
   * Local parts, deliberately. `toISOString()` would convert to UTC first, and
   * a date picked at 22:00 in Damascus would be sent as the next day.
   */
  private toCalendarDate(value: Date | null): string | undefined {
    if (!value) return undefined;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** The inverse: `YYYY-MM-DD` to a local `Date`, with no zone shift. */
  private toDate(value: string | undefined): Date | null {
    if (!value) return null;
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return null;
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  }
}
