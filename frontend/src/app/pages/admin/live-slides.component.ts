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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { LiveSession, SessionStatus, SessionSummary } from '../../models/LiveSlides';
import { ChangeLangService } from '../../services/change-lang.service';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { formatCalendarDate } from '../../utils/calendar-date';
import { LIVE_LIMITS, SESSION_STATUS, SESSION_STATUS_TONE } from '../../utils/live-slides-constants';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';
import { LivePresenterComponent } from './live-presenter.component';
import { LiveResultsComponent } from './live-results.component';
import { SlideBuilderComponent } from './slide-builder.component';

/** A session row with its date already rendered. */
interface SessionRow {
  session: SessionSummary;
  date: string;
  tone: string;
}

/**
 * Live Slides for one Batch, as its Admin manages them ⟨CP6⟩.
 *
 * ── One tab, five states ────────────────────────────────────────────────────
 * There is no session yet; there is a list of them; one is being built; one is
 * ready; one is being presented; one has finished. The prototype dispatches the
 * same way, and it is the right shape: an Admin is only ever doing one of these
 * things, and showing the others would be showing controls that do nothing.
 *
 * ── The lifecycle is the server's, not this page's ──────────────────────────
 * Every status change is a named operation — Mark Ready, Back to Draft, Start,
 * End — and each one is refused server-side if it is not a legal move. This page
 * offers the moves that are legal *and* the server checks again, because a
 * disabled button is a courtesy and not a rule.
 *
 * ── A Batch that cannot host a session says so ──────────────────────────────
 * A draft Batch may be prepared but not started, and an archived one is
 * read-only throughout. Both are stated in words rather than left as a button
 * that silently does nothing.
 */
@Component({
  selector: 'cyf-live-slides',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DatePickerModule,
    AlertComponent,
    SlideBuilderComponent,
    LivePresenterComponent,
    LiveResultsComponent,
  ],
  templateUrl: './live-slides.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveSlidesComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  /** The Batch these sessions belong to. */
  batchId = input.required<string>();

  /**
   * What the Batch page already knows about its status.
   *
   * The server says the same thing in every list response and that answer wins;
   * this input only spares the panel from rendering write controls for a moment
   * before the first response arrives.
   */
  archived = input(false);

  protected readonly limits = LIVE_LIMITS;
  protected readonly SESSION_STATUS = SESSION_STATUS;

  // ── State ─────────────────────────────────────────────────────────────────

  protected sessions = signal<SessionSummary[]>([]);
  protected canCreate = signal(true);
  protected canStart = signal(false);
  protected serverReadOnly = signal(false);

  /** The session being worked on. Null while the list is showing. */
  protected openSession = signal<LiveSession | null>(null);

  protected loading = signal(true);
  protected busy = signal(false);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});

  // ── Create / edit dialog ──────────────────────────────────────────────────

  protected formOpen = signal(false);
  protected editingId = signal('');
  protected formTitle = signal('');
  protected formDescription = signal('');
  protected formDate = signal<Date | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────

  protected readOnly = computed(() => this.serverReadOnly() || this.archived());

  protected rows = computed<SessionRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.sessions().map((session) => ({
      session,
      date: formatCalendarDate(session.sessionDate, lang),
      tone: SESSION_STATUS_TONE[session.status] ?? 'neutral',
    }));
  });

  /** The one session that is running, if any. */
  protected liveSession = computed(() =>
    this.sessions().find((session) => session.status === SESSION_STATUS.LIVE),
  );

  constructor() {
    effect(() => {
      const id = this.batchId();
      if (id) this.load(id);
    });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  protected load(batchId = this.batchId()): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .listSessions(batchId)
      .pipe(
        finalize(() => {
          this.loading.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (result) => {
          this.sessions.set(result.items ?? []);
          this.canCreate.set(result.canCreate);
          this.canStart.set(result.canStart);
          this.serverReadOnly.set(result.readOnly);
        },
        error: (error) => this.fail(error),
      });
  }

  /** Open one session and switch the tab to whatever state it is in. */
  protected open(sessionId: string): void {
    this.busy.set(true);
    this.errorKey.set(null);

    this.api
      .getSession(sessionId)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => this.openSession.set(session),
        error: (error) => this.fail(error),
      });
  }

  /** Go back to the list, reloading it so a status change is reflected. */
  protected closeSession(): void {
    this.openSession.set(null);
    this.load();
  }

  /** A child changed the session; keep the open copy and the list in step. */
  protected onSessionChanged(session: LiveSession): void {
    this.openSession.set(session);
    this.load();
  }

  // ── Create and edit ───────────────────────────────────────────────────────

  protected openCreate(): void {
    this.editingId.set('');
    this.formTitle.set('');
    this.formDescription.set('');
    this.formDate.set(new Date());
    this.fieldErrors.set({});
    this.errorKey.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(session: LiveSession): void {
    this.editingId.set(session.id);
    this.formTitle.set(session.title);
    this.formDescription.set(session.description ?? '');
    this.formDate.set(session.sessionDate ? new Date(`${session.sessionDate}T00:00:00Z`) : null);
    this.fieldErrors.set({});
    this.errorKey.set(null);
    this.formOpen.set(true);
  }

  /**
   * The date, as the day that was picked.
   *
   * Read from the picker's local calendar fields rather than `toISOString()`,
   * which would shift the day for anybody east or west of UTC — a lecture on
   * the 10th must not be stored as the 9th.
   */
  private isoDate(date: Date | null): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  protected saveSession(): void {
    if (this.busy()) return;

    const input = {
      title: this.formTitle().trim(),
      description: this.formDescription().trim() || undefined,
      sessionDate: this.isoDate(this.formDate()),
    };

    this.busy.set(true);
    this.errorKey.set(null);
    this.fieldErrors.set({});

    const id = this.editingId();
    const request = id
      ? this.api.updateSession(id, input)
      : this.api.createSession(this.batchId(), input);

    request
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => {
          this.formOpen.set(false);
          this.noticeKey.set(id ? 'liveSlides.notices.updated' : 'liveSlides.notices.created');
          this.openSession.set(session);
          this.load();
        },
        error: (error) => this.fail(error),
      });
  }

  // ── Lifecycle actions ─────────────────────────────────────────────────────

  protected duplicate(sessionId: string): void {
    this.run(this.api.duplicateSession(sessionId), 'liveSlides.notices.duplicated', (session) =>
      this.openSession.set(session),
    );
  }

  /** Run a session action, reporting it once and reloading the list. */
  private run(
    request: ReturnType<LiveSlidesApiService['duplicateSession']>,
    noticeKey: string,
    onDone?: (session: LiveSession) => void,
  ): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);

    request
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => {
          this.noticeKey.set(noticeKey);
          onDone?.(session);
          this.load();
        },
        error: (error) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    const failure = mapLiveSlidesError(error);
    this.errorKey.set(failure.key);
    this.fieldErrors.set(failure.fields);
    this.noticeKey.set(null);
  }

  protected dismissNotice(): void {
    this.noticeKey.set(null);
  }

  protected fieldError(field: string): string {
    const key = this.fieldErrors()[field];
    return key ? this.translate.instant(key) : '';
  }

  protected statusKey(status: SessionStatus): string {
    return `liveSlides.status.${status}`;
  }

  /** The chip tone for a status, from the shared map. */
  protected tone(status: SessionStatus): string {
    return SESSION_STATUS_TONE[status] ?? 'neutral';
  }

  /** Whether the create form's own rules are satisfied. */
  protected formValid = computed(() => {
    const title = this.formTitle().trim();
    return (
      title.length >= LIVE_LIMITS.sessionTitle.min &&
      title.length <= LIVE_LIMITS.sessionTitle.max &&
      this.formDate() !== null &&
      this.formDescription().trim().length <= LIVE_LIMITS.sessionDescription.max
    );
  });
}
