/**
 * Batch Tasks, Submissions, and Talent Reel publications ⟨CP7⟩.
 *
 * These interfaces mirror the server's DTOs in
 * `backend/src/cloudCode/modules/BatchTask/dto.ts`. They are hand-written
 * allow-lists on both sides, so a field that is absent here is absent because
 * the server never sends it — not because this file is out of date.
 *
 * ── What is deliberately missing ────────────────────────────────────────────
 * There is no `attachmentStorageKey`, no `finalForBatch`, and no ACL. The
 * storage key locates bytes in GridFS; a browser that held one could ask for
 * somebody else's file. The sentinel is a database mechanism, not information.
 *
 * A Student's view (`StudentTask`) carries no cohort counts. How many
 * classmates have submitted is not theirs to know, so the server does not send
 * it and there is nowhere here to put it.
 */

import { Requirement, SubmissionStatus, TaskStatus, TaskType } from '../utils/task-constants';

/** Why a Task is or is not accepting work. Derived by the server, every time. */
export type AvailabilityReason =
  | 'OPEN'
  | 'NOT_PUBLISHED'
  | 'CLOSED'
  | 'ARCHIVED'
  | 'DEADLINE_PASSED'
  | 'BATCH_NOT_ACTIVE'
  | 'BATCH_CLOSED';

export type PublicationStatus = 'PUBLISHED' | 'UNPUBLISHED';

/** How the Admin configured each of the five submission fields. */
export interface TaskRequirements {
  githubRequirement: Requirement;
  liveDemoRequirement: Requirement;
  driveRequirement: Requirement;
  videoRequirement: Requirement;
  studentNoteRequirement: Requirement;
}

/**
 * A Task's optional brief.
 *
 * Metadata only. The bytes are fetched from a dedicated route with the session
 * attached, and they always arrive as a download — an `.html` brief rendered
 * inline would run its own script in this origin.
 */
export interface TaskAttachment {
  filename: string;
  extension: string;
  /** `pdf`, `docx`, or `html` — a label this app translates. */
  kind: string;
  size: number;
}

/** A Task as its Admin sees it. */
export interface BatchTask {
  id: string;
  batchId: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  deadline?: string;
  requirements: TaskRequirements;
  attachment?: TaskAttachment;
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

/** A Task as a Student sees it, with their own submission state and nothing else. */
export interface StudentTask {
  id: string;
  batchId: string;
  title: string;
  description: string;
  type: TaskType;
  deadline?: string;
  requirements: TaskRequirements;
  attachment?: TaskAttachment;
  isSubmissionOpen: boolean;
  availabilityReason: AvailabilityReason;
  mySubmissionStatus?: SubmissionStatus;
  mySubmittedAt?: string;
  createdAt?: string;
}

/** A Submission, as its own Student sees it. */
export interface TaskSubmission {
  id: string;
  taskId: string;
  status: SubmissionStatus;
  hasEverBeenSubmitted: boolean;
  githubUrl?: string;
  liveDemoUrl?: string;
  googleDriveUrl?: string;
  /** The bare eleven-character video id. Never an embed, never a URL. */
  youtubeVideoId?: string;
  studentNote?: string;
  publicProjectTitle?: string;
  publicProjectDescription?: string;
  technologies?: string[];
  myContribution?: string;
  /** CP8 — echoed back so the form can show what was stored. */
  demoTitle?: string;
  demoVideoUrl?: string;
  publicConsent: boolean;
  submittedAt?: string;
  updatedAt?: string;
  /** This Student's own Reel state. Never anybody else's. */
  talentReelStatus?: PublicationStatus;
}

/** A Submission as an Admin reads it. Read-only, with a display name. */
export interface AdminTaskSubmission extends TaskSubmission {
  studentId: string;
  studentName: string;
  /**
   * Whether an Admin highlighted this Reel ⟨CP8C⟩.
   *
   * Admin-only, and only on this interface — `TaskSubmission` is what a Student
   * reads about their own work, and the server does not send them this. Absent
   * when nothing is published.
   */
  talentReelPinned?: boolean;
}

/** One row of the Admin's per-Task status table. */
export interface TaskStudentRow {
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

/** A Talent Reel publication record, for the Admin's two controls. */
export interface TalentReelPublication {
  id: string;
  submissionId: string;
  taskId: string;
  batchId: string;
  batchName?: string;
  studentId: string;
  studentName?: string;
  status: PublicationStatus;
  /** Sticky. Survives a Student resubmitting; only Publish Again clears it. */
  adminSuppressed: boolean;
  /** CP8C. An Admin highlight. Ordering on the public pages, nothing more. */
  pinned: boolean;
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

/** One row of the Admin Student Detail task history. */
export interface TaskHistoryRow {
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
// What the server sends back
// ═══════════════════════════════════════════════════════════════════════════

export interface TaskList {
  items: BatchTask[];
  studentCount: number;
  canCreate: boolean;
  canPublish: boolean;
  /** So the form can hide the Final Task option instead of failing on save. */
  hasFinalTask: boolean;
}

export interface StudentTaskList {
  items: StudentTask[];
}

export interface StudentTaskDetail {
  task: StudentTask;
  submission?: TaskSubmission;
}

export interface TaskStudentList {
  items: TaskStudentRow[];
  studentCount: number;
  submittedCount: number;
  draftCount: number;
  notSubmittedCount: number;
}

export interface TaskHistoryPage {
  items: TaskHistoryRow[];
  total: number;
}

/**
 * The result of copying a Task to another Batch.
 *
 * `attachmentCopied` is always `false` today and is sent anyway, so the UI can
 * tell the Admin the brief did not travel rather than leaving them to notice
 * the missing file later.
 */
export interface TaskCopyResult {
  task: BatchTask;
  attachmentCopied: boolean;
}

export interface TaskDeleteResult {
  id: string;
  deleted: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// What this app sends
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The Admin's Task form.
 *
 * `type` is sent only on create — a Task never changes type, and the server
 * keeps the existing one whatever an update claims.
 */
export interface TaskInput {
  title: string;
  description: string;
  type?: TaskType;
  /** ISO-8601 UTC, or `null` to clear. Optional throughout. */
  deadline?: string | null;
  githubRequirement?: Requirement;
  liveDemoRequirement?: Requirement;
  driveRequirement?: Requirement;
  videoRequirement?: Requirement;
  studentNoteRequirement?: Requirement;
}

/**
 * A Student's Submission payload.
 *
 * A field the Admin configured as `NOT_USED` is **refused** by the server
 * rather than ignored, so this app must not send one. The form only renders
 * the fields the Task collects, which is what keeps the two in step.
 *
 * `publicConsent` is only ever `true` because the Student ticked the box. It
 * has no default here for the same reason it has none on the server.
 */
export interface SubmissionInput {
  githubUrl?: string;
  liveDemoUrl?: string;
  googleDriveUrl?: string;
  /** A YouTube URL. The server extracts and stores only the video id. */
  youtubeVideoId?: string;
  studentNote?: string;
  publicProjectTitle?: string;
  publicProjectDescription?: string;
  technologies?: string[];
  myContribution?: string;
  publicConsent?: boolean;
  /** CP8 — the optional public demo. Both may be left blank. */
  demoTitle?: string;
  demoVideoUrl?: string;
}
