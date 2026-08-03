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
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { finalize, switchMap } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { AnswerType, LiveSession, Slide, SlideInput, SlideType } from '../../models/LiveSlides';
import { LiveSlidesApiService } from '../../services/dataService/live-slides-service';
import { ChangeLangService } from '../../services/change-lang.service';
import {
  ANSWER_TYPES,
  LIVE_LIMITS,
  OPTION_COUNT,
  SESSION_STATUS,
  SLIDE_TYPE,
  answerTypeIcon,
  needsOptions,
  slideIcon,
} from '../../utils/live-slides-constants';
import { LiveSlidesErrorKey, mapLiveSlidesError } from '../../utils/live-slides-error';

/** One option in the editor, before it is saved. */
interface DraftOption {
  id?: string;
  text: string;
}

/**
 * The Draft slide builder, and the Ready summary ⟨CP6⟩.
 *
 * ── Two states, one component ───────────────────────────────────────────────
 * Draft edits and Ready reviews the same deck. Splitting them would duplicate
 * the slide list and the preview, and the difference between them is exactly
 * one boolean: whether the controls are there.
 *
 * ── Order is a full sequence, not a nudge ───────────────────────────────────
 * The move buttons rebuild the whole list and send all of it, so two Admins
 * reordering at once cannot interleave into an order neither chose. Buttons
 * rather than drag-and-drop: dragging needs a pointer, a steady hand, and a
 * library, and it does not work from a keyboard.
 */
@Component({
  selector: 'cyf-slide-builder',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    AlertComponent,
  ],
  templateUrl: './slide-builder.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlideBuilderComponent {
  private api = inject(LiveSlidesApiService);
  private changeDetector = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  protected langService = inject(ChangeLangService);

  session = input.required<LiveSession>();
  readOnly = input(false);
  canStart = input(false);

  sessionChanged = output<LiveSession>();
  editMetadata = output<void>();

  protected readonly limits = LIVE_LIMITS;
  protected readonly optionCount = OPTION_COUNT;
  protected readonly SLIDE_TYPE = SLIDE_TYPE;
  protected readonly slideIcon = slideIcon;
  protected readonly answerTypeIcon = answerTypeIcon;

  protected busy = signal(false);
  protected errorKey = signal<LiveSlidesErrorKey | null>(null);
  protected fieldErrors = signal<Record<string, string>>({});

  protected selectedId = signal('');
  protected addOpen = signal(false);
  protected confirmDelete = signal<Slide | null>(null);
  protected confirmStart = signal(false);

  // ── Editor state, local until Save ────────────────────────────────────────
  protected draftTitle = signal('');
  protected draftContent = signal('');
  protected draftQuestion = signal('');
  protected draftDescription = signal('');
  protected draftAnswerType = signal<AnswerType>('SHORT_ANSWER');
  protected draftOptions = signal<DraftOption[]>([]);

  /** Answer types as the picker's options, translated. */
  protected answerTypeOptions = computed(() => {
    this.langService.currentLang();
    return ANSWER_TYPES.map((value) => ({
      value,
      label: this.translate.instant(`liveSlides.answerTypes.${value}`),
    }));
  });

  /** Local server snapshot so a newly created slide is available immediately. */
  protected slides = signal<Slide[]>([]);

  protected editable = computed(
    () => this.session().status === SESSION_STATUS.DRAFT && !this.readOnly(),
  );

  protected isReady = computed(() => this.session().status === SESSION_STATUS.READY);

  protected selected = computed<Slide | undefined>(() => {
    const all = this.slides();
    return all.find((slide) => slide.id === this.selectedId()) ?? all[0];
  });

  protected selectedIndex = computed(() =>
    this.slides().findIndex((slide) => slide.id === this.selected()?.id),
  );

  protected questionCount = computed(
    () => this.slides().filter((slide) => slide.type === SLIDE_TYPE.QUESTION).length,
  );

  /** Ready needs at least one Slide and at least one Question. */
  protected canMarkReady = computed(
    () => this.slides().length > 0 && this.questionCount() > 0 && this.editable(),
  );

  protected showOptions = computed(() => needsOptions(this.draftAnswerType()));

  /** The single global Save action writes the currently selected slide. */
  protected hasUnsavedChanges = computed(() => {
    const slide = this.selected();
    if (!slide || !this.editable()) return false;

    if (slide.type === SLIDE_TYPE.INFORMATION) {
      return (
        this.draftTitle() !== (slide.title ?? '') ||
        this.draftContent() !== (slide.content ?? '')
      );
    }

    const storedOptions = slide.options ?? [];
    const draftOptions = this.draftOptions();
    const optionsChanged =
      storedOptions.length !== draftOptions.length ||
      storedOptions.some(
        (option, index) =>
          option.id !== draftOptions[index]?.id || option.text !== draftOptions[index]?.text,
      );

    return (
      this.draftQuestion() !== (slide.question ?? '') ||
      this.draftDescription() !== (slide.description ?? '') ||
      this.draftAnswerType() !== (slide.answerType ?? 'SHORT_ANSWER') ||
      optionsChanged
    );
  });

  protected orderChanged = computed(() => {
    const stored = this.session().slides ?? [];
    const current = this.slides();
    return (
      stored.length !== current.length ||
      current.some((slide, index) => slide.id !== stored[index]?.id)
    );
  });

  protected canSave = computed(
    () =>
      this.editable() &&
      !!this.selected() &&
      (this.hasUnsavedChanges() || this.orderChanged()) &&
      !this.busy(),
  );

  constructor() {
    effect(() => this.slides.set(this.session().slides ?? []));

    // Load the selected slide into the editor whenever the selection or the
    // session changes, so the form always reflects what is stored.
    effect(() => {
      const slide = this.selected();
      if (!slide) return;
      this.loadDraft(slide);
    });
  }

  protected select(slideId: string): void {
    this.selectedId.set(slideId);
    const slide = this.slides().find((item) => item.id === slideId);
    if (slide) this.loadDraft(slide);
  }

  // ── Slide operations ──────────────────────────────────────────────────────

  protected addSlide(type: SlideType): void {
    this.addOpen.set(false);
    const existingIds = new Set(this.slides().map((slide) => slide.id));
    const input: SlideInput =
      type === SLIDE_TYPE.INFORMATION
        ? {
            type,
            title: this.translate.instant('liveSlides.defaults.infoTitle'),
            content: this.translate.instant('liveSlides.defaults.infoContent'),
          }
        : {
            type,
            question: this.translate.instant('liveSlides.defaults.question'),
            answerType: 'LONG_ANSWER',
          };

    this.run(this.api.addSlide(this.session().id, input), (session) => {
      const added = this.findAddedSlide(session, existingIds);
      if (added) this.select(added.id);
    });
  }

  protected saveChanges(): void {
    const slide = this.selected();
    if (!slide) return;

    const slideChanged = this.hasUnsavedChanges();
    const orderChanged = this.orderChanged();
    if (!slideChanged && !orderChanged) return;

    const orderedIds = this.slides().map((item) => item.id);

    if (!slideChanged) {
      this.run(this.api.reorderSlides(this.session().id, orderedIds));
      return;
    }

    const update = this.api.updateSlide(this.session().id, slide.id, this.slideInput(slide));
    const request = orderChanged
      ? update.pipe(switchMap(() => this.api.reorderSlides(this.session().id, orderedIds)))
      : update;
    this.run(request);
  }

  protected duplicateSlide(slide: Slide): void {
    const existingIds = new Set(this.slides().map((item) => item.id));
    this.run(this.api.duplicateSlide(this.session().id, slide.id), (session) => {
      const added = this.findAddedSlide(session, existingIds);
      if (added) this.select(added.id);
    });
  }

  protected deleteSlide(): void {
    const slide = this.confirmDelete();
    if (!slide) return;
    this.confirmDelete.set(null);
    this.run(this.api.deleteSlide(this.session().id, slide.id), () => this.selectedId.set(''));
  }

  /** Move one Slide locally; the global Save action persists the full order. */
  protected move(slide: Slide, offset: number): void {
    const next = [...this.slides()];
    const from = next.findIndex((item) => item.id === slide.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= next.length) return;

    next.splice(to, 0, ...next.splice(from, 1));
    this.slides.set(next);
  }

  // ── Options ───────────────────────────────────────────────────────────────

  protected addOption(): void {
    if (this.draftOptions().length >= OPTION_COUNT.max) return;
    this.draftOptions.update((options) => [...options, { text: '' }]);
  }

  protected setOption(index: number, text: string): void {
    this.draftOptions.update((options) =>
      options.map((option, at) => (at === index ? { ...option, text } : option)),
    );
  }

  protected removeOption(index: number): void {
    this.draftOptions.update((options) => options.filter((_, at) => at !== index));
  }

  protected moveOption(index: number, offset: number): void {
    const to = index + offset;
    this.draftOptions.update((options) => {
      if (to < 0 || to >= options.length) return options;
      const next = [...options];
      next.splice(to, 0, ...next.splice(index, 1));
      return next;
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  protected markReady(): void {
    this.run(this.api.markReady(this.session().id));
  }

  protected backToDraft(): void {
    this.run(this.api.returnToDraft(this.session().id));
  }

  protected startSession(): void {
    this.confirmStart.set(false);
    this.run(this.api.startSession(this.session().id));
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  private run(
    request: ReturnType<LiveSlidesApiService['markReady']>,
    onDone?: (session: LiveSession) => void,
  ): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    this.fieldErrors.set({});

    request
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.changeDetector.markForCheck();
        }),
      )
      .subscribe({
        next: (session) => {
          this.slides.set(session.slides ?? []);
          onDone?.(session);
          this.sessionChanged.emit(session);
        },
        error: (error) => {
          const failure = mapLiveSlidesError(error);
          this.errorKey.set(failure.key);
          this.fieldErrors.set(failure.fields);
        },
      });
  }

  protected fieldError(field: string): string {
    const key = this.fieldErrors()[field];
    return key ? this.translate.instant(key) : '';
  }

  private findAddedSlide(session: LiveSession, existingIds: ReadonlySet<string>): Slide | undefined {
    return (
      session.slides.find((slide) => !existingIds.has(slide.id)) ??
      session.slides[session.slides.length - 1]
    );
  }

  private loadDraft(slide: Slide): void {
    this.draftTitle.set(slide.title ?? '');
    this.draftContent.set(slide.content ?? '');
    this.draftQuestion.set(slide.question ?? '');
    this.draftDescription.set(slide.description ?? '');
    this.draftAnswerType.set(slide.answerType ?? 'SHORT_ANSWER');
    this.draftOptions.set((slide.options ?? []).map((option) => ({ ...option })));
  }

  private slideInput(slide: Slide): SlideInput {
    if (slide.type === SLIDE_TYPE.INFORMATION) {
      return { title: this.draftTitle().trim(), content: this.draftContent().trim() };
    }

    return {
      question: this.draftQuestion().trim(),
      description: this.draftDescription().trim() || undefined,
      answerType: this.draftAnswerType(),
      options: needsOptions(this.draftAnswerType())
        ? this.draftOptions().map((option) => ({ id: option.id, text: option.text.trim() }))
        : undefined,
    };
  }

  /** A short label for the slide list. */
  protected slideLabel(slide: Slide): string {
    return slide.type === SLIDE_TYPE.QUESTION ? (slide.question ?? '') : (slide.title ?? '');
  }
}
