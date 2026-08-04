/**
 * Validating everything a caller sends to Tasks and Submissions ⟨CP7⟩.
 *
 * Every rejection is a **field name plus a stable reason code** — never the
 * value that failed. A rejected URL is a link to somebody's work and a rejected
 * note is what they wrote about it; echoing either back is how it ends up
 * rendered onto a page and written into a log.
 *
 * ── The requirements decide what is even accepted ───────────────────────────
 * A field the Admin configured as `NOT_USED` is **refused**, not ignored. That
 * matters: a stale browser that still shows the field would otherwise store
 * something the Admin decided not to collect, and nobody would find out until
 * somebody read the database.
 */

import {
  REQUIREMENT,
  SUBMISSION_FIELDS,
  TASK_LIMITS,
  TASK_TYPE,
  TECHNOLOGY_COUNT,
  TaskType,
  isRequirement,
  isTaskType,
} from './constants';
import {FieldErrors, FieldReason} from './errors';
import {FieldReasonCode} from '../StudentProfile/errors';
import {FIELD_URL_KIND, validateUrl} from './urls';

/** Collapse internal whitespace and trim, so " A  B " and "A B" are one title. */
function normaliseText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Trim only — internal spacing in a description is the author's formatting. */
function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Bound one piece of text and report why it failed, never what it said. */
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
// Tasks
// ═══════════════════════════════════════════════════════════════════════════

export interface TaskRequirements {
  githubRequirement: string;
  liveDemoRequirement: string;
  driveRequirement: string;
  videoRequirement: string;
  studentNoteRequirement: string;
}

export interface TaskValues {
  title: string;
  description: string;
  type: TaskType;
  deadline?: Date;
  requirements: TaskRequirements;
}

export interface TaskValidation {
  values: TaskValues;
  errors: FieldErrors;
}

/**
 * A deadline, as an instant.
 *
 * Accepts an ISO string — the browser sends what its picker produced, converted
 * to UTC. It is **not** trusted as "still in the future": whether a deadline has
 * passed is decided against the server clock at the moment of every submission,
 * never against a flag a client computed.
 */
export function parseDeadline(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== 'string') return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  // A deadline centuries away is a typo, not a policy.
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return parsed;
}

export function validateTask(
  input: Record<string, unknown>,
  context: {existingType?: TaskType} = {}
): TaskValidation {
  const errors: FieldErrors = {};

  const title = normaliseText(input['title']);
  const titleReason = boundedReason(title, TASK_LIMITS.title, true);
  if (titleReason) errors['title'] = titleReason;

  const description = trimText(input['description']);
  const descriptionReason = boundedReason(description, TASK_LIMITS.description, true);
  if (descriptionReason) errors['description'] = descriptionReason;

  // A Task never changes type once created, so an existing one wins over
  // whatever the request claims.
  const requested = input['type'];
  const type = context.existingType ?? (isTaskType(requested) ? requested : undefined);
  if (!type) errors['type'] = FieldReason.NOT_ALLOWED;

  let deadline: Date | undefined;
  if (input['deadline'] !== undefined && input['deadline'] !== null && input['deadline'] !== '') {
    deadline = parseDeadline(input['deadline']);
    if (!deadline) errors['deadline'] = FieldReason.INVALID;
  }

  const requirements: TaskRequirements = {
    githubRequirement: REQUIREMENT.NOT_USED,
    liveDemoRequirement: REQUIREMENT.NOT_USED,
    driveRequirement: REQUIREMENT.NOT_USED,
    videoRequirement: REQUIREMENT.NOT_USED,
    studentNoteRequirement: REQUIREMENT.NOT_USED,
  };

  for (const spec of SUBMISSION_FIELDS) {
    const supplied = input[spec.requirement];
    if (supplied === undefined) continue; // Absent means "leave it not used".
    if (!isRequirement(supplied)) {
      errors[spec.requirement] = FieldReason.NOT_ALLOWED;
      continue;
    }
    requirements[spec.requirement] = supplied;
  }

  return {
    values: {
      title,
      description,
      type: type ?? TASK_TYPE.ASSIGNMENT,
      deadline,
      requirements,
    },
    errors,
  };
}

/** Fields a caller must never set on a Task or a Submission. */
export function findPrivilegedTaskFields(input: Record<string, unknown>): string[] {
  const forbidden = [
    'studentId',
    'studentProfileId',
    'studentProfile',
    'student',
    'createdBy',
    'status',
    'submittedAt',
    'publishedAt',
    'closedAt',
    'archivedAt',
    'publicConsentAt',
    'hasEverBeenSubmitted',
    'finalForBatch',
    'attachmentStorageKey',
    'attachmentFilename',
    'attachmentSize',
    'attachmentMimeType',
    'adminSuppressed',
    'publicationSource',
    'publicProfileSlug',
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

// ═══════════════════════════════════════════════════════════════════════════
// Submissions
// ═══════════════════════════════════════════════════════════════════════════

export interface SubmissionValues {
  githubUrl?: string;
  liveDemoUrl?: string;
  googleDriveUrl?: string;
  youtubeVideoId?: string;
  studentNote?: string;
  publicProjectTitle?: string;
  publicProjectDescription?: string;
  technologies?: string[];
  myContribution?: string;
  publicConsent?: boolean;
}

export interface SubmissionValidation {
  values: SubmissionValues;
  errors: FieldErrors;
  /** Fields the Task does not collect that the caller sent anyway. */
  notUsed: string[];
  /** Required fields that are missing. Only fatal on Submit. */
  missing: string[];
}

/**
 * Validate one Submission payload against **the Task's own requirements**.
 *
 * `forSubmit` is the difference between saving and handing in: a Draft may be
 * missing required fields, because a draft that refused to save until it was
 * finished would not be a draft. Everything that *is* present must still be
 * valid either way — storing a malformed URL now and discovering it at the
 * deadline helps nobody.
 */
export function validateSubmission(
  input: Record<string, unknown>,
  task: {
    type: TaskType;
    requirements: TaskRequirements;
  },
  forSubmit: boolean
): SubmissionValidation {
  const errors: FieldErrors = {};
  const notUsed: string[] = [];
  const missing: string[] = [];
  const values: SubmissionValues = {};

  for (const spec of SUBMISSION_FIELDS) {
    const level = task.requirements[spec.requirement];
    const supplied = input[spec.field];
    const present = supplied !== undefined && supplied !== null && String(supplied).trim() !== '';

    if (!present) {
      if (level === REQUIREMENT.REQUIRED && forSubmit) missing.push(spec.field);
      continue;
    }

    // A field the Admin does not collect is refused outright, not dropped.
    if (level === REQUIREMENT.NOT_USED) {
      notUsed.push(spec.field);
      continue;
    }

    if (spec.field === 'studentNote') {
      const note = trimText(supplied);
      const reason = boundedReason(note, TASK_LIMITS.studentNote, false);
      if (reason) errors[spec.field] = reason;
      else values.studentNote = note;
      continue;
    }

    const kind = FIELD_URL_KIND[spec.field];
    const check = validateUrl(kind, supplied);
    if (!check.ok) {
      errors[spec.field] =
        check.reason === 'NOT_ALLOWED' ? FieldReason.NOT_ALLOWED : FieldReason.INVALID;
      continue;
    }
    // The stored value is the canonical one — a normalised URL, or for YouTube
    // the bare video id.
    (values as Record<string, unknown>)[spec.field] = check.value;
  }

  // ── The Final Task's public project fields ─────────────────────────────────
  const publicKeys = [
    'publicProjectTitle',
    'publicProjectDescription',
    'technologies',
    'myContribution',
    'publicConsent',
  ];

  if (task.type !== TASK_TYPE.FINAL_TASK) {
    // An Assignment has no public project, so these are refused rather than
    // silently dropped — a browser sending them is confused about what it is.
    for (const key of publicKeys) {
      if (input[key] !== undefined && input[key] !== null && input[key] !== '') {
        notUsed.push(key);
      }
    }
    return {values, errors, notUsed, missing};
  }

  const projectTitle = normaliseText(input['publicProjectTitle']);
  if (projectTitle) {
    const reason = boundedReason(projectTitle, TASK_LIMITS.publicProjectTitle, false);
    if (reason) errors['publicProjectTitle'] = reason;
    else values.publicProjectTitle = projectTitle;
  }

  const projectDescription = trimText(input['publicProjectDescription']);
  if (projectDescription) {
    const reason = boundedReason(projectDescription, TASK_LIMITS.publicProjectDescription, false);
    if (reason) errors['publicProjectDescription'] = reason;
    else values.publicProjectDescription = projectDescription;
  }

  const contribution = trimText(input['myContribution']);
  if (contribution) {
    const reason = boundedReason(contribution, TASK_LIMITS.myContribution, false);
    if (reason) errors['myContribution'] = reason;
    else values.myContribution = contribution;
  }

  if (input['technologies'] !== undefined && input['technologies'] !== null) {
    const result = validateTechnologies(input['technologies']);
    if (result.reason) errors['technologies'] = result.reason;
    else values.technologies = result.items;
  }

  // Consent is a boolean the Student sets. Anything else is not consent.
  if (input['publicConsent'] !== undefined) {
    if (typeof input['publicConsent'] !== 'boolean') {
      errors['publicConsent'] = FieldReason.INVALID;
    } else {
      values.publicConsent = input['publicConsent'];
    }
  }

  return {values, errors, notUsed, missing};
}

/**
 * The technology list.
 *
 * Deduplicated case-insensitively — "React" and "react" are one technology, and
 * a Reel listing both looks careless. The **first** spelling wins, so the
 * Student's own capitalisation is what gets published.
 */
export function validateTechnologies(raw: unknown): {
  items: string[];
  reason?: FieldReasonCode;
} {
  if (!Array.isArray(raw)) return {items: [], reason: FieldReason.INVALID};
  if (raw.length > TECHNOLOGY_COUNT.max) return {items: [], reason: FieldReason.TOO_LONG};

  const items: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const text = normaliseText(entry);
    if (text.length === 0) return {items: [], reason: FieldReason.REQUIRED};
    if (text.length > TASK_LIMITS.technologyItem.max) return {items: [], reason: FieldReason.TOO_LONG};

    const key = text.toLowerCase();
    if (seen.has(key)) return {items: [], reason: FieldReason.NOT_ALLOWED};
    seen.add(key);
    items.push(text);
  }

  return {items};
}
