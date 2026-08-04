/**
 * Batch Task constants — the browser's copy ⟨CP7⟩.
 *
 * Mirrors `backend/src/cloudCode/modules/BatchTask/constants.ts`. A backend test
 * asserts the two stay in step: a browser that offers a status the server
 * refuses, or a requirement level it does not understand, teaches people to
 * distrust what they are shown.
 *
 * **The backend is always the authority.** These exist to build the right form
 * and disable the right buttons; every rule is re-checked server-side, and the
 * server's answer wins whenever the two disagree.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tasks
// ═══════════════════════════════════════════════════════════════════════════

/** Exactly two Task types. A Batch may hold at most one Final Task. */
export const TASK_TYPE = {
  ASSIGNMENT: 'ASSIGNMENT',
  FINAL_TASK: 'FINAL_TASK',
} as const;

export type TaskType = (typeof TASK_TYPE)[keyof typeof TASK_TYPE];

export const TASK_TYPES: readonly TaskType[] = [TASK_TYPE.ASSIGNMENT, TASK_TYPE.FINAL_TASK];

/** The four Task statuses. Stored upper-case; the browser translates them. */
export const TASK_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.DRAFT,
  TASK_STATUS.PUBLISHED,
  TASK_STATUS.CLOSED,
  TASK_STATUS.ARCHIVED,
];

/**
 * Which status may follow which.
 *
 * Two of these carry conditions this file cannot express —
 * `PUBLISHED → DRAFT` needs no Submission to exist, and `CLOSED → PUBLISHED`
 * needs an active Batch and an unexpired deadline. The server checks both. This
 * map decides which buttons to *offer*; it never decides whether one works.
 *
 * `ARCHIVED` is terminal, so its entry is an empty list rather than absent — an
 * empty list states the rule, a missing key reads as an oversight.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TASK_STATUS.DRAFT]: [TASK_STATUS.PUBLISHED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.PUBLISHED]: [TASK_STATUS.DRAFT, TASK_STATUS.CLOSED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.CLOSED]: [TASK_STATUS.PUBLISHED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.ARCHIVED]: [],
};

/** Statuses a Student may see at all. A Draft Task is not a Task to them. */
export const STUDENT_VISIBLE_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.PUBLISHED,
  TASK_STATUS.CLOSED,
  TASK_STATUS.ARCHIVED,
];

// ═══════════════════════════════════════════════════════════════════════════
// Submission requirements
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How the Admin configured each submission field.
 *
 * `NOT_USED` means the field is not rendered **and not sent**. The server
 * refuses it rather than ignoring it, so a form that showed it anyway would
 * fail the whole save rather than quietly dropping one value.
 */
export const REQUIREMENT = {
  NOT_USED: 'NOT_USED',
  OPTIONAL: 'OPTIONAL',
  REQUIRED: 'REQUIRED',
} as const;

export type Requirement = (typeof REQUIREMENT)[keyof typeof REQUIREMENT];

export const REQUIREMENTS: readonly Requirement[] = [
  REQUIREMENT.NOT_USED,
  REQUIREMENT.OPTIONAL,
  REQUIREMENT.REQUIRED,
];

/** The requirement column that governs each submission field. */
export interface SubmissionFieldSpec {
  field: 'githubUrl' | 'liveDemoUrl' | 'googleDriveUrl' | 'youtubeVideoId' | 'studentNote';
  requirement:
    | 'githubRequirement'
    | 'liveDemoRequirement'
    | 'driveRequirement'
    | 'videoRequirement'
    | 'studentNoteRequirement';
}

/**
 * The five configurable fields, in the order the form renders them.
 *
 * One table rather than five loose constants, for the same reason the server
 * has one: the form, the validator, and the summary must all walk exactly the
 * same five.
 */
export const SUBMISSION_FIELDS: readonly SubmissionFieldSpec[] = [
  { field: 'githubUrl', requirement: 'githubRequirement' },
  { field: 'liveDemoUrl', requirement: 'liveDemoRequirement' },
  { field: 'googleDriveUrl', requirement: 'driveRequirement' },
  { field: 'youtubeVideoId', requirement: 'videoRequirement' },
  { field: 'studentNote', requirement: 'studentNoteRequirement' },
];

export const REQUIREMENT_COLUMNS: readonly SubmissionFieldSpec['requirement'][] =
  SUBMISSION_FIELDS.map((spec) => spec.requirement);

// ═══════════════════════════════════════════════════════════════════════════
// Submissions and publication
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exactly two Submission statuses.
 *
 * There is no `UNDER_REVIEW`, `ACCEPTED`, `REJECTED`, or `LATE`. The product
 * has no review workflow, and a label implying judgement would need somebody to
 * have made one.
 */
export const SUBMISSION_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
} as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.SUBMITTED,
];

export const PUBLICATION_STATUS = {
  PUBLISHED: 'PUBLISHED',
  UNPUBLISHED: 'UNPUBLISHED',
} as const;

export type PublicationStatus = (typeof PUBLICATION_STATUS)[keyof typeof PUBLICATION_STATUS];

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  PUBLICATION_STATUS.PUBLISHED,
  PUBLICATION_STATUS.UNPUBLISHED,
];

// ═══════════════════════════════════════════════════════════════════════════
// Bounds — for the form's counters, not for the decision
// ═══════════════════════════════════════════════════════════════════════════

export const TASK_LIMITS = {
  title: { min: 2, max: 160 },
  description: { min: 1, max: 4000 },
  studentNote: { max: 2000 },
  publicProjectTitle: { min: 1, max: 100 },
  publicProjectDescription: { min: 1, max: 500 },
  myContribution: { min: 1, max: 500 },
  technologyItem: { min: 1, max: 50 },
  url: { max: 500 },
} as const;

export const TECHNOLOGY_COUNT = { min: 1, max: 10 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// Attachments
// ═══════════════════════════════════════════════════════════════════════════

/** 20 MiB. The server refuses more at the socket; this only saves the upload. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** The four accepted brief formats. */
export const ATTACHMENT_EXTENSIONS: readonly string[] = ['.pdf', '.docx', '.html', '.htm'];

/** For the file input's `accept`, which is a convenience and not a check. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.join(',');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && TASK_TYPES.includes(value as TaskType);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

export function isRequirement(value: unknown): value is Requirement {
  return typeof value === 'string' && REQUIREMENTS.includes(value as Requirement);
}

/** Whether a Task collects this field at all. */
export function collectsField(
  requirements: Record<string, string> | undefined,
  spec: SubmissionFieldSpec,
): boolean {
  return requirements?.[spec.requirement] !== undefined
    ? requirements[spec.requirement] !== REQUIREMENT.NOT_USED
    : false;
}

/** Whether this field must be filled before the Student may submit. */
export function fieldIsRequired(
  requirements: Record<string, string> | undefined,
  spec: SubmissionFieldSpec,
): boolean {
  return requirements?.[spec.requirement] === REQUIREMENT.REQUIRED;
}

/**
 * A human-sized byte count, for an attachment label.
 *
 * Binary units, because the limit is 20 MiB and a label reading "20.97 MB"
 * next to a "20 MB maximum" would look like a bug.
 */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
