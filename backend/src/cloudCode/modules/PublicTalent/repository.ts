/**
 * Reading published work, for a caller who is nobody ⟨CP8⟩.
 *
 * ── Every query runs with the master key, and that is the point ─────────────
 * `TalentReelPublication` and `StudentProfile` are closed to every audience —
 * empty CLP, empty ACL. A public endpoint therefore cannot simply "query as the
 * visitor"; there is no such visitor. It reads with the master key and then
 * hands the rows to a builder that copies out named fields.
 *
 * That puts the whole privacy boundary in one place — the DTO — rather than
 * spread across permissions that would have to be relaxed to make this work.
 * Relaxing them would have opened the classes to *authenticated* clients too,
 * which is a much larger hole than the one being filled.
 *
 * ── Publication status is the only visibility rule ──────────────────────────
 * Every query below starts from `status = PUBLISHED`. There is no second path
 * and no flag to forget: a row that is not published is not returned by
 * anything in this file.
 */

import {catchError} from '@90soft/parse-server-kit';

import {PUBLICATION_STATUS} from '../BatchTask/constants';
import {PUBLIC_PAGE} from './constants';

const PUBLICATION_CLASS = 'TalentReelPublication';
const PROFILE_CLASS = 'StudentProfile';
const CATALOG_CLASS = 'ProfileCatalogItem';

export interface DirectoryFilters {
  targetRole?: string;
  city?: string;
  educationStatus?: string;
  technologies?: string[];
  hasDemo?: boolean;
  /** A name to search for. Matched on the profile, case-insensitively. */
  search?: string;
}

/** Newest first by default; oldest is the only alternative. */
export type DirectorySort = 'newest' | 'oldest';

export interface Page {
  skip: number;
  limit: number;
}

/** Clamp a requested page to something the server is willing to build. */
export function boundPage(skip: unknown, limit: unknown): Page {
  const requestedSkip = Number(skip);
  const requestedLimit = Number(limit);
  return {
    skip: Number.isFinite(requestedSkip) && requestedSkip > 0 ? Math.floor(requestedSkip) : 0,
    limit:
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), PUBLIC_PAGE.maxLimit)
        : PUBLIC_PAGE.defaultLimit,
  };
}

/**
 * The base query: published, newest first.
 *
 * Built fresh each time rather than shared, because a Parse query is mutable
 * and a shared one would carry the previous caller's filters.
 */
function publishedQuery(sort: DirectorySort = 'newest'): Parse.Query {
  const query = new Parse.Query(PUBLICATION_CLASS);
  query.equalTo('status', PUBLICATION_STATUS.PUBLISHED);
  query.include('studentProfile');

  /*
    Pinned first, always ⟨CP8C⟩.

    Ahead of the Visitor's own sort, deliberately: an Admin highlighting a
    Student means "show this person first", and a highlight that the oldest-first
    control could push to page four would not be one. It is the only thing that
    outranks the Visitor's choice, and it changes order alone — never who is in
    the list.

    On `pinnedAt` rather than `pinned`; see the field's comment on the model for
    why the Boolean would sort into three groups instead of two.
  */
  query.descending('pinnedAt');
  if (sort === 'oldest') query.addAscending('publishedAt');
  else query.addDescending('publishedAt');
  return query;
}

/**
 * Apply the Visitor's filters.
 *
 * The three profile facets go through `matchesQuery`, which Parse runs as a
 * subquery on the server. The alternative — copying city and role onto the
 * publication when it publishes — would have been one query instead of two, but
 * it would also have gone stale the moment a Student moved city, and nothing
 * re-publishes on a profile edit. A subquery is always current.
 */
function applyFilters(query: Parse.Query, filters: DirectoryFilters): void {
  const profileConditions: {field: string; value: string}[] = [];
  if (filters.targetRole) profileConditions.push({field: 'targetRole', value: filters.targetRole});
  if (filters.city) profileConditions.push({field: 'city', value: filters.city});

  if (profileConditions.length > 0 || filters.educationStatus || filters.search) {
    const profileQuery = new Parse.Query(PROFILE_CLASS);
    for (const condition of profileConditions) {
      const catalog = new Parse.Query(CATALOG_CLASS);
      catalog.equalTo('label', condition.value);
      profileQuery.matchesQuery(condition.field, catalog);
    }
    if (filters.educationStatus) {
      profileQuery.equalTo('educationStatus', filters.educationStatus);
    }
    /*
      Name search, on the profile rather than the publication.

      `matches` with an escaped, case-insensitive pattern rather than
      `Parse.Query.fullText`: full-text needs an index this product does not
      declare, and it would match on word boundaries — somebody typing three
      letters of a name expects a prefix match, not a word.

      The input is escaped because it becomes a regular expression, and an
      unescaped `(` or `+` from a search box is at best an error and at worst a
      pattern that costs the database real time.
    */
    if (filters.search) {
      const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      profileQuery.matches('fullName', new RegExp(escaped, 'i'));
    }
    query.matchesQuery('studentProfile', profileQuery);
  }

  // Technologies live on the publication itself, snapshotted from the work.
  // `containsAll` rather than `containedIn`: picking two technologies means
  // "show me people who know both", which is what a person selecting two boxes
  // expects.
  if (filters.technologies && filters.technologies.length > 0) {
    query.containsAll('technologies', filters.technologies);
  }

  if (filters.hasDemo === true) {
    query.exists('demoVideoId');
    query.notEqualTo('demoVideoId', '');
  }
}

/**
 * One page of published work, newest first.
 *
 * Returns the total as well, because a directory without a count cannot say
 * how many pages there are, and counting client-side would mean sending every
 * row — which is the thing pagination exists to avoid.
 */
export async function findPublishedPage(
  filters: DirectoryFilters,
  page: Page,
  sort: DirectorySort = 'newest'
): Promise<{items: Parse.Object[]; total: number}> {
  const query = publishedQuery(sort);
  applyFilters(query, filters);
  query.skip(page.skip);
  query.limit(page.limit);

  const countQuery = publishedQuery(sort);
  applyFilters(countQuery, filters);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return {items: [], total: 0};

  const [countError, total] = await catchError(countQuery.count({useMasterKey: true}));

  return {
    items: (rows as Parse.Object[]) ?? [],
    total: countError ? ((rows as Parse.Object[]) ?? []).length : (total as number),
  };
}

/**
 * The profile behind a slug, but only if it has something published.
 *
 * An unpublished profile answers exactly like a slug that never existed. A
 * Visitor who guessed a real slug must not be able to tell the difference —
 * "this person exists but is hidden" is itself information about somebody.
 */
export async function findPublishedProfileBySlug(
  slug: unknown
): Promise<{profile: Parse.Object; publications: Parse.Object[]} | undefined> {
  const value = typeof slug === 'string' ? slug.trim() : '';
  if (value.length === 0) return undefined;

  const profileQuery = new Parse.Query(PROFILE_CLASS);
  profileQuery.equalTo('publicProfileSlug', value);

  const [error, profile] = await catchError(profileQuery.first({useMasterKey: true}));
  if (error || !profile) return undefined;

  const publicationQuery = publishedQuery();
  publicationQuery.equalTo('studentProfile', profile as Parse.Object);
  publicationQuery.limit(PUBLIC_PAGE.maxProjectsPerProfile);

  const [publicationError, publications] = await catchError(
    publicationQuery.find({useMasterKey: true})
  );
  if (publicationError) return undefined;

  const rows = (publications as Parse.Object[]) ?? [];
  if (rows.length === 0) return undefined;

  return {profile: profile as Parse.Object, publications: rows};
}

/**
 * The catalog labels for a set of profiles, keyed by catalog item id.
 *
 * One query for the page rather than one per row. The ids never leave this
 * module — they are used to look a label up and are then discarded.
 */
export async function findCatalogLabels(
  profiles: readonly Parse.Object[]
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const profile of profiles) {
    // `institution` and `major` are resolved as well, for the profile page's
    // education block. The directory never asks for them.
    for (const field of ['targetRole', 'city', 'institution', 'major']) {
      const pointer = profile.get(field) as Parse.Object | undefined;
      if (pointer?.id) ids.add(pointer.id);
    }
  }

  const labels = new Map<string, string>();
  if (ids.size === 0) return labels;

  const query = new Parse.Query(CATALOG_CLASS);
  query.containedIn('objectId', [...ids]);
  query.select('label');
  query.limit(ids.size);

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return labels;

  for (const row of (rows as Parse.Object[]) ?? []) {
    labels.set(row.id, String(row.get('label') ?? '').trim());
  }
  return labels;
}

/** The label for one pointer, or undefined when there is none. */
export function labelOf(
  profile: Parse.Object,
  field: 'targetRole' | 'city' | 'institution' | 'major',
  labels: Map<string, string>
): string | undefined {
  const pointer = profile.get(field) as Parse.Object | undefined;
  if (!pointer?.id) return undefined;
  return labels.get(pointer.id) || undefined;
}

/**
 * Every distinct value a Visitor could usefully filter by.
 *
 * Built from what is **actually published**, not from the catalogs: offering a
 * city with nobody in it is offering a filter that returns an empty page, and a
 * Visitor cannot tell that from a broken one.
 */
export async function findFilterOptions(): Promise<{
  targetRoles: string[];
  cities: string[];
  educationStatuses: string[];
  technologies: string[];
}> {
  const query = publishedQuery();
  query.limit(PUBLIC_PAGE.optionScanLimit);
  query.select('technologies', 'studentProfile');

  const [error, rows] = await catchError(query.find({useMasterKey: true}));
  if (error) return {targetRoles: [], cities: [], educationStatuses: [], technologies: []};

  const publications = (rows as Parse.Object[]) ?? [];
  const profiles = publications
    .map(row => row.get('studentProfile') as Parse.Object | undefined)
    .filter((profile): profile is Parse.Object => Boolean(profile));

  const labels = await findCatalogLabels(profiles);

  const roles = new Set<string>();
  const cities = new Set<string>();
  const education = new Set<string>();
  const technologies = new Map<string, string>();

  for (const profile of profiles) {
    const role = labelOf(profile, 'targetRole', labels);
    if (role) roles.add(role);
    const city = labelOf(profile, 'city', labels);
    if (city) cities.add(city);
    const status = String(profile.get('educationStatus') ?? '').trim();
    if (status) education.add(status);
  }

  for (const publication of publications) {
    const items = publication.get('technologies');
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== 'string') continue;
      const text = item.trim();
      if (!text) continue;
      // Case-insensitive, first spelling wins — the same rule the submission
      // form uses, so the filter list matches what people actually typed.
      const key = text.toLowerCase();
      if (!technologies.has(key)) technologies.set(key, text);
    }
  }

  const sorted = (values: Iterable<string>): string[] =>
    [...values].sort((a, b) => a.localeCompare(b));

  return {
    targetRoles: sorted(roles),
    cities: sorted(cities),
    educationStatuses: sorted(education),
    technologies: sorted(technologies.values()),
  };
}

/**
 * The photo bytes for a slug, but only for somebody who is published.
 *
 * Re-checked here rather than trusted from the path that produced the URL: a
 * Visitor can type this address directly, and a Student who withdrew consent
 * between one request and the next must stop having a face on the internet.
 */
export async function findPublishedPhoto(
  slug: unknown
): Promise<{data: string; updatedAt?: Date} | undefined> {
  const found = await findPublishedProfileBySlug(slug);
  if (!found) return undefined;

  const data = String(found.profile.get('photoData') ?? '');
  if (data.length === 0) return undefined;

  const updatedAt = found.profile.get('photoUpdatedAt');
  return {data, updatedAt: updatedAt instanceof Date ? updatedAt : undefined};
}
