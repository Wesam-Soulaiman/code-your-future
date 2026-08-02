/**
 * What a Live Slides session may be ⟨CP6⟩.
 *
 * `frontend/src/app/utils/live-slides-constants.ts` mirrors this file, and a
 * test asserts the two stay in step — the same contract the Batch and profile
 * constants have, for the same reason: a browser that offers a slide type or an
 * answer type the server refuses is worse than one that offers nothing.
 *
 * Every list here is **closed**. There is no "other", no free-form type, and no
 * place to put a value somebody invents later.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Session lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/** The four statuses, stored lower-case. The browser translates them. */
export const SESSION_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  LIVE: 'live',
  COMPLETED: 'completed',
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const SESSION_STATUSES: readonly SessionStatus[] = [
  SESSION_STATUS.DRAFT,
  SESSION_STATUS.READY,
  SESSION_STATUS.LIVE,
  SESSION_STATUS.COMPLETED,
];

/**
 * Which status may follow which.
 *
 * `ready → draft` is the only backward move, and it exists because a session is
 * prepared before a lecture and somebody always notices a typo afterwards.
 * `completed` is terminal, so its entry is deliberately empty rather than
 * absent: an empty list states the rule, a missing key reads as an oversight.
 *
 * There is no `live → ready` and no `live → draft`. Once Students have answered
 * a question, reopening the session for editing would change the question they
 * answered, and an answer to a question that no longer exists is not a record of
 * anything.
 */
export const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  [SESSION_STATUS.DRAFT]: [SESSION_STATUS.READY],
  [SESSION_STATUS.READY]: [SESSION_STATUS.DRAFT, SESSION_STATUS.LIVE],
  [SESSION_STATUS.LIVE]: [SESSION_STATUS.COMPLETED],
  [SESSION_STATUS.COMPLETED]: [],
};

/** The one status in which Slides may be created, edited, or reordered. */
export const EDITABLE_STATUS: SessionStatus = SESSION_STATUS.DRAFT;

/** Statuses whose Slide definitions are frozen for good. */
export const FROZEN_STATUSES: readonly SessionStatus[] = [
  SESSION_STATUS.LIVE,
  SESSION_STATUS.COMPLETED,
];

/** True when this session's Slides may still be changed. */
export function isEditableStatus(value: unknown): boolean {
  return value === EDITABLE_STATUS;
}

/** True when this session's Slide definitions are permanently frozen. */
export function isFrozenStatus(value: unknown): boolean {
  return FROZEN_STATUSES.includes(value as SessionStatus);
}

// ═══════════════════════════════════════════════════════════════════════════
// Slides
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exactly two slide types.
 *
 * The prototype sketched four — Welcome, Information, Question, Closing — but
 * Welcome and Closing are Information slides with different words on them. A
 * type that changes nothing about behaviour is a type that will eventually grow
 * behaviour by accident.
 */
export const SLIDE_TYPE = {
  INFORMATION: 'INFORMATION',
  QUESTION: 'QUESTION',
} as const;

export type SlideType = (typeof SLIDE_TYPE)[keyof typeof SLIDE_TYPE];

export const SLIDE_TYPES: readonly SlideType[] = [SLIDE_TYPE.INFORMATION, SLIDE_TYPE.QUESTION];

/** Exactly five answer types. */
export const ANSWER_TYPE = {
  SHORT_ANSWER: 'SHORT_ANSWER',
  LONG_ANSWER: 'LONG_ANSWER',
  POLL: 'POLL',
  SINGLE_CHOICE: 'SINGLE_CHOICE',
  MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
} as const;

export type AnswerType = (typeof ANSWER_TYPE)[keyof typeof ANSWER_TYPE];

export const ANSWER_TYPES: readonly AnswerType[] = [
  ANSWER_TYPE.SHORT_ANSWER,
  ANSWER_TYPE.LONG_ANSWER,
  ANSWER_TYPE.POLL,
  ANSWER_TYPE.SINGLE_CHOICE,
  ANSWER_TYPE.MULTIPLE_CHOICE,
];

/** The answer types whose Slide carries a list of options. */
export const OPTION_ANSWER_TYPES: readonly AnswerType[] = [
  ANSWER_TYPE.POLL,
  ANSWER_TYPE.SINGLE_CHOICE,
  ANSWER_TYPE.MULTIPLE_CHOICE,
];

/** The answer types whose response is free text. */
export const TEXT_ANSWER_TYPES: readonly AnswerType[] = [
  ANSWER_TYPE.SHORT_ANSWER,
  ANSWER_TYPE.LONG_ANSWER,
];

/** The one answer type that accepts more than one selection. */
export const MULTI_SELECT_TYPES: readonly AnswerType[] = [ANSWER_TYPE.MULTIPLE_CHOICE];

export function isAnswerType(value: unknown): value is AnswerType {
  return typeof value === 'string' && ANSWER_TYPES.includes(value as AnswerType);
}

export function isSlideType(value: unknown): value is SlideType {
  return typeof value === 'string' && SLIDE_TYPES.includes(value as SlideType);
}

export function needsOptions(answerType: unknown): boolean {
  return OPTION_ANSWER_TYPES.includes(answerType as AnswerType);
}

export function isTextAnswer(answerType: unknown): boolean {
  return TEXT_ANSWER_TYPES.includes(answerType as AnswerType);
}

export function isMultiSelect(answerType: unknown): boolean {
  return MULTI_SELECT_TYPES.includes(answerType as AnswerType);
}

// ═══════════════════════════════════════════════════════════════════════════
// Bounds
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Length bounds. Generous for real teaching material, tight enough that a
 * single session cannot become unbounded storage.
 */
export const LIVE_LIMITS = {
  sessionTitle: {min: 2, max: 160},
  sessionDescription: {max: 1000},
  slideTitle: {min: 2, max: 200},
  slideContent: {min: 1, max: 4000},
  question: {min: 2, max: 500},
  questionDescription: {max: 1000},
  optionText: {min: 1, max: 200},
  shortAnswer: {min: 1, max: 300},
  longAnswer: {min: 1, max: 4000},
} as const;

/** How many options one Question may carry. Two is the minimum that is a choice. */
export const OPTION_COUNT = {min: 2, max: 12} as const;

/** How many Slides one session may hold. A lecture, not a library. */
export const SLIDE_COUNT = {max: 100} as const;

/** Option ids: `opt_` + 8 random bytes, generated on the server, never sent in. */
export const OPTION_ID_PREFIX = 'opt_';
export const OPTION_ID_BYTES = 8;

/** How many sessions one list request returns. */
export const SESSION_PAGE = {defaultLimit: 20, maxLimit: 100} as const;

/** How many answer-history rows one Student Detail request returns. */
export const HISTORY_PAGE = {defaultLimit: 20, maxLimit: 100} as const;

/**
 * How often a live client asks the server what is happening, in milliseconds.
 *
 * See `docs/TEMPLATE_ARCHITECTURE.md` §20 for why this is a poll rather than a
 * socket: LiveQuery delivers **raw Parse objects**, and §11 of this checkpoint
 * forbids exactly that. Two seconds is fast enough that a slide change feels
 * immediate to somebody sitting in the room, and slow enough that a lecture of
 * thirty Students is thirty requests a minute each — well inside what the
 * existing rate limits and this deployment carry.
 */
export const LIVE_POLL_MS = 2000;
