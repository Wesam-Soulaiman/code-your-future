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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  ColTemplateDirective,
  DataTableComponent,
  GridCardTemplateDirective,
  LoadDataEvent,
  PreviewTemplateDirective,
  TableColumn,
} from '../../components/shared/data-table';
import { AnswerHistoryRow } from '../../models/LiveSlides';
import { ChangeLangService } from '../../services/change-lang.service';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { formatCalendarDate, formatInstant } from '../../utils/calendar-date';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';

/** A history row with its dates and answer already rendered. */
interface HistoryRow {
  id: string;
  row: AnswerHistoryRow;
  sessionDate: string;
  submittedAt: string;
  answer: string;
  answerTypeKey: string;
}

/**
 * One Student's Live Slides answers, on their Admin profile ⟨CP6⟩.
 *
 * ── This is the "stored in the Student Profile" the product asked for ───────
 * Completed sessions only, newest first, read from the `studentProfile` index on
 * `LiveResponse`. The profile row itself stays bounded — see
 * `modules/LiveSlides/historyFunctions.ts` for why an array on the profile was
 * the wrong shape.
 *
 * ── Read-only, and it has to look read-only ─────────────────────────────────
 * There is no Edit, no Delete, no Score, no Feedback, and no correct/incorrect
 * anywhere on this table, because there is no operation behind any of them. A
 * control that existed here would be a control that cannot work.
 */
@Component({
  selector: 'cyf-student-live-answers',
  imports: [
    TranslateModule,
    AlertComponent,
    DataTableComponent,
    ColTemplateDirective,
    GridCardTemplateDirective,
    PreviewTemplateDirective,
  ],
  templateUrl: './student-live-answers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentLiveAnswersComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  /** Whose answers these are. Resolved to a profile server-side. */
  studentId = input.required<string>();

  protected items = signal<AnswerHistoryRow[]>([]);
  protected total = signal(0);
  protected loading = signal(true);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);
  protected lastLoadEvent = signal<LoadDataEvent | null>(null);

  protected columns = computed<TableColumn[]>(() => {
    this.langService.currentLang();
    return [
      {
        field: 'question',
        header: this.translate.instant('liveSlides.history.columns.question'),
        template: 'question',
      },
      {
        field: 'answer',
        header: this.translate.instant('liveSlides.history.columns.answer'),
        template: 'answer',
      },
      {
        field: 'session',
        header: this.translate.instant('liveSlides.history.columns.session'),
        template: 'session',
      },
      {
        field: 'submittedAt',
        header: this.translate.instant('liveSlides.history.columns.submittedAt'),
        template: 'submittedAt',
      },
    ];
  });

  protected rows = computed<HistoryRow[]>(() => {
    const lang = this.langService.currentLang();
    return this.items().map((row) => ({
      id: row.id,
      row,
      sessionDate: formatCalendarDate(row.sessionDate, lang),
      submittedAt: formatInstant(row.submittedAt, lang),
      // A choice answer is shown as its labels, which is what the Student
      // actually chose — an option id would mean nothing to a reader.
      answer: row.textAnswer ?? (row.selectedOptionLabels ?? []).join(' · '),
      answerTypeKey: `liveSlides.answerTypes.${row.answerType}`,
    }));
  });

  constructor() {
    effect(() => {
      const id = this.studentId();
      if (id) this.load(id, this.lastLoadEvent());
    });
  }

  protected onLoadData(event: LoadDataEvent): void {
    this.lastLoadEvent.set(event);
    this.load(this.studentId(), event);
  }

  private load(studentId: string, event: LoadDataEvent | null): void {
    this.loading.set(true);
    this.errorKey.set(null);

    this.api
      .studentAnswerHistory(studentId, {
        skip: event?.skip ?? 0,
        limit: event?.limit ?? 20,
      })
      .pipe(
        finalize(() => {
          this.loading.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (page) => {
          this.items.set(page.items ?? []);
          this.total.set(page.total ?? 0);
        },
        error: (error) => this.errorKey.set(mapLiveSlidesError(error).key),
      });
  }
}
