/**
 * Live Slides, as the browser sees them ⟨CP6⟩.
 *
 * These mirror the backend's DTOs exactly. Nothing here has a field the server
 * does not send, and nothing the server sends is missing — a shape that drifts
 * is a shape that renders `undefined` in front of a room of people.
 *
 * ── Two audiences, two shapes ───────────────────────────────────────────────
 * `SlideDto` is what an Admin gets; `StudentSlideDto` is the same slide without
 * the lock instant, the position, or any counter. A Student never receives a
 * type that *could* carry another Student's answer, so there is no way to
 * render one by accident.
 */

export type SessionStatus = 'draft' | 'ready' | 'live' | 'completed';
export type SlideType = 'INFORMATION' | 'QUESTION';
export type AnswerType =
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'POLL'
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE';

export interface SlideOption {
  id: string;
  text: string;
}

export interface Slide {
  id: string;
  type: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: SlideOption[];
  displayOrder: number;
  locked?: boolean;
}

/** The same slide, as a Student receives it. No lock instant, no position. */
export interface StudentSlide {
  id: string;
  type: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: SlideOption[];
  locked?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  description?: string;
  sessionDate?: string;
  status: SessionStatus;
  slideCount: number;
  questionCount: number;
  responseCount?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
}

export interface LiveSession extends SessionSummary {
  batchId: string;
  slides: Slide[];
  currentSlideId?: string;
  currentSlideIndex?: number;
  canStart: boolean;
  editable: boolean;
}

export interface SessionList {
  items: SessionSummary[];
  canCreate: boolean;
  canStart: boolean;
  readOnly: boolean;
}

/** One submitted answer, for the Admin's panel. Never shown to a Student. */
export interface AdminResponse {
  id: string;
  slideId: string;
  studentId: string;
  studentName: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionIds?: string[];
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

/** A Student's own answer. There is no type here that holds anybody else's. */
export interface MyResponse {
  slideId: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionIds?: string[];
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

export interface OptionTally {
  optionId: string;
  text: string;
  count: number;
  percent: number;
}

/** Everything the presenter needs, in one authoritative answer. */
export interface PresenterState {
  sessionId: string;
  batchId: string;
  status: SessionStatus;
  slideCount: number;
  currentIndex: number;
  currentSlide?: Slide;
  responses: AdminResponse[];
  tally: OptionTally[];
  submitted: number;
  unanswered: number;
  /** Admin only. Used by the lock confirmation, never rendered to a Student. */
  unansweredNames: string[];
}

/** Everything a Student's live page needs, in one authoritative answer. */
export interface StudentLiveState {
  session?: {
    id: string;
    title: string;
    description?: string;
    sessionDate?: string;
    status: SessionStatus;
    slideCount: number;
  };
  currentSlide?: StudentSlide;
  currentIndex?: number;
  myResponse?: MyResponse;
  /** Present once the session is completed. */
  questions?: StudentSlide[];
  myResponses?: MyResponse[];
}

export interface SubmitResult {
  alreadySubmitted: boolean;
  myResponse?: MyResponse;
}

export interface StudentResultRow {
  studentId: string;
  studentName: string;
  answered: number;
  questionCount: number;
  responses: AdminResponse[];
}

export interface ResultsByStudent {
  sessionId: string;
  questionCount: number;
  studentCount: number;
  participantCount: number;
  responseCount: number;
  items: StudentResultRow[];
}

export interface QuestionResultRow {
  slide: Slide;
  submitted: number;
  unanswered: number;
  tally: OptionTally[];
  responses: AdminResponse[];
}

export interface ResultsByQuestion {
  sessionId: string;
  studentCount: number;
  items: QuestionResultRow[];
}

/** One row of a Student's permanent answer history. */
export interface AnswerHistoryRow {
  id: string;
  batchName: string;
  sessionId: string;
  sessionTitle: string;
  sessionDate?: string;
  question: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

export interface AnswerHistoryPage {
  items: AnswerHistoryRow[];
  total: number;
}

/** What the builder sends when it writes a Slide. */
export interface SlideInput {
  type?: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: { id?: string; text: string }[];
}

export interface SessionInput {
  title: string;
  description?: string;
  sessionDate: string;
}
