import { AnswerType, SessionStatus, SlideType } from '../models/LiveSlides';

/**
 * Live Slides constants, mirrored from the backend ⟨CP6⟩.
 *
 * `backend/src/cloudCode/modules/LiveSlides/constants.ts` is the source of
 * truth and a backend test asserts the two stay in step. A browser that offers
 * an answer type the server refuses, or refuses a transition the server allows,
 * is worse than one that offers nothing — it teaches people to distrust what
 * they are shown.
 */

export const SESSION_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  LIVE: 'live',
  COMPLETED: 'completed',
} as const;

export const SESSION_STATUSES: readonly SessionStatus[] = ['draft', 'ready', 'live', 'completed'];

/** Which status may follow which. Completed is terminal. */
export const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  draft: ['ready'],
  ready: ['draft', 'live'],
  live: ['completed'],
  completed: [],
};

/**
 * The tone each status gets.
 *
 * Uses the application's own vocabulary — `neutral | success | info | warning |
 * error` — rather than the prototype's colour names, so a session chip is
 * built from the same `.cyf-status-*` classes as a Batch chip and inherits the
 * dark theme and the contrast work already done for them.
 *
 * `live` is `error` for its colour alone: red is what "recording" means
 * everywhere, and nothing is wrong.
 */
export const SESSION_STATUS_TONE: Readonly<
  Record<SessionStatus, 'neutral' | 'success' | 'info' | 'warning' | 'error'>
> = {
  draft: 'neutral',
  ready: 'success',
  live: 'error',
  completed: 'info',
};

export const SLIDE_TYPE = {
  INFORMATION: 'INFORMATION',
  QUESTION: 'QUESTION',
} as const;

export const SLIDE_TYPES: readonly SlideType[] = ['INFORMATION', 'QUESTION'];

export const ANSWER_TYPE = {
  SHORT_ANSWER: 'SHORT_ANSWER',
  LONG_ANSWER: 'LONG_ANSWER',
  POLL: 'POLL',
  SINGLE_CHOICE: 'SINGLE_CHOICE',
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
} as const;

export const ANSWER_TYPES: readonly AnswerType[] = [
  'SHORT_ANSWER',
  'LONG_ANSWER',
  'POLL',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
];

/** The answer types whose Slide carries options. */
export const OPTION_ANSWER_TYPES: readonly AnswerType[] = [
  'POLL',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
];

export const TEXT_ANSWER_TYPES: readonly AnswerType[] = ['SHORT_ANSWER', 'LONG_ANSWER'];

export function needsOptions(answerType: AnswerType | undefined): boolean {
  return !!answerType && OPTION_ANSWER_TYPES.includes(answerType);
}

export function isTextAnswer(answerType: AnswerType | undefined): boolean {
  return !!answerType && TEXT_ANSWER_TYPES.includes(answerType);
}

export function isMultiSelect(answerType: AnswerType | undefined): boolean {
  return answerType === 'MULTIPLE_CHOICE';
}

/** Length bounds, mirrored so a form can state them before the server does. */
export const LIVE_LIMITS = {
  sessionTitle: { min: 2, max: 160 },
  sessionDescription: { max: 1000 },
  slideTitle: { min: 2, max: 200 },
  slideContent: { min: 1, max: 4000 },
  question: { min: 2, max: 500 },
  questionDescription: { max: 1000 },
  optionText: { min: 1, max: 200 },
  shortAnswer: { min: 1, max: 300 },
  longAnswer: { min: 1, max: 4000 },
} as const;

export const OPTION_COUNT = { min: 2, max: 12 } as const;
export const SLIDE_COUNT = { max: 100 } as const;

/**
 * How often a live page asks the server what is happening, in milliseconds.
 *
 * See `docs/TEMPLATE_ARCHITECTURE.md` §20 for why this is a poll rather than a
 * socket: LiveQuery delivers **raw Parse objects**, and this checkpoint forbids
 * exactly that. Two seconds feels immediate to somebody sitting in the room.
 */
export const LIVE_POLL_MS = 2000;

/**
 * How many consecutive failures before a page says it has lost the connection.
 *
 * One failure is a dropped packet, and saying so would make the banner flicker
 * through a normal lecture. Two in a row, four seconds apart, is a real problem
 * worth telling somebody about.
 */
export const LIVE_FAILURES_BEFORE_DISCONNECTED = 2;

/** The icon each slide type gets. Font Awesome, as everywhere else. */
export function slideIcon(type: SlideType): string {
  return type === 'QUESTION' ? 'fa-solid fa-circle-question' : 'fa-solid fa-circle-info';
}

/** The icon each answer type gets in the builder. */
export function answerTypeIcon(answerType: AnswerType): string {
  switch (answerType) {
    case 'SHORT_ANSWER':
      return 'fa-solid fa-i-cursor';
    case 'LONG_ANSWER':
      return 'fa-solid fa-align-left';
    case 'POLL':
      return 'fa-solid fa-chart-simple';
    case 'SINGLE_CHOICE':
      return 'fa-solid fa-circle-dot';
    case 'MULTIPLE_CHOICE':
      return 'fa-solid fa-square-check';
  }
}
