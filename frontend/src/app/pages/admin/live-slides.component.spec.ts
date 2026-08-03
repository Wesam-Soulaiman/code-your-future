import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LiveSession } from '../../models/LiveSlides';
import { useTranslations } from '../../testing/i18n-testing';
import { LiveSlidesComponent } from './live-slides.component';
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

describe('LiveSlidesComponent builder continuity', () => {
  let fixture: ComponentFixture<LiveSlidesComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiveSlidesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    }).compileComponents();
    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LiveSlidesComponent);
    fixture.componentRef.setInput('batchId', 'batch-1');
    fixture.detectChanges();

    const list = http.expectOne((candidate) => candidate.url.includes('listLiveSessions'));
    list.flush({
      items: [SESSION],
      canCreate: true,
      canStart: true,
      readOnly: false,
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  it('keeps the new slide selected without refreshing and remounting the builder', async () => {
    const host = fixture.componentInstance as unknown as { open(sessionId: string): void };
    host.open(SESSION.id);
    http.expectOne((candidate) => candidate.url.includes('getLiveSession')).flush(SESSION);
    fixture.detectChanges();

    const builderDebug = fixture.debugElement.query(By.directive(SlideBuilderComponent));
    const builder = builderDebug.componentInstance as unknown as {
      addSlide(type: 'QUESTION'): void;
    };
    builder.addSlide('QUESTION');

    const addedSession = {
      ...SESSION,
      slideCount: 2,
      questionCount: 1,
      slides: [
        ...SESSION.slides,
        {
          id: 'slide-2',
          type: 'QUESTION' as const,
          question: 'New question',
          answerType: 'LONG_ANSWER' as const,
          displayOrder: 1,
        },
      ],
    } satisfies LiveSession;
    http.expectOne((candidate) => candidate.url.includes('addLiveSlide')).flush(addedSession);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    http.expectNone((candidate) => candidate.url.includes('listLiveSessions'));
    const selectedTitle = fixture.nativeElement.querySelector(
      '.cyf-slide-item.is-selected .cyf-slide-item-title',
    ) as HTMLElement;
    expect(selectedTitle.textContent?.trim()).toBe('New question');
  });
});
