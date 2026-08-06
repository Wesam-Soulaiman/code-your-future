/**
 * The public talent surface, as the browser sees it ⟨CP8⟩.
 *
 * These mirror `backend/src/cloudCode/modules/PublicTalent/dto.ts`. Both sides
 * are hand-written allow-lists, so a field missing here is missing because the
 * server never sends it.
 *
 * ── There is no private field to omit, because none arrives ─────────────────
 * No email, phone, date of birth, institution, batch, enrollment, submission,
 * storage key, `objectId`, or Parse pointer appears anywhere below. That is not
 * a rule this file enforces — it is a description of what the endpoints return.
 * The enforcement is server-side, where it belongs.
 */

/** The embedded video on a public page. Both URLs are built by the server. */
export interface PublicVideo {
  /** The eleven-character YouTube id. */
  videoId: string;
  /** `https://www.youtube.com/embed/{id}`. Never assembled in the browser. */
  embedUrl: string;
  /** `https://www.youtube.com/watch?v={id}`, for opening in a new tab. */
  watchUrl: string;
}

/** One card in the public directory. */
export interface PublicStudentCard {
  /** The stable public identifier, and the only id the browser ever holds. */
  slug: string;
  name: string;
  targetRole?: string;
  city?: string;
  /** A path the server serves bytes from. Absent when there is no photo. */
  photoUrl?: string;
  technologies: string[];
  hasDemo: boolean;
  /**
   * Whether an Admin highlighted this ⟨CP8C⟩.
   *
   * Everything the pin exposes publicly. The page does not sort on it — the
   * server already returned these in order — it only marks them.
   */
  pinned: boolean;
}

/** One published project on a public profile. */
export interface PublicProject {
  title: string;
  description: string;
  contribution: string;
  technologies: string[];
  video: PublicVideo;
  /** Whether the video shown is a titled demo rather than the project video. */
  isDemo: boolean;
  githubUrl?: string;
  liveDemoUrl?: string;
  publishedAt?: string;
}

/** A whole public profile. */
export interface PublicStudentProfile {
  slug: string;
  name: string;
  targetRole?: string;
  city?: string;
  educationStatus?: string;
  about?: string;
  photoUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  technologies: string[];
  /** Institution and major, when the Student filled either in. */
  education?: { institution?: string; major?: string };
  projects: PublicProject[];
}

/** One full-screen item in the vertical Talent Reel. */
export interface PublicReelItem {
  slug: string;
  name: string;
  targetRole?: string;
  /** Where they are. The closest thing this product stores to a location. */
  city?: string;
  /** A path the server serves bytes from. Absent when there is no photo. */
  photoUrl?: string;
  title: string;
  technologies: string[];
  video: PublicVideo;
  /**
   * Whether an Admin highlighted this ⟨CP8C⟩.
   *
   * Everything the pin exposes publicly. The page does not sort on it — the
   * server already returned these in order — it only marks them.
   */
  pinned: boolean;
}

/** A page of results. The server paginates; the browser never slices. */
export interface PublicPage<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

/** The values worth offering as filters, built from what is published. */
export interface PublicFilterOptions {
  targetRoles: string[];
  cities: string[];
  educationStatuses: string[];
  technologies: string[];
}

/**
 * What a Visitor has narrowed the directory to.
 *
 * Every field is optional and absent means "do not filter". There is no
 * free-text search: the product decided against one, and a filter set built
 * from real published values cannot return the empty page a typo would.
 */
export interface PublicTalentFilters {
  targetRole?: string;
  city?: string;
  educationStatus?: string;
  technologies?: string[];
  hasDemo?: boolean;
  /** A name to search for. The only free-text input on the public surface. */
  search?: string;
}

/** Newest first, or oldest first. There is no third ordering. */
export type PublicTalentSort = 'newest' | 'oldest';
