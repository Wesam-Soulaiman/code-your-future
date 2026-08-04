/**
 * What a Batch Task, a Submission, and a Talent Reel publication may be ⟨CP7⟩.
 *
 * `frontend/src/app/utils/task-constants.ts` mirrors this file and a test
 * asserts the two stay in step — the same contract every other surface here
 * has, for the same reason: a browser that offers a status the server refuses
 * teaches people to distrust what they are shown.
 *
 * Every list is **closed**. There is no "other", and there is nowhere to put a
 * value somebody invents later.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Tasks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exactly two Task types.
 *
 * A Final Task differs from an Assignment in exactly two ways: a Batch may hold
 * at most one, and only it may carry the public project fields that feed a
 * Talent Reel. Everything else about them is identical, which is why there is no
 * third type and no per-type subclass.
 */
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
 * `PUBLISHED → DRAFT` and `CLOSED → PUBLISHED` carry extra conditions the
 * transition table cannot express — no Submission may exist for the first, and
 * the Batch must still be active with an unexpired deadline for the second — so
 * the operations check those as well. This map is the shape of the lifecycle,
 * not the whole of it.
 *
 * `ARCHIVED` is terminal, so its entry is deliberately empty rather than
 * absent: an empty list states the rule, a missing key reads as an oversight.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TASK_STATUS.DRAFT]: [TASK_STATUS.PUBLISHED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.PUBLISHED]: [TASK_STATUS.DRAFT, TASK_STATUS.CLOSED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.CLOSED]: [TASK_STATUS.PUBLISHED, TASK_STATUS.ARCHIVED],
  [TASK_STATUS.ARCHIVED]: [],
};

/** The one status in which a Task's own fields may be edited freely. */
export const EDITABLE_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.DRAFT,
  TASK_STATUS.PUBLISHED,
];

/** Statuses a Student may see at all. A Draft Task is not a Task to them. */
export const STUDENT_VISIBLE_TASK_STATUSES: readonly TaskStatus[] = [
  TASK_STATUS.PUBLISHED,
  TASK_STATUS.CLOSED,
  TASK_STATUS.ARCHIVED,
];

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && TASK_TYPES.includes(value as TaskType);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUSES.includes(value as TaskStatus);
}

// ═══════════════════════════════════════════════════════════════════════════
// Submission requirements
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How an Admin configures each submission field.
 *
 * `NOT_USED` is stronger than "leave it blank": a field configured that way is
 * **refused** in a Student payload rather than ignored, so a stale browser
 * cannot quietly store something the Admin decided not to collect.
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

export function isRequirement(value: unknown): value is Requirement {
  return typeof value === 'string' && REQUIREMENTS.includes(value as Requirement);
}

/**
 * The five configurable submission fields, and the column each is stored in.
 *
 * Declared as one table rather than five loose constants, because every place
 * that walks the requirements — validation, the DTO, the freeze check, the
 * browser's form — must walk exactly the same five. A sixth field is a product
 * decision that has to be made here, once.
 */
export interface SubmissionFieldSpec {
  /** The field on a Submission. */
  field: 'githubUrl' | 'liveDemoUrl' | 'googleDriveUrl' | 'youtubeVideoId' | 'studentNote';
  /** The requirement column on the Task. */
  requirement:
    | 'githubRequirement'
    | 'liveDemoRequirement'
    | 'driveRequirement'
    | 'videoRequirement'
    | 'studentNoteRequirement';
}

export const SUBMISSION_FIELDS: readonly SubmissionFieldSpec[] = [
  {field: 'githubUrl', requirement: 'githubRequirement'},
  {field: 'liveDemoUrl', requirement: 'liveDemoRequirement'},
  {field: 'googleDriveUrl', requirement: 'driveRequirement'},
  {field: 'youtubeVideoId', requirement: 'videoRequirement'},
  {field: 'studentNote', requirement: 'studentNoteRequirement'},
];

/** Every requirement column, for the freeze check and the schema. */
export const REQUIREMENT_COLUMNS: readonly SubmissionFieldSpec['requirement'][] =
  SUBMISSION_FIELDS.map(spec => spec.requirement);

// ═══════════════════════════════════════════════════════════════════════════
// Submissions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exactly two Submission statuses.
 *
 * There is no `UNDER_REVIEW`, `ACCEPTED`, `REJECTED`, `CHANGES_REQUESTED`, or
 * `LATE`, and adding one is not a small change: the product deliberately has no
 * Admin review workflow, and a status implying judgement would need somebody to
 * make it.
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

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === 'string' && SUBMISSION_STATUSES.includes(value as SubmissionStatus);
}

// ═══════════════════════════════════════════════════════════════════════════
// Talent Reel publication
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exactly two publication statuses.
 *
 * No `PENDING_APPROVAL`, no `APPROVED`, no `REJECTED`. Publication is decided by
 * eligibility and the Student's consent, never by an Admin's opinion — the only
 * Admin lever is suppression, and that is a separate boolean rather than a
 * status, because it must survive a Student's later resubmission.
 */
export const PUBLICATION_STATUS = {
  PUBLISHED: 'PUBLISHED',
  UNPUBLISHED: 'UNPUBLISHED',
} as const;

export type PublicationStatus = (typeof PUBLICATION_STATUS)[keyof typeof PUBLICATION_STATUS];

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  PUBLICATION_STATUS.PUBLISHED,
  PUBLICATION_STATUS.UNPUBLISHED,
];

/** How a publication came to be. Recorded for an operator, never shown. */
export const PUBLICATION_SOURCE = {
  /** The Student submitted an eligible Final Task. */
  AUTOMATIC: 'AUTOMATIC',
  /** An Admin cleared their own suppression with Publish Again. */
  ADMIN_REPUBLISH: 'ADMIN_REPUBLISH',
} as const;

export type PublicationSource = (typeof PUBLICATION_SOURCE)[keyof typeof PUBLICATION_SOURCE];

// ═══════════════════════════════════════════════════════════════════════════
// Bounds
// ═══════════════════════════════════════════════════════════════════════════

/** Length bounds. Generous for real work, tight enough to bound storage. */
export const TASK_LIMITS = {
  title: {min: 2, max: 160},
  description: {min: 1, max: 4000},
  studentNote: {max: 2000},
  publicProjectTitle: {min: 1, max: 100},
  publicProjectDescription: {min: 1, max: 500},
  myContribution: {min: 1, max: 500},
  technologyItem: {min: 1, max: 50},
  url: {max: 500},
} as const;

/** How many technologies one project may list. */
export const TECHNOLOGY_COUNT = {min: 1, max: 10} as const;

/** How many Tasks one page returns. */
export const TASK_PAGE = {defaultLimit: 20, maxLimit: 100} as const;

/** How many Students one Task-status page returns. */
export const SUBMISSION_PAGE = {defaultLimit: 25, maxLimit: 200} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Attachments
// ═══════════════════════════════════════════════════════════════════════════

/** 20 MiB, matching the Resource limit. Enforced at the socket, not after. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The four accepted attachment formats.
 *
 * A narrower list than Resources: a Task brief is a document, so the
 * spreadsheet and presentation formats are deliberately absent. The shapes are
 * validated by `modules/BatchResource/fileValidation`, which already knows how
 * to tell a real `.docx` from a renamed `.jar`.
 */
export const ATTACHMENT_EXTENSIONS: readonly string[] = ['.pdf', '.docx', '.html', '.htm'];

/** Storage keys: `task_` + 32 hex characters. */
export const ATTACHMENT_KEY_PREFIX = 'task_';
export const ATTACHMENT_KEY_BYTES = 16;

// ═══════════════════════════════════════════════════════════════════════════
// The public slug
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A Student's stable public identifier, minted on their first published Reel.
 *
 * Random rather than derived. A slug built from a name collides between two
 * people called the same thing; one built from an email publishes the email;
 * one built from an `objectId` lets a reader walk the database's identifiers.
 * Twelve random URL-safe characters is 71 bits — unguessable, and short enough
 * to live in a link somebody types.
 */
export const PUBLIC_SLUG_LENGTH = 12;
export const PUBLIC_SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
