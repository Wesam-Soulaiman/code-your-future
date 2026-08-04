/**
 * What a browser receives from Tasks, Submissions, and Reels ⟨CP7⟩.
 *
 * Hand-built allow-lists, every one. Nothing is spread from a Parse object, so
 * a column added to a model later cannot appear in a response by accident — it
 * has to be put here on purpose.
 *
 * ── Three audiences, three shapes ───────────────────────────────────────────
 * An Admin's Task DTO carries submission counts; a Student's carries their own
 * state and no counts at all, because "18 of 20 have submitted" tells a Student
 * something about the other nineteen. A Student's Submission DTO is their own
 * row; an Admin's adds the Student's display name and nothing more personal.
 *
 * `attachmentStorageKey` is in **no** DTO, and there is no fourth DTO that has
 * it. A browser addresses an attachment by its Task's id and nothing else.
 */

import {
  PublicationStatus,
  Requirement,
  SUBMISSION_FIELDS,
  SubmissionStatus,
  TaskStatus,
  TaskType,
} from './constants';
import {AvailabilityReason} from './availability';

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

export interface RequirementsDto {
  githubRequirement: Requirement;
  liveDemoRequirement: Requirement;
  driveRequirement: Requirement;
  videoRequirement: Requirement;
  studentNoteRequirement: Requirement;
}

export interface AttachmentDto {
  filename: string;
  extension: string;
  /** A short label the browser translates — `pdf`, `docx`, `html`. */
  kind: string;
  size: number;
}

/** A Task as its Admin sees it. */
export interface TaskDto {
  id: string;
  batchId: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  deadline?: string;
  requirements: RequirementsDto;
  attachment?: AttachmentDto;
  isSubmissionOpen: boolean;
  availabilityReason: AvailabilityReason;
  /** Whether the Admin may still change the Task's own fields. */
  editable: boolean;
  /** Whether type, requirements, and attachment are frozen by a Submission. */
  requirementsFrozen: boolean;
  submittedCount?: number;
  draftCount?: number;
  studentCount?: number;
  publishedAt?: string;
  closedAt?: string;
  archivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A Task as a Student sees it.
 *
 * No counts, no `editable`, no `requirementsFrozen` — none of which is theirs to
 * know. `mySubmissionStatus` is the only state added, and it is their own.
 */
export interface StudentTaskDto {
  id: string;
  batchId: string;
  title: string;
  description: string;
  type: TaskType;
  deadline?: string;
  requirements: RequirementsDto;
  attachment?: AttachmentDto;
  isSubmissionOpen: boolean;
  availabilityReason: AvailabilityReason;
  mySubmissionStatus?: SubmissionStatus;
  mySubmittedAt?: string;
  createdAt?: string;
}

/** A Submission, as its own Student sees it. */
export interface SubmissionDto {
  id: string;
  taskId: string;
  status: SubmissionStatus;
  hasEverBeenSubmitted: boolean;
  githubUrl?: string;
  liveDemoUrl?: string;
  googleDriveUrl?: string;
  youtubeVideoId?: string;
  studentNote?: string;
  publicProjectTitle?: string;
  publicProjectDescription?: string;
  technologies?: string[];
  myContribution?: string;
  publicConsent: boolean;
  submittedAt?: string;
  updatedAt?: string;
  /** This Student's own Reel state. Never anybody else's. */
  talentReelStatus?: PublicationStatus;
}

/** A Submission as an Admin reads it. Read-only, with a display name. */
export interface AdminSubmissionDto extends SubmissionDto {
  studentId: string;
  studentName: string;
}

/** One row of the Admin's per-Task status table. */
export interface TaskStudentRowDto {
  studentId: string;
  studentName: string;
  profileComplete: boolean;
  /** Absent means Not Submitted — derived, never a stored row. */
  submissionStatus?: SubmissionStatus;
  submissionId?: string;
  submittedAt?: string;
  updatedAt?: string;
  hasGithub: boolean;
  hasLiveDemo: boolean;
  hasDrive: boolean;
  hasVideo: boolean;
  talentReelStatus?: PublicationStatus;
}

/** A Talent Reel publication, for the Admin's controls. */
export interface PublicationDto {
  id: string;
  submissionId: string;
  taskId: string;
  batchId: string;
  batchName?: string;
  studentId: string;
  studentName?: string;
  status: PublicationStatus;
  adminSuppressed: boolean;
  projectTitle: string;
  projectDescription: string;
  technologies: string[];
  contribution: string;
  youtubeVideoId: string;
  githubUrl?: string;
  liveDemoUrl?: string;
  publishedAt?: string;
  unpublishedAt?: string;
}

/** One row of the Admin Student Detail history. */
export interface TaskHistoryRowDto {
  id: string;
  batchId: string;
  batchName: string;
  taskId: string;
  taskTitle: string;
  taskType: TaskType;
  deadline?: string;
  submissionStatus: SubmissionStatus;
  submittedAt?: string;
  updatedAt?: string;
  talentReelStatus?: PublicationStatus;
}

// ═══════════════════════════════════════════════════════════════════════════
// Keys that must never appear
// ═══════════════════════════════════════════════════════════════════════════

/** Asserted by a test against the real DTOs, so this is a check not a comment. */
export const FORBIDDEN_TASK_DTO_KEYS: readonly string[] = [
  'ACL',
  'acl',
  'className',
  '__type',
  'objectId',
  'attributes',
  'sessionToken',
  'masterKey',
  'attachmentStorageKey',
  'storageKey',
  'finalForBatch',
  'createdBy',
  'unpublishedBy',
  'studentProfile',
  'publicationSource',
  'url',
  'downloadUrl',
  'location',
  'email',
  'verifiedEmail',
  'phone',
  'dateOfBirth',
  'providerSubject',
];

// ═══════════════════════════════════════════════════════════════════════════
// Builders
// ═══════════════════════════════════════════════════════════════════════════

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function iso(value: unknown): string | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : undefined;
}

/** The kind label for an extension. Derived, never stored. */
function kindOf(extension: unknown): string {
  const normalised = typeof extension === 'string' ? extension.replace(/^\./, '') : '';
  return normalised === 'htm' ? 'html' : normalised;
}

export function requirementsOf(task: Parse.Object): RequirementsDto {
  const out: Record<string, unknown> = {};
  for (const spec of SUBMISSION_FIELDS) {
    out[spec.requirement] = task.get(spec.requirement);
  }
  return out as unknown as RequirementsDto;
}

export function attachmentOf(task: Parse.Object): AttachmentDto | undefined {
  const filename = optionalString(task.get('attachmentFilename'));
  if (!filename) return undefined;
  return {
    filename,
    extension: String(task.get('attachmentExtension') ?? ''),
    kind: kindOf(task.get('attachmentExtension')),
    size: Number(task.get('attachmentSize') ?? 0),
  };
}

export function toTaskDto(
  task: Parse.Object,
  extra: {
    batchId: string;
    isSubmissionOpen: boolean;
    availabilityReason: AvailabilityReason;
    editable: boolean;
    requirementsFrozen: boolean;
    submittedCount?: number;
    draftCount?: number;
    studentCount?: number;
  }
): TaskDto {
  const dto: TaskDto = {
    id: task.id,
    batchId: extra.batchId,
    title: String(task.get('title') ?? ''),
    description: String(task.get('description') ?? ''),
    type: task.get('type') as TaskType,
    status: task.get('status') as TaskStatus,
    requirements: requirementsOf(task),
    isSubmissionOpen: extra.isSubmissionOpen,
    availabilityReason: extra.availabilityReason,
    editable: extra.editable,
    requirementsFrozen: extra.requirementsFrozen,
  };

  const deadline = iso(task.get('deadline'));
  if (deadline) dto.deadline = deadline;

  const attachment = attachmentOf(task);
  if (attachment) dto.attachment = attachment;

  if (extra.submittedCount !== undefined) dto.submittedCount = extra.submittedCount;
  if (extra.draftCount !== undefined) dto.draftCount = extra.draftCount;
  if (extra.studentCount !== undefined) dto.studentCount = extra.studentCount;

  const publishedAt = iso(task.get('publishedAt'));
  if (publishedAt) dto.publishedAt = publishedAt;

  const closedAt = iso(task.get('closedAt'));
  if (closedAt) dto.closedAt = closedAt;

  const archivedAt = iso(task.get('archivedAt'));
  if (archivedAt) dto.archivedAt = archivedAt;

  const createdAt = iso(task.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  const updatedAt = iso(task.get('updatedAt'));
  if (updatedAt) dto.updatedAt = updatedAt;

  return dto;
}

export function toStudentTaskDto(
  task: Parse.Object,
  extra: {
    batchId: string;
    isSubmissionOpen: boolean;
    availabilityReason: AvailabilityReason;
    submission?: Parse.Object;
  }
): StudentTaskDto {
  const dto: StudentTaskDto = {
    id: task.id,
    batchId: extra.batchId,
    title: String(task.get('title') ?? ''),
    description: String(task.get('description') ?? ''),
    type: task.get('type') as TaskType,
    requirements: requirementsOf(task),
    isSubmissionOpen: extra.isSubmissionOpen,
    availabilityReason: extra.availabilityReason,
  };

  const deadline = iso(task.get('deadline'));
  if (deadline) dto.deadline = deadline;

  const attachment = attachmentOf(task);
  if (attachment) dto.attachment = attachment;

  if (extra.submission) {
    dto.mySubmissionStatus = extra.submission.get('status') as SubmissionStatus;
    const submittedAt = iso(extra.submission.get('submittedAt'));
    if (submittedAt) dto.mySubmittedAt = submittedAt;
  }

  const createdAt = iso(task.get('createdAt'));
  if (createdAt) dto.createdAt = createdAt;

  return dto;
}

export function toSubmissionDto(
  submission: Parse.Object,
  publication?: Parse.Object
): SubmissionDto {
  const dto: SubmissionDto = {
    id: submission.id,
    taskId: String((submission.get('task') as Parse.Object | undefined)?.id ?? ''),
    status: submission.get('status') as SubmissionStatus,
    hasEverBeenSubmitted: submission.get('hasEverBeenSubmitted') === true,
    publicConsent: submission.get('publicConsent') === true,
  };

  // One loop over a fixed list of optional strings. The cast goes through
  // `unknown` because a DTO deliberately has no index signature — a response
  // shape that accepted any key would defeat the point of an allow-list.
  const writable = dto as unknown as Record<string, unknown>;
  for (const field of [
    'githubUrl',
    'liveDemoUrl',
    'googleDriveUrl',
    'youtubeVideoId',
    'studentNote',
    'publicProjectTitle',
    'publicProjectDescription',
    'myContribution',
  ] as const) {
    const value = optionalString(submission.get(field));
    if (value) writable[field] = value;
  }

  const technologies = submission.get('technologies');
  if (Array.isArray(technologies) && technologies.length > 0) {
    dto.technologies = technologies.filter((item): item is string => typeof item === 'string');
  }

  const submittedAt = iso(submission.get('submittedAt'));
  if (submittedAt) dto.submittedAt = submittedAt;

  const updatedAt = iso(submission.get('updatedAt'));
  if (updatedAt) dto.updatedAt = updatedAt;

  if (publication) dto.talentReelStatus = publication.get('status') as PublicationStatus;

  return dto;
}

export function toAdminSubmissionDto(
  submission: Parse.Object,
  studentName: string,
  publication?: Parse.Object
): AdminSubmissionDto {
  return {
    ...toSubmissionDto(submission, publication),
    studentId: String((submission.get('student') as Parse.User | undefined)?.id ?? ''),
    studentName,
  };
}

export function toPublicationDto(
  publication: Parse.Object,
  extra: {batchName?: string; studentName?: string} = {}
): PublicationDto {
  const dto: PublicationDto = {
    id: publication.id,
    submissionId: String((publication.get('submission') as Parse.Object | undefined)?.id ?? ''),
    taskId: String((publication.get('task') as Parse.Object | undefined)?.id ?? ''),
    batchId: String((publication.get('batch') as Parse.Object | undefined)?.id ?? ''),
    studentId: String((publication.get('student') as Parse.User | undefined)?.id ?? ''),
    status: publication.get('status') as PublicationStatus,
    adminSuppressed: publication.get('adminSuppressed') === true,
    projectTitle: String(publication.get('projectTitle') ?? ''),
    projectDescription: String(publication.get('projectDescription') ?? ''),
    technologies: Array.isArray(publication.get('technologies'))
      ? (publication.get('technologies') as unknown[]).filter(
          (item): item is string => typeof item === 'string'
        )
      : [],
    contribution: String(publication.get('contribution') ?? ''),
    youtubeVideoId: String(publication.get('youtubeVideoId') ?? ''),
  };

  const github = optionalString(publication.get('githubUrl'));
  if (github) dto.githubUrl = github;

  const demo = optionalString(publication.get('liveDemoUrl'));
  if (demo) dto.liveDemoUrl = demo;

  const publishedAt = iso(publication.get('publishedAt'));
  if (publishedAt) dto.publishedAt = publishedAt;

  const unpublishedAt = iso(publication.get('unpublishedAt'));
  if (unpublishedAt) dto.unpublishedAt = unpublishedAt;

  if (extra.batchName) dto.batchName = extra.batchName;
  if (extra.studentName) dto.studentName = extra.studentName;

  return dto;
}
