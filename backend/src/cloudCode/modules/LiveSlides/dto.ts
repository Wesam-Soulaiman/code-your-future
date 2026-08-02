/**
 * What a browser receives from Live Slides ⟨CP6⟩.
 *
 * Hand-built allow-lists, every one of them. Nothing is spread from a Parse
 * object, so a column added to a model later cannot appear in a response by
 * accident — it has to be put here on purpose.
 *
 * ── The two audiences see genuinely different things ────────────────────────
 * An Admin's Slide DTO carries `lockedAt` and the response panel carries Student
 * names. A Student's Slide DTO carries neither, and their response DTO carries
 * **their own answer only**. These are separate functions rather than one
 * function with a flag, because a flag is a thing somebody eventually passes
 * wrongly.
 */

import {
  AnswerType,
  SessionStatus,
  SLIDE_TYPE,
  SlideType,
  needsOptions,
} from './constants';

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

export interface SlideOptionDto {
  id: string;
  text: string;
}

/** A Slide as its Admin sees it while building or presenting. */
export interface SlideDto {
  id: string;
  type: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: SlideOptionDto[];
  displayOrder: number;
  /** Whether this Question has closed for good. Absent on Information slides. */
  locked?: boolean;
}

/**
 * A Slide as a Student sees it.
 *
 * Identical in content — a Student is looking at the same slide on the same
 * wall — but `locked` is the only state they get, and there is no place for the
 * `lockedAt` instant or any counter.
 */
export interface StudentSlideDto {
  id: string;
  type: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: SlideOptionDto[];
  locked?: boolean;
}

export interface SessionSummaryDto {
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

export interface SessionDto extends SessionSummaryDto {
  batchId: string;
  slides: SlideDto[];
  currentSlideId?: string;
  currentSlideIndex?: number;
  /** Whether the Batch's status still allows this session to be started. */
  canStart: boolean;
  /** Whether Slides may be edited right now. */
  editable: boolean;
}

/** One submitted answer, for the Admin's live panel and results. */
export interface AdminResponseDto {
  id: string;
  slideId: string;
  studentId: string;
  studentName: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionIds?: string[];
  /** The option labels, resolved from the Slide so the panel needs no join. */
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

/** A Student's own answer. Never anybody else's. */
export interface StudentResponseDto {
  slideId: string;
  answerType: AnswerType;
  textAnswer?: string;
  selectedOptionIds?: string[];
  selectedOptionLabels?: string[];
  submittedAt?: string;
}

/** One option's share of the answers to a choice Question. */
export interface OptionTallyDto {
  optionId: string;
  text: string;
  count: number;
  /** Whole-number percent of submitted answers. Zero when nobody answered. */
  percent: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keys that must never appear
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Asserted by a test against the real DTOs, so this list is a check rather than
 * a comment.
 */
export const FORBIDDEN_LIVE_DTO_KEYS: readonly string[] = [
  'ACL',
  'acl',
  'className',
  '__type',
  'objectId',
  'attributes',
  'sessionToken',
  'masterKey',
  'studentProfile',
  'createdBy',
  'startedBy',
  'liveForBatch',
  'batch',
  'student',
  'email',
  'verifiedEmail',
  'providerSubject',
];

// ═══════════════════════════════════════════════════════════════════════════
// Builders
// ═══════════════════════════════════════════════════════════════════════════

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

/** A calendar date, as `YYYY-MM-DD`. The day that was picked is the day shown. */
function calendarDate(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString().slice(0, 10)
    : undefined;
}

/** The stored options, normalised. Never trusted from a request. */
export function optionsOf(slide: Parse.Object): SlideOptionDto[] {
  const raw = slide.get('options');
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is {id: unknown; text: unknown} => Boolean(entry) && typeof entry === 'object')
    .map(entry => ({id: String(entry.id ?? ''), text: String(entry.text ?? '')}))
    .filter(option => option.id.length > 0);
}

export function toSlideDto(slide: Parse.Object): SlideDto {
  const type = slide.get('type') as SlideType;
  const dto: SlideDto = {
    id: slide.id,
    type,
    displayOrder: Number(slide.get('displayOrder') ?? 0),
  };

  if (type === SLIDE_TYPE.INFORMATION) {
    dto.title = String(slide.get('title') ?? '');
    dto.content = String(slide.get('content') ?? '');
    return dto;
  }

  dto.question = String(slide.get('question') ?? '');
  const description = optionalString(slide.get('description'));
  if (description) dto.description = description;

  const answerType = slide.get('answerType') as AnswerType;
  dto.answerType = answerType;
  if (needsOptions(answerType)) dto.options = optionsOf(slide);
  dto.locked = Boolean(slide.get('lockedAt'));

  return dto;
}

export function toStudentSlideDto(slide: Parse.Object): StudentSlideDto {
  const full = toSlideDto(slide);
  const dto: StudentSlideDto = {id: full.id, type: full.type};

  if (full.title !== undefined) dto.title = full.title;
  if (full.content !== undefined) dto.content = full.content;
  if (full.question !== undefined) dto.question = full.question;
  if (full.description !== undefined) dto.description = full.description;
  if (full.answerType !== undefined) dto.answerType = full.answerType;
  if (full.options !== undefined) dto.options = full.options;
  if (full.locked !== undefined) dto.locked = full.locked;

  return dto;
}

export function toSessionSummaryDto(
  session: Parse.Object,
  counts: {slideCount: number; questionCount: number; responseCount?: number}
): SessionSummaryDto {
  const dto: SessionSummaryDto = {
    id: session.id,
    title: String(session.get('title') ?? ''),
    status: session.get('status') as SessionStatus,
    slideCount: counts.slideCount,
    questionCount: counts.questionCount,
  };

  const description = optionalString(session.get('description'));
  if (description) dto.description = description;

  const sessionDate = calendarDate(session.get('sessionDate'));
  if (sessionDate) dto.sessionDate = sessionDate;

  if (counts.responseCount !== undefined) dto.responseCount = counts.responseCount;

  const startedAt = isoOrUndefined(session.get('startedAt'));
  if (startedAt) dto.startedAt = startedAt;

  const completedAt = isoOrUndefined(session.get('completedAt'));
  if (completedAt) dto.completedAt = completedAt;

  const createdAt = isoOrUndefined(session.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  return dto;
}

export function toSessionDto(
  session: Parse.Object,
  slides: Parse.Object[],
  extra: {batchId: string; canStart: boolean; editable: boolean; responseCount?: number}
): SessionDto {
  const slideDtos = slides.map(toSlideDto);
  const summary = toSessionSummaryDto(session, {
    slideCount: slideDtos.length,
    questionCount: slideDtos.filter(slide => slide.type === SLIDE_TYPE.QUESTION).length,
    responseCount: extra.responseCount,
  });

  const dto: SessionDto = {
    ...summary,
    batchId: extra.batchId,
    slides: slideDtos,
    canStart: extra.canStart,
    editable: extra.editable,
  };

  const currentSlide = session.get('currentSlide');
  if (currentSlide && typeof currentSlide.id === 'string') dto.currentSlideId = currentSlide.id;

  const index = session.get('currentSlideIndex');
  if (typeof index === 'number') dto.currentSlideIndex = index;

  return dto;
}

/** The labels behind a set of option ids, in the Slide's own order. */
export function labelsFor(slide: Parse.Object | undefined, ids: readonly string[]): string[] {
  if (!slide) return [];
  const options = optionsOf(slide);
  return options.filter(option => ids.includes(option.id)).map(option => option.text);
}

/** The ids this response selected, whichever column they were stored in. */
export function selectedIdsOf(response: Parse.Object): string[] {
  const single = response.get('selectedOptionId');
  if (typeof single === 'string' && single.length > 0) return [single];

  const many = response.get('selectedOptionIds');
  return Array.isArray(many) ? many.filter((id): id is string => typeof id === 'string') : [];
}

export function toAdminResponseDto(
  response: Parse.Object,
  slide: Parse.Object | undefined,
  studentName: string
): AdminResponseDto {
  const ids = selectedIdsOf(response);
  const dto: AdminResponseDto = {
    id: response.id,
    slideId: String((response.get('slide') as Parse.Object | undefined)?.id ?? ''),
    studentId: String((response.get('student') as Parse.User | undefined)?.id ?? ''),
    studentName,
    answerType: response.get('answerType') as AnswerType,
  };

  const text = optionalString(response.get('textAnswer'));
  if (text) dto.textAnswer = text;

  if (ids.length > 0) {
    dto.selectedOptionIds = ids;
    dto.selectedOptionLabels = labelsFor(slide, ids);
  }

  const submittedAt = isoOrUndefined(response.get('submittedAt'));
  if (submittedAt) dto.submittedAt = submittedAt;

  return dto;
}

export function toStudentResponseDto(
  response: Parse.Object,
  slide: Parse.Object | undefined
): StudentResponseDto {
  const ids = selectedIdsOf(response);
  const dto: StudentResponseDto = {
    slideId: String((response.get('slide') as Parse.Object | undefined)?.id ?? ''),
    answerType: response.get('answerType') as AnswerType,
  };

  const text = optionalString(response.get('textAnswer'));
  if (text) dto.textAnswer = text;

  if (ids.length > 0) {
    dto.selectedOptionIds = ids;
    dto.selectedOptionLabels = labelsFor(slide, ids);
  }

  const submittedAt = isoOrUndefined(response.get('submittedAt'));
  if (submittedAt) dto.submittedAt = submittedAt;

  return dto;
}

/**
 * How the answers to one choice Question fell out.
 *
 * The percentage is of **submitted answers**, not of enrolled Students: a poll
 * where three of thirty answered and two picked the first option shows 67%, not
 * 7%. Saying otherwise would make every early result look like a failure.
 *
 * For MULTIPLE_CHOICE the counts sum to more than the number of answers, which
 * is correct — the reader is told how many people answered separately.
 */
export function tallyOptions(
  slide: Parse.Object,
  responses: readonly Parse.Object[]
): OptionTallyDto[] {
  const options = optionsOf(slide);
  const counts = new Map<string, number>(options.map(option => [option.id, 0]));

  for (const response of responses) {
    for (const id of selectedIdsOf(response)) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const answered = responses.length;
  return options.map(option => {
    const count = counts.get(option.id) ?? 0;
    return {
      optionId: option.id,
      text: option.text,
      count,
      percent: answered > 0 ? Math.round((count / answered) * 100) : 0,
    };
  });
}
