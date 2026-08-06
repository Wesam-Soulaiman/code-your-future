/**
 * What a stranger is allowed to see ⟨CP8⟩.
 *
 * ── These are the only shapes that leave the server unauthenticated ─────────
 * Every public endpoint returns one of the interfaces below and nothing else.
 * They are hand-built allow-lists: a field appears here because somebody decided
 * a Visitor may read it, not because it happened to be on the row.
 *
 * That matters more here than anywhere else in the product. Every other surface
 * is behind a session and a role; this one is behind nothing at all. A field
 * that leaks from an Admin endpoint leaks to an Admin. A field that leaks from
 * here leaks to the internet.
 *
 * ── What is deliberately absent, and why ────────────────────────────────────
 * No email, phone, or date of birth — a Student consented to showing their
 * work, not to being contactable. No institution, major, or expected graduation
 * date. No Batch, invitation, or enrollment: which cohort somebody was in is
 * how you work out where they were and when, and it is nobody's business. No
 * Live Slides answers, no Assignments, no private submission fields — the
 * Drive link and the note to staff are private by construction and stay that
 * way. No storage keys. No `objectId`, no Parse pointer, no `__type`, no ACL.
 *
 * The only identifier that crosses this boundary is the slug, which exists
 * precisely so that no internal one has to.
 */

import {embedUrlFor} from '../BatchTask/urls';

/**
 * One card in the public directory.
 *
 * Deliberately smaller than the profile: a grid of thirty of these should not
 * carry thirty project descriptions across the wire, and a card that showed
 * everything would make the profile page pointless.
 */
export interface PublicStudentCardDto {
  /** The stable public identifier. The only id a Visitor ever sees. */
  slug: string;
  name: string;
  targetRole?: string;
  city?: string;
  /** Present only when the Student has a photo. Never the bytes. */
  photoUrl?: string;
  technologies: string[];
  /** Whether they added a titled demo video, which drives the badge and filter. */
  hasDemo: boolean;
  /**
   * Whether an Admin highlighted this ⟨CP8C⟩, so a client can mark it.
   *
   * The whole of what the pin exposes. `pinnedAt`, who pinned it, and the sort
   * key stay server-side: a Visitor learning *when* somebody was highlighted
   * would be reading an Admin's activity, which is none of their business, and
   * the ordering is already visible in the order.
   */
  pinned: boolean;
}

/** The embedded video on a public page. Built here, never from user input. */
export interface PublicVideoDto {
  /** The eleven-character id. Kept so a client can build its own link if needed. */
  videoId: string;
  /** `https://www.youtube.com/embed/{id}` — always constructed server-side. */
  embedUrl: string;
  /** `https://www.youtube.com/watch?v={id}` — for opening in a new tab. */
  watchUrl: string;
}

/** One published project on a public profile. */
export interface PublicProjectDto {
  /** The demo title when the Student gave one, else the project title. */
  title: string;
  description: string;
  contribution: string;
  technologies: string[];
  video: PublicVideoDto;
  /** Whether the video shown is their titled demo rather than the project video. */
  isDemo: boolean;
  githubUrl?: string;
  liveDemoUrl?: string;
  publishedAt?: string;
}

/**
 * What a Student studied, when they chose to say.
 *
 * Assembled from the profile's own education fields rather than invented: this
 * product stores an institution and a major, and that is what this carries.
 * Both are optional, and the block is omitted entirely when neither is filled
 * in — an empty "Education" heading says less than no heading at all.
 *
 * The education *status* is not repeated here. It is already a top-level field
 * on the profile, rendered beside the role and the city, and carrying it twice
 * would mean two places that could disagree.
 */
export interface PublicEducationDto {
  institution?: string;
  major?: string;
}

/** A whole public profile. */
export interface PublicStudentProfileDto {
  slug: string;
  name: string;
  targetRole?: string;
  city?: string;
  educationStatus?: string;
  /** The Student's own words about what they are aiming for. */
  about?: string;
  photoUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  /** Every technology across their published work, deduplicated. */
  technologies: string[];
  education?: PublicEducationDto;
  projects: PublicProjectDto[];
}

/** One screen of the vertical Talent Reel. */
export interface PublicReelItemDto {
  slug: string;
  name: string;
  targetRole?: string;
  city?: string;
  photoUrl?: string;
  title: string;
  technologies: string[];
  video: PublicVideoDto;
  /**
   * Whether an Admin highlighted this ⟨CP8C⟩, so a client can mark it.
   *
   * The whole of what the pin exposes. `pinnedAt`, who pinned it, and the sort
   * key stay server-side: a Visitor learning *when* somebody was highlighted
   * would be reading an Admin's activity, which is none of their business, and
   * the ordering is already visible in the order.
   */
  pinned: boolean;
}

/** A page of results. Server-side, always. */
export interface PublicPageDto<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

/** The values a Visitor may filter by, built from what is actually published. */
export interface PublicFilterOptionsDto {
  targetRoles: string[];
  cities: string[];
  educationStatuses: string[];
  technologies: string[];
}

/**
 * Keys that must never appear in a public response.
 *
 * Asserted by a test against real DTOs, so this is a check rather than a
 * comment. Several of these could only arrive by somebody returning a Parse
 * object directly — which is exactly the mistake worth catching.
 */
export const FORBIDDEN_PUBLIC_KEYS: readonly string[] = [
  'objectId',
  'id',
  '__type',
  'className',
  'ACL',
  'acl',
  'createdAt',
  'updatedAt',
  'user',
  'student',
  'studentProfile',
  'submission',
  'task',
  'batch',
  'verifiedEmail',
  'email',
  'phone',
  'dateOfBirth',
  // `institution` and `major` are **not** here: CP8B publishes an education
  // block, so those two became public information by decision. What stays
  // private is the free-text institution a Student typed instead of picking one
  // — and the date they expect to graduate, which is a fact about somebody's
  // near future that a stranger has no reason to hold.
  'customInstitutionName',
  'expectedGraduationDate',
  'targetRoleReason',
  // `pinned` is **not** here — CP8C publishes that one Boolean so a client can
  // mark a highlight. `pinnedAt` is: when an Admin pinned somebody is a record
  // of staff activity, and it is also the public sort key, which is not a thing
  // a Visitor should be able to read off the response and reason about.
  'pinnedAt',
  'photoData',
  'studentNote',
  'googleDriveUrl',
  'youtubeVideoId',
  'storageKey',
  'attachmentStorageKey',
  'adminSuppressed',
  'publicationSource',
  'unpublishedBy',
  'publicConsent',
  'publicConsentAt',
  'hasEverBeenSubmitted',
  'status',
  'isComplete',
];

// ═══════════════════════════════════════════════════════════════════════════
// Builders
// ═══════════════════════════════════════════════════════════════════════════

function optionalString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/**
 * The public photo address for a slug.
 *
 * A path, not bytes. The photo is base64 on a private column, and putting it in
 * a directory response would mean a grid of thirty faces arriving as one
 * enormous JSON body. The route it points at serves the bytes and re-checks
 * publication itself, so this string grants nothing on its own.
 */
export function publicPhotoPath(slug: string, updatedAt: unknown): string {
  const version = updatedAt instanceof Date ? updatedAt.getTime() : 0;
  return `/talent/photo/${encodeURIComponent(slug)}?v=${version}`;
}

/** The video block for one stored id. Both URLs are constructed, never stored. */
export function toPublicVideo(videoId: string): PublicVideoDto {
  return {
    videoId,
    embedUrl: embedUrlFor(videoId),
    watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}

/** A directory card, from a publication and the profile it belongs to. */
export function toPublicCard(
  publication: Parse.Object,
  profile: Parse.Object,
  names: {targetRole?: string; city?: string}
): PublicStudentCardDto {
  const slug = String(profile.get('publicProfileSlug') ?? '');
  const card: PublicStudentCardDto = {
    slug,
    name: String(profile.get('fullName') ?? '').trim(),
    technologies: stringArray(publication.get('technologies')),
    hasDemo: String(publication.get('demoVideoId') ?? '').trim().length > 0,
    pinned: publication.get('pinned') === true,
  };

  const role = optionalString(names.targetRole);
  if (role) card.targetRole = role;
  const city = optionalString(names.city);
  if (city) card.city = city;
  if (profile.get('photoData')) {
    card.photoUrl = publicPhotoPath(slug, profile.get('photoUpdatedAt'));
  }

  return card;
}

/** One project block on a profile. */
export function toPublicProject(publication: Parse.Object): PublicProjectDto {
  const demoTitle = String(publication.get('demoTitle') ?? '').trim();
  const demoVideo = String(publication.get('demoVideoId') ?? '').trim();
  const reelVideo =
    String(publication.get('reelVideoId') ?? '').trim() ||
    String(publication.get('youtubeVideoId') ?? '').trim();

  const project: PublicProjectDto = {
    // The demo title wins when there is one — it is what the Student wrote for
    // this video specifically. Otherwise the project title stands in, so a
    // page never renders a heading-shaped hole.
    title: demoTitle || String(publication.get('projectTitle') ?? '').trim(),
    description: String(publication.get('projectDescription') ?? '').trim(),
    contribution: String(publication.get('contribution') ?? '').trim(),
    technologies: stringArray(publication.get('technologies')),
    video: toPublicVideo(reelVideo),
    isDemo: demoVideo.length > 0,
  };

  const github = optionalString(publication.get('githubUrl'));
  if (github) project.githubUrl = github;
  const live = optionalString(publication.get('liveDemoUrl'));
  if (live) project.liveDemoUrl = live;

  const published = publication.get('publishedAt');
  if (published instanceof Date) project.publishedAt = published.toISOString();

  return project;
}

/** A whole profile, from its publications. */
export function toPublicProfile(
  profile: Parse.Object,
  publications: readonly Parse.Object[],
  names: {
    targetRole?: string;
    city?: string;
    educationStatus?: string;
    institution?: string;
    major?: string;
  }
): PublicStudentProfileDto {
  const slug = String(profile.get('publicProfileSlug') ?? '');

  // One technology list across everything they have published, in first-seen
  // order and deduplicated case-insensitively — the same rule the submission
  // form applies, so the public page cannot disagree with the private one.
  const technologies: string[] = [];
  const seen = new Set<string>();
  for (const publication of publications) {
    for (const item of stringArray(publication.get('technologies'))) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      technologies.push(item);
    }
  }

  const dto: PublicStudentProfileDto = {
    slug,
    name: String(profile.get('fullName') ?? '').trim(),
    technologies,
    projects: publications.map(toPublicProject),
  };

  const role = optionalString(names.targetRole);
  if (role) dto.targetRole = role;
  const city = optionalString(names.city);
  if (city) dto.city = city;
  const education = optionalString(names.educationStatus);
  if (education) dto.educationStatus = education;

  // `careerGoal` is the Student's own answer to what they are working towards.
  // It is the only free text on the profile that is theirs to publish.
  const about = optionalString(profile.get('careerGoal'));
  if (about) dto.about = about;

  for (const field of ['githubUrl', 'linkedinUrl', 'portfolioUrl'] as const) {
    const value = optionalString(profile.get(field));
    if (value) dto[field] = value;
  }

  if (profile.get('photoData')) {
    dto.photoUrl = publicPhotoPath(slug, profile.get('photoUpdatedAt'));
  }

  /*
    Education, built only from what the Student actually filled in ⟨CP8B⟩.

    The institution and major are catalog labels resolved by the caller; the
    status is the stored phrase. The block is omitted entirely when none of the
    three exists, because an empty "Education" heading tells a reader less than
    no heading at all.

    Note what is **not** here: `expectedGraduationDate`. A date somebody will
    finish studying is a fact about their near future that a stranger has no
    reason to hold, and it is on the forbidden-key list for that reason.
  */
  const institution = optionalString(names.institution);
  const major = optionalString(names.major);
  if (institution || major) {
    dto.education = {};
    if (institution) dto.education.institution = institution;
    if (major) dto.education.major = major;
  }

  return dto;
}

/** One screen of the Reel. */
export function toPublicReelItem(
  publication: Parse.Object,
  profile: Parse.Object,
  names: {targetRole?: string; city?: string}
): PublicReelItemDto {
  const demoTitle = String(publication.get('demoTitle') ?? '').trim();
  const reelVideo =
    String(publication.get('reelVideoId') ?? '').trim() ||
    String(publication.get('youtubeVideoId') ?? '').trim();

  const item: PublicReelItemDto = {
    slug: String(profile.get('publicProfileSlug') ?? ''),
    name: String(profile.get('fullName') ?? '').trim(),
    title: demoTitle || String(publication.get('projectTitle') ?? '').trim(),
    technologies: stringArray(publication.get('technologies')),
    video: toPublicVideo(reelVideo),
    pinned: publication.get('pinned') === true,
  };

  const role = optionalString(names.targetRole);
  if (role) item.targetRole = role;
  const city = optionalString(names.city);
  if (city) item.city = city;
  if (profile.get('photoData')) {
    item.photoUrl = publicPhotoPath(item.slug, profile.get('photoUpdatedAt'));
  }

  return item;
}
