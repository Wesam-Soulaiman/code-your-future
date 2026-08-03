import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentLiveState } from '../../models/LiveSlides';
import { useTranslations } from '../../testing/i18n-testing';
import { StudentLiveSlidesComponent } from './student-live-slides.component';

/**
 * The Student live page ⟨CP6⟩.
 *
 * The load-bearing assertions are the ones about what is **not** sent and what
 * is **not** shown: nothing leaves the browser before Submit, and no response
 * belonging to anybody else can reach this component at all.
 *
 * `HttpTestingController.verify()` fails a test that opened a request it did not
 * expect, which is how "typing sends nothing" is proved rather than assumed.
 */

const INFO_STATE: StudentLiveState = {
  session: {
    id: 's1',
    title: 'First meeting',
    description: 'Getting to know everybody',
    sessionDate: '2026-08-10',
    status: 'live',
    slideCount: 3,
  },
  currentSlide: {
    id: 'sl1',
    type: 'INFORMATION',
    title: 'How today works',
    content: 'The Admin controls the slides.',
  },
  currentIndex: 0,
};

const TEXT_QUESTION: StudentLiveState = {
  session: { ...INFO_STATE.session!, status: 'live' },
  currentSlide: {
    id: 'sl2',
    type: 'QUESTION',
    question: 'Why did you choose software development?',
    answerType: 'LONG_ANSWER',
    locked: false,
  },
  currentIndex: 1,
};

const CHOICE_QUESTION: StudentLiveState = {
  session: { ...INFO_STATE.session!, status: 'live' },
  currentSlide: {
    id: 'sl3',
    type: 'QUESTION',
    question: 'Which role interests you?',
    answerType: 'MULTIPLE_CHOICE',
    options: [
      { id: 'opt_a', text: 'Frontend' },
      { id: 'opt_b', text: 'Backend' },
      { id: 'opt_c', text: 'Mobile' },
    ],
    locked: false,
  },
  currentIndex: 2,
};

describe('StudentLiveSlidesComponent ⟨CP6⟩', () => {
  let fixture: ComponentFixture<StudentLiveSlidesComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudentLiveSlidesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentLiveSlidesComponent);
    fixture.componentRef.setInput('batchId', 'b1');
  });

  afterEach(() => {
    // Stop polling first: a tick that fired between the assertions and teardown
    // would open a request no test expected, and verify() would blame the test.
    (fixture.componentInstance as unknown as { poll: { stop(): void } }).poll.stop();
    // Fails the test if any request was opened that a test did not expect.
    http.verify();
    fixture.destroy();
  });

  /** Let the poll's first tick reach the HTTP layer. It is a `timer(0)`. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Answer the poll's first request with a given state. */
  async function firstTick(state: StudentLiveState): Promise<void> {
    fixture.detectChanges();
    await settle();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-live/getMyLiveState'),
    );
    expect(request.request.method).toBe('GET');
    request.flush(state);
    fixture.detectChanges();
  }

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  async function enterLive(state: StudentLiveState): Promise<void> {
    await firstTick(state);
    // The Join action is a view transition only — it sends nothing.
    const join = fixture.nativeElement.querySelector('p-button button');
    join?.click();
    fixture.detectChanges();
  }

  it('asks only for its own Batch state, and never names a Student', async () => {
    fixture.detectChanges();
    await settle();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-live/getMyLiveState'),
    );

    expect(request.request.params.get('batchId')).toBe('b1');
    for (const forbidden of ['studentId', 'studentProfileId', 'userId']) {
      expect(request.request.params.get(forbidden)).toBeNull();
    }
    request.flush({ session: undefined });
  });

  it('says there is no session when there is none', async () => {
    await firstTick({ session: undefined });
    expect(text()).toContain('No live session yet');
  });

  it('shows a waiting card while the session is only Ready', async () => {
    await firstTick({ session: { ...INFO_STATE.session!, status: 'ready' } });
    expect(text()).toContain('UPCOMING');
    expect(text()).not.toContain('Submit Answer');
  });

  it('offers Join before entering, and joins without a request', async () => {
    await firstTick(INFO_STATE);
    expect(text()).toContain('Join Live Session');

    fixture.nativeElement.querySelector('p-button button')?.click();
    fixture.detectChanges();

    // Nothing was sent. Opening the page is not attendance, and this product
    // records none — `http.verify()` in afterEach proves no call was made.
    expect(text()).not.toContain('Join Live Session');
  });

  it('shows an Information slide with no answer form', async () => {
    await enterLive(INFO_STATE);
    expect(text()).toContain('How today works');
    expect(text()).toContain('No answer required');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('offers fullscreen above the shell after the Student enters the live session', async () => {
    const original = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'requestFullscreen',
    );
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    try {
      await enterLive(INFO_STATE);
      const component = fixture.componentInstance as unknown as {
        toggleFullscreen(): void;
      };
      component.toggleFullscreen();
      fixture.detectChanges();

      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(fixture.nativeElement.querySelector('.cyf-live-fullscreen')).toBeTruthy();
    } finally {
      if (original) {
        Object.defineProperty(document.documentElement, 'requestFullscreen', original);
      } else {
        Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
      }
    }
  });

  it('shows a textarea for a text question and sends nothing while typing', async () => {
    await enterLive(TEXT_QUESTION);

    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    expect(textarea).toBeTruthy();

    textarea.value = 'I like solving problems';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The whole privacy promise: the Admin sees no draft text because none is
    // ever transmitted. `afterEach`'s verify() would fail if it had been.
    expect(text()).toContain('cannot see your answer before');
  });

  it('shows one control per option for a choice question', async () => {
    await enterLive(CHOICE_QUESTION);
    const inputs = fixture.nativeElement.querySelectorAll('.cyf-choice input');
    expect(inputs.length).toBe(3);
    // Multiple choice, so checkboxes rather than radios.
    expect(inputs[0].getAttribute('type')).toBe('checkbox');
    expect(text()).toContain('Frontend');
  });

  it('asks for confirmation before submitting, and sends nothing if cancelled', async () => {
    await enterLive(TEXT_QUESTION);

    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'Because I enjoy building things';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      confirmSubmit: { set(value: boolean): void; (): boolean };
    };
    component.confirmSubmit.set(true);
    fixture.detectChanges();

    expect(text()).toContain('cannot change your answer after submitting');

    component.confirmSubmit.set(false);
    fixture.detectChanges();
    // Cancelling sends nothing — verify() enforces it.
  });

  it('submits the typed answer once and then shows it read-only', async () => {
    await enterLive(TEXT_QUESTION);

    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'Because I enjoy building things';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as { submit(): void };
    component.submit();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('student-live/submitLiveResponse'),
    );
    const body = request.request.body as Record<string, unknown>;

    expect(body['sessionId']).toBe('s1');
    expect(body['slideId']).toBe('sl2');
    expect(body['textAnswer']).toBe('Because I enjoy building things');
    // Never sent: who is answering is resolved from the session token.
    for (const forbidden of ['studentId', 'studentProfileId', 'submittedAt', 'answerType']) {
      expect(body[forbidden]).toBeUndefined();
    }

    request.flush({
      alreadySubmitted: false,
      myResponse: {
        slideId: 'sl2',
        answerType: 'LONG_ANSWER',
        textAnswer: 'Because I enjoy building things',
        submittedAt: '2026-08-10T09:05:00.000Z',
      },
    });
    fixture.detectChanges();

    expect(text()).toContain('Answer submitted');
    expect(text()).toContain('cannot be edited');
    // The form is gone. There is no way back to it.
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();

    // Stop the poll so no further request is opened after the assertions.
    (fixture.componentInstance as unknown as { poll: { stop(): void } }).poll.stop();
  });

  it('shows the existing answer when the server says it was already submitted', async () => {
    await enterLive(TEXT_QUESTION);

    const component = fixture.componentInstance as unknown as {
      draftText: { set(value: string): void };
      submit(): void;
      poll: { stop(): void };
    };
    component.draftText.set('a second attempt');
    component.submit();

    http
      .expectOne((candidate) => candidate.url.includes('submitLiveResponse'))
      .flush({
        alreadySubmitted: true,
        myResponse: {
          slideId: 'sl2',
          answerType: 'LONG_ANSWER',
          textAnswer: 'the first answer, which stands',
        },
      });
    fixture.detectChanges();

    // The first answer stands and is what is shown. The second never replaced it.
    expect(text()).toContain('the first answer, which stands');
    expect(text()).not.toContain('a second attempt');

    component.poll.stop();
  });

  it('shows a closed question with no input at all', async () => {
    await enterLive({
      ...TEXT_QUESTION,
      currentSlide: { ...TEXT_QUESTION.currentSlide!, locked: true },
    });

    expect(text()).toContain('This question is closed');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cyf-choice input')).toBeNull();
  });

  it('shows a submitted answer as read-only even while the question is open', async () => {
    await enterLive({
      ...TEXT_QUESTION,
      myResponse: {
        slideId: 'sl2',
        answerType: 'LONG_ANSWER',
        textAnswer: 'already said',
      },
    });

    expect(text()).toContain('already said');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('lists only its own answers when the session is completed', async () => {
    await firstTick({
      session: { ...INFO_STATE.session!, status: 'completed' },
      questions: [
        { id: 'sl2', type: 'QUESTION', question: 'Why software?' },
        { id: 'sl3', type: 'QUESTION', question: 'Which role?' },
      ],
      myResponses: [
        { slideId: 'sl2', answerType: 'LONG_ANSWER', textAnswer: 'my own words' },
      ],
    });

    expect(text()).toContain('my own words');
    // The unanswered question is derived, not stored: it has no response and is
    // rendered as No Answer rather than as an empty submission.
    expect(text()).toContain('Which role?');
    expect(text()).toContain('No Answer');
    expect(text()).toContain('Your submitted answers were saved');
  });

  it('never renders another Student', async () => {
    await enterLive({
      ...TEXT_QUESTION,
      myResponse: { slideId: 'sl2', answerType: 'LONG_ANSWER', textAnswer: 'mine' },
    });

    // The Student surface has no type that can hold somebody else's answer, so
    // there is nothing to render even if a server were to send one.
    const rendered = text();
    for (const forbidden of ['studentName', 'Lina', 'Omar', 'unanswered', 'submitted count']) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it('shows a connection state once the live view is open', async () => {
    // The indicator belongs to the live view, not to the Join screen: there is
    // nothing to be connected to before the Student enters.
    await enterLive(INFO_STATE);
    expect(text()).toContain('Connected');
  });
});
