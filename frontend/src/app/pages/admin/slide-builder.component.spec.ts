import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LiveSession } from '../../models/LiveSlides';
import { useTranslations } from '../../testing/i18n-testing';
import { SlideBuilderComponent } from './slide-builder.component';

const SESSION: LiveSession = {
  id: 'session-1',
  batchId: 'batch-1',
  title: 'Demo deck',
  sessionDate: '2026-08-03',
  status: 'draft',
  slideCount: 1,
  questionCount: 0,
  canStart: true,
  editable: true,
  slides: [
    {
      id: 'slide-1',
      type: 'INFORMATION',
      title: 'Welcome',
      content: 'First slide',
      displayOrder: 0,
    },
  ],
};

describe('SlideBuilderComponent', () => {
  let fixture: ComponentFixture<SlideBuilderComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SlideBuilderComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SlideBuilderComponent);
    fixture.componentRef.setInput('session', SESSION);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('renders one global Save action outside the selected slide actions', () => {
    const footer = fixture.nativeElement.querySelector('.cyf-builder-footer') as HTMLElement;
    const slideActions = fixture.nativeElement.querySelector(
      '.cyf-editor-slide-actions',
    ) as HTMLElement;

    expect(footer.textContent).toContain('Save');
    expect(slideActions.textContent).not.toContain('Save');
  });

  it('selects and opens the slide returned by Add Slide', async () => {
    const component = fixture.componentInstance as unknown as {
      addSlide(type: 'QUESTION'): void;
    };

    component.addSlide('QUESTION');
    const request = http.expectOne((candidate) => candidate.url.includes('addLiveSlide'));
    request.flush({
      ...SESSION,
      slideCount: 2,
      questionCount: 1,
      slides: [
        ...SESSION.slides,
        {
          id: 'slide-2',
          type: 'QUESTION',
          question: 'New question',
          answerType: 'LONG_ANSWER',
          displayOrder: 1,
        },
      ],
    } satisfies LiveSession);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const selectedTitle = fixture.nativeElement.querySelector(
      '.cyf-slide-item.is-selected .cyf-slide-item-title',
    ) as HTMLElement;
    const question = fixture.nativeElement.querySelector('#slideQuestion') as HTMLTextAreaElement;

    expect(selectedTitle.textContent?.trim()).toBe('New question');
    expect(question.value).toBe('New question');
  });

  it('keeps arrow reordering local until the global Save action', () => {
    const secondSlide = {
      id: 'slide-2',
      type: 'QUESTION' as const,
      question: 'Second slide',
      answerType: 'LONG_ANSWER' as const,
      displayOrder: 1,
    };
    const session = {
      ...SESSION,
      slideCount: 2,
      questionCount: 1,
      slides: [...SESSION.slides, secondSlide],
    } satisfies LiveSession;
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as {
      move(slide: LiveSession['slides'][number], offset: number): void;
      saveChanges(): void;
    };

    component.move(secondSlide, -1);
    fixture.detectChanges();
    http.expectNone((candidate) => candidate.url.includes('reorderLiveSlides'));

    const titles = [...fixture.nativeElement.querySelectorAll('.cyf-slide-item-title')].map(
      (element) => element.textContent?.trim(),
    );
    expect(titles).toEqual(['Second slide', 'Welcome']);

    component.saveChanges();
    const request = http.expectOne((candidate) => candidate.url.includes('reorderLiveSlides'));
    expect(request.request.body['orderedIds']).toEqual(['slide-2', 'slide-1']);
    request.flush({ ...session, slides: [secondSlide, SESSION.slides[0]] });
  });
});
