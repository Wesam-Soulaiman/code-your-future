/**
 * Validating everything a caller sends to Live Slides ⟨CP6⟩.
 *
 * Every rejection is a **field name plus a stable reason code** — never the
 * value that failed. A rejected question is somebody's teaching material and a
 * rejected answer is somebody's words about themselves; echoing either back is
 * how it ends up rendered onto a page and written into a log.
 *
 * ── Nothing here trusts a label ─────────────────────────────────────────────
 * Option ids are generated on the server and resolved against the **stored**
 * Slide. A request may name an option id; it may never name an option's text,
 * and it may never name the answer type. Both come from the database, because
 * both decide what the answer means.
 */

import {randomBytes} from 'crypto';

import {
  ANSWER_TYPE,
  AnswerType,
  LIVE_LIMITS,
  OPTION_COUNT,
  OPTION_ID_BYTES,
  OPTION_ID_PREFIX,
  SLIDE_COUNT,
  SLIDE_TYPE,
  SlideType,
  isAnswerType,
  isMultiSelect,
  isSlideType,
  isTextAnswer,
  needsOptions,
} from './constants';
import {FieldErrors, FieldReason} from './errors';
import {FieldReasonCode} from '../StudentProfile/errors';

/** Collapse internal whitespace and trim, so " A  B " and "A B" are one title. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Trim only — internal spacing in a body or an answer is the author's. */
function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Bound one piece of text and report why it failed, never what it said.
 *
 * Returns `undefined` when the value is acceptable.
 */
function boundedReason(
  value: string,
  bounds: {min?: number; max: number},
  required: boolean
): FieldReasonCode | undefined {
  if (value.length === 0) return required ? FieldReason.REQUIRED : undefined;
  if (bounds.min !== undefined && value.length < bounds.min) return FieldReason.TOO_SHORT;
  if (value.length > bounds.max) return FieldReason.TOO_LONG;
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session metadata
// ═══════════════════════════════════════════════════════════════════════════

export interface SessionMetadata {
  title: string;
  description?: string;
  sessionDate: Date;
}

export interface SessionMetadataValidation {
  values: SessionMetadata;
  errors: FieldErrors;
}

/**
 * A calendar date, read as the day that was picked.
 *
 * Stored at UTC midnight so the day never shifts: the Batch dates already work
 * this way, and a lecture on the 10th must not become the 9th for a reader in a
 * different timezone. Nothing about this date starts, schedules, or ends
 * anything — it is a label on a session.
 */
export function parseCalendarDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return undefined;

  // Reject a well-shaped date that is not a real one — 2026-02-31 parses, and
  // then silently becomes March.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return undefined;
  }
  return date;
}

export function validateSessionMetadata(input: Record<string, unknown>): SessionMetadataValidation {
  const errors: FieldErrors = {};

  const title = normaliseText(input['title']);
  const titleReason = boundedReason(title, LIVE_LIMITS.sessionTitle, true);
  if (titleReason) errors['title'] = titleReason;

  const description = trimText(input['description']);
  const descriptionReason = boundedReason(description, LIVE_LIMITS.sessionDescription, false);
  if (descriptionReason) errors['description'] = descriptionReason;

  const sessionDate = parseCalendarDate(input['sessionDate']);
  if (!sessionDate) errors['sessionDate'] = FieldReason.REQUIRED;

  const values: SessionMetadata = {
    title,
    sessionDate: sessionDate ?? new Date(0),
  };
  if (description) values.description = description;

  return {values, errors};
}

// ═══════════════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════════════

export interface SlideOption {
  id: string;
  text: string;
}

/** An option id nobody can guess and nothing can collide with. */
export function newOptionId(): string {
  return `${OPTION_ID_PREFIX}${randomBytes(OPTION_ID_BYTES).toString('hex')}`;
}

/** Two labels are "the same" when a reader could not tell them apart. */
function normaliseLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface OptionValidation {
  options: SlideOption[];
  errors: FieldErrors;
}

/**
 * Validate the options a caller sent, keeping ids stable where they exist.
 *
 * An option a caller sends **with** an id that already belongs to this Slide
 * keeps that id; anything else gets a fresh server-generated one. That is what
 * lets an Admin rename an option in Draft without orphaning nothing — while
 * making it impossible to invent an id from the browser.
 */
export function validateOptions(
  raw: unknown,
  existing: readonly SlideOption[] = []
): OptionValidation {
  const errors: FieldErrors = {};

  if (!Array.isArray(raw)) {
    errors['options'] = FieldReason.REQUIRED;
    return {options: [], errors};
  }

  if (raw.length < OPTION_COUNT.min) {
    errors['options'] = FieldReason.TOO_SHORT;
    return {options: [], errors};
  }
  if (raw.length > OPTION_COUNT.max) {
    errors['options'] = FieldReason.TOO_LONG;
    return {options: [], errors};
  }

  const knownIds = new Set(existing.map(option => option.id));
  const options: SlideOption[] = [];
  const seenLabels = new Set<string>();

  for (const entry of raw) {
    const source = (entry ?? {}) as {id?: unknown; text?: unknown};
    const text = normaliseText(typeof source === 'string' ? source : source.text);

    const reason = boundedReason(text, LIVE_LIMITS.optionText, true);
    if (reason) {
      errors['options'] = reason;
      return {options: [], errors};
    }

    const label = normaliseLabel(text);
    if (seenLabels.has(label)) {
      // Two options a reader cannot tell apart make a result nobody can read.
      errors['options'] = FieldReason.NOT_ALLOWED;
      return {options: [], errors};
    }
    seenLabels.add(label);

    // An id survives only if this Slide already owns it. Anything else — an
    // invented id, another Slide's id — is replaced rather than refused, so a
    // caller cannot use the error to probe which ids exist.
    const sent = typeof source.id === 'string' ? source.id : '';
    options.push({id: knownIds.has(sent) ? sent : newOptionId(), text});
  }

  return {options, errors};
}

// ═══════════════════════════════════════════════════════════════════════════
// Slides
// ═══════════════════════════════════════════════════════════════════════════

export interface SlideValues {
  type: SlideType;
  title?: string;
  content?: string;
  question?: string;
  description?: string;
  answerType?: AnswerType;
  options?: SlideOption[];
}

export interface SlideValidation {
  values: SlideValues;
  errors: FieldErrors;
}

/**
 * Validate one Slide's fields for its own type.
 *
 * `type` is read from `existingType` when the Slide already exists — a Slide
 * never changes type, so a request that names one is describing the Slide it
 * thinks it is editing rather than asking for a change.
 */
export function validateSlide(
  input: Record<string, unknown>,
  context: {existingType?: SlideType; existingOptions?: readonly SlideOption[]} = {}
): SlideValidation {
  const errors: FieldErrors = {};

  const requestedType = input['type'];
  const type = context.existingType ?? (isSlideType(requestedType) ? requestedType : undefined);
  if (!type) {
    errors['type'] = FieldReason.NOT_ALLOWED;
    return {values: {type: SLIDE_TYPE.INFORMATION}, errors};
  }

  if (type === SLIDE_TYPE.INFORMATION) {
    const title = normaliseText(input['title']);
    const titleReason = boundedReason(title, LIVE_LIMITS.slideTitle, true);
    if (titleReason) errors['title'] = titleReason;

    const content = trimText(input['content']);
    const contentReason = boundedReason(content, LIVE_LIMITS.slideContent, true);
    if (contentReason) errors['content'] = contentReason;

    // An Information slide that arrives carrying a question or options is a
    // caller confused about what it is building. Refused rather than ignored.
    for (const foreign of ['question', 'answerType', 'options']) {
      if (input[foreign] !== undefined) errors[foreign] = FieldReason.NOT_ALLOWED;
    }

    return {values: {type, title, content}, errors};
  }

  const question = normaliseText(input['question']);
  const questionReason = boundedReason(question, LIVE_LIMITS.question, true);
  if (questionReason) errors['question'] = questionReason;

  const description = trimText(input['description']);
  const descriptionReason = boundedReason(description, LIVE_LIMITS.questionDescription, false);
  if (descriptionReason) errors['description'] = descriptionReason;

  const answerType = input['answerType'];
  if (!isAnswerType(answerType)) {
    errors['answerType'] = FieldReason.NOT_ALLOWED;
    return {values: {type, question, description: description || undefined}, errors};
  }

  for (const foreign of ['title', 'content']) {
    if (input[foreign] !== undefined) errors[foreign] = FieldReason.NOT_ALLOWED;
  }

  const values: SlideValues = {type, question, answerType};
  if (description) values.description = description;

  if (needsOptions(answerType)) {
    const result = validateOptions(input['options'], context.existingOptions ?? []);
    Object.assign(errors, result.errors);
    if (Object.keys(result.errors).length === 0) values.options = result.options;
  } else if (input['options'] !== undefined) {
    // A text answer with options is a caller who changed the answer type and
    // left the options behind.
    errors['options'] = FieldReason.NOT_ALLOWED;
  }

  return {values, errors};
}

/** Fields a caller must never set on a session, a Slide, or a response. */
export function findPrivilegedLiveFields(input: Record<string, unknown>): string[] {
  const forbidden = [
    'studentId',
    'studentProfileId',
    'studentProfile',
    'student',
    'createdBy',
    'startedBy',
    'startedAt',
    'completedAt',
    'submittedAt',
    'lockedAt',
    'liveForBatch',
    'currentSlide',
    'currentSlideIndex',
    'status',
    'objectId',
    'ACL',
    'acl',
    'className',
    'createdAt',
    'updatedAt',
    // Nothing about authorisation is ever set by writing here.
    'roles',
    'role',
    'sessionToken',
    'password',
  ];
  return forbidden.filter(key => Object.prototype.hasOwnProperty.call(input, key));
}

/** The ordered id list for a Slide reorder. */
export function parseOrderedIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0 || raw.length > SLIDE_COUNT.max) return undefined;

  const ids = raw
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id.length <= 64);

  return ids.length > 0 ? ids : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Answers
// ═══════════════════════════════════════════════════════════════════════════

export interface AnswerValues {
  textAnswer?: string;
  selectedOptionId?: string;
  selectedOptionIds?: string[];
}

export type AnswerCheck =
  | {ok: true; values: AnswerValues}
  | {ok: false; code: 'ANSWER_TYPE_MISMATCH' | 'ANSWER_OPTION_INVALID'; fields?: FieldErrors};

/**
 * Check one answer against the **stored** Slide.
 *
 * The answer type comes from the Slide, never from the request: a caller who
 * could name the type could send a one-word answer to a multiple-choice
 * question and have it stored as text.
 *
 * Every option id is resolved against the Slide's own options. An id from
 * another Slide, an invented id, or the same id twice are all refused — the
 * last one because a repeated selection would inflate a tally by one person
 * voting twice.
 */
export function validateAnswer(slide: Parse.Object, input: Record<string, unknown>): AnswerCheck {
  const answerType = slide.get('answerType') as AnswerType;

  if (isTextAnswer(answerType)) {
    // A choice payload against a text question is a mismatch, not an empty
    // answer: saying so tells an out-of-date browser what actually happened.
    if (input['selectedOptionId'] !== undefined || input['selectedOptionIds'] !== undefined) {
      return {ok: false, code: 'ANSWER_TYPE_MISMATCH'};
    }

    const text = trimText(input['textAnswer']);
    const bounds =
      answerType === ANSWER_TYPE.SHORT_ANSWER ? LIVE_LIMITS.shortAnswer : LIVE_LIMITS.longAnswer;
    const reason = boundedReason(text, bounds, true);
    if (reason) {
      return {ok: false, code: 'ANSWER_TYPE_MISMATCH', fields: {textAnswer: reason}};
    }

    return {ok: true, values: {textAnswer: text}};
  }

  if (input['textAnswer'] !== undefined) {
    return {ok: false, code: 'ANSWER_TYPE_MISMATCH'};
  }

  const stored = slide.get('options');
  const knownIds = new Set(
    (Array.isArray(stored) ? stored : [])
      .map((option: {id?: unknown}) => String(option?.id ?? ''))
      .filter(id => id.length > 0)
  );

  // Both shapes are accepted on the wire so a single-choice browser may send
  // either; what differs is how many selections the type permits.
  const raw = input['selectedOptionIds'] ?? input['selectedOptionId'];
  const sent = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  const ids = sent.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length !== sent.length) return {ok: false, code: 'ANSWER_OPTION_INVALID'};
  if (ids.length === 0) return {ok: false, code: 'ANSWER_TYPE_MISMATCH'};

  if (new Set(ids).size !== ids.length) return {ok: false, code: 'ANSWER_OPTION_INVALID'};
  if (ids.some(id => !knownIds.has(id))) return {ok: false, code: 'ANSWER_OPTION_INVALID'};

  if (!isMultiSelect(answerType) && ids.length !== 1) {
    return {ok: false, code: 'ANSWER_TYPE_MISMATCH'};
  }

  return isMultiSelect(answerType)
    ? {ok: true, values: {selectedOptionIds: ids}}
    : {ok: true, values: {selectedOptionId: ids[0]}};
}
