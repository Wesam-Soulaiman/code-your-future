/**
 * A file an Admin shared with one Batch ⟨CP5⟩.
 *
 * These mirror the backend's two DTOs exactly. Neither carries a storage key, a
 * URL, or anything else that would address the bytes: a Resource is fetched by
 * its `id` through an authenticated route, and there is no other way to reach
 * it. If a field ever appears here that looks like a link, something has gone
 * wrong upstream.
 */

/** What an Admin sees. */
export interface BatchResource {
  id: string;
  title: string;
  description?: string;
  /** The sanitised original name, used for the saved file on download. */
  filename: string;
  /** Lower-case, with the dot — `.pdf`. */
  extension: string;
  /** A short label the UI translates and picks an icon from — `pdf`, `docx`. */
  kind: string;
  fileSize: number;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * What an enrolled Student sees.
 *
 * No `displayOrder` — they read the list in the order it arrives — and no
 * `uploadedBy`, because which Admin uploaded a file is not theirs to know.
 */
export interface StudentBatchResource {
  id: string;
  title: string;
  description?: string;
  filename: string;
  extension: string;
  kind: string;
  fileSize: number;
  createdAt?: string;
}

/**
 * The upload rules, as the server states them.
 *
 * Sent with the list rather than duplicated in the browser: a hint that
 * disagrees with the server is worse than no hint, because it teaches people to
 * distrust the one they are shown.
 */
export interface ResourceUploadRules {
  extensions: string[];
  maxBytes: number;
}

export interface BatchResourceList {
  items: BatchResource[];
  rules: ResourceUploadRules;
  /** True when the Batch is archived: everything is readable, nothing writable. */
  readOnly: boolean;
}

export interface StudentResourceList {
  items: StudentBatchResource[];
}

/** The only thing an edit may change. There is no file replacement. */
export interface ResourceMetadataInput {
  title: string;
  description?: string;
}
