/**
 * The public talent surface ⟨CP8⟩.
 *
 * Four endpoints, none of which requires a session:
 *
 *   `listTalentDiscovery`   the directory grid, filtered and paginated
 *   `getTalentProfile`     one profile, by slug
 *   `listTalentReels`       the vertical Talent Reel feed
 *   `getTalentFilters`     the values worth offering as filters
 *
 * ── Unauthenticated does not mean unbounded ─────────────────────────────────
 * Every one is rate-limited and every one paginates server-side. There is no
 * request a Visitor can make here that returns the whole corpus, and no
 * parameter that widens a page beyond `PUBLIC_PAGE.maxLimit`.
 *
 * ── One shape in, one shape out ─────────────────────────────────────────────
 * Filters arrive as named scalars, never as a query object — a public endpoint
 * that accepted a `where` clause would be a public endpoint that accepted a
 * query for anything. Responses are the DTOs in `dto.ts` and nothing else.
 *
 * ── There is no write here ──────────────────────────────────────────────────
 * Nothing on this surface creates, updates, or deletes. A Student changes what
 * the public sees by editing their own Final Task behind their own session;
 * there is no public mutation to reach at all.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {safeLog} from '../../utils/logging/safeLogger';
import {
  PublicFilterOptionsDto,
  PublicPageDto,
  PublicReelItemDto,
  PublicStudentCardDto,
  PublicStudentProfileDto,
  toPublicCard,
  toPublicProfile,
  toPublicReelItem,
} from './dto';
import {
  DirectoryFilters,
  DirectorySort,
  boundPage,
  findCatalogLabels,
  findFilterOptions,
  findPublishedPage,
  findPublishedProfileBySlug,
  labelOf,
} from './repository';

/** A trimmed string, or undefined. Blank filters are absent filters. */
function optionalParam(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : undefined;
}

/**
 * The technologies filter, however the client sent it.
 *
 * Accepts an array or a comma-separated string, because a filter that only
 * worked one of those ways would work from the app and not from a shared link.
 * Bounded, because this becomes a `containsAll`.
 */
function technologyParam(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const items = raw
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0 && item.length <= 50)
    .slice(0, 10);

  return items.length > 0 ? items : undefined;
}

/** Read the filters a Visitor is allowed to send, ignoring anything else. */
function readFilters(params: Record<string, unknown>): DirectoryFilters {
  const filters: DirectoryFilters = {};

  const role = optionalParam(params['targetRole']);
  if (role) filters.targetRole = role;
  const city = optionalParam(params['city']);
  if (city) filters.city = city;
  const education = optionalParam(params['educationStatus']);
  if (education) filters.educationStatus = education;

  const technologies = technologyParam(params['technologies']);
  if (technologies) filters.technologies = technologies;

  // Only `true` narrows. Absent and "false" both mean "do not filter", so a
  // checkbox that is off behaves the same as one that was never rendered.
  if (params['hasDemo'] === true || params['hasDemo'] === 'true') filters.hasDemo = true;

  /*
    The name search ⟨CP8B⟩.

    Bounded at 60 characters and trimmed. It becomes an escaped regular
    expression server-side, so nothing a person types can change the shape of
    the query — but a very long pattern still costs the database time, and this
    endpoint has no session behind it.
  */
  const search = optionalParam(params['search']);
  if (search) filters.search = search.slice(0, 60);

  return filters;
}

/** Newest first unless a Visitor asked otherwise. Anything else is ignored. */
function readSort(params: Record<string, unknown>): DirectorySort {
  return params['sort'] === 'oldest' ? 'oldest' : 'newest';
}

@Route('talent')
class PublicTalentFunctions {
  /**
   * The public directory.
   *
   * One card per **published project**, newest first. A Student with two
   * published Final Tasks appears twice — which is honest: each card is a piece
   * of work, and the profile behind them is the same person either way.
   */
  @CloudFunction({
    methods: ['GET'],
    rateLimit: {windowMs: 60_000, max: 120},
    validation: {requireUser: false},
    swagger: {
      summary: 'List published students',
      description:
        'Public. Paginated, filterable directory of students whose Final Task ' +
        'is published and who consented. No authentication.',
      tags: ['Public'],
      responses: {'200': {description: 'A page of safe student cards'}},
    },
  })
  async listTalentDiscovery(
    req: Parse.Cloud.FunctionRequest
  ): Promise<PublicPageDto<PublicStudentCardDto>> {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const page = boundPage(params['skip'], params['limit']);
    const filters = readFilters(params);

    const {items, total} = await findPublishedPage(filters, page, readSort(params));

    const profiles = items
      .map(row => row.get('studentProfile') as Parse.Object | undefined)
      .filter((profile): profile is Parse.Object => Boolean(profile));
    const labels = await findCatalogLabels(profiles);

    const cards: PublicStudentCardDto[] = [];
    for (const publication of items) {
      const profile = publication.get('studentProfile') as Parse.Object | undefined;
      // A publication whose profile went missing has nobody to attribute it to,
      // so it is dropped rather than rendered anonymously.
      if (!profile || !profile.get('publicProfileSlug')) continue;
      cards.push(
        toPublicCard(publication, profile, {
          targetRole: labelOf(profile, 'targetRole', labels),
          city: labelOf(profile, 'city', labels),
        })
      );
    }

    safeLog.info('Public directory listed', {
      op: 'listTalentDiscovery',
      ok: true,
      count: cards.length,
    });

    return {items: cards, total, skip: page.skip, limit: page.limit};
  }

  /**
   * One public profile.
   *
   * A slug with nothing published answers exactly like a slug that never
   * existed. That is deliberate: distinguishing them would tell a Visitor who
   * guessed a real slug that somebody is there but hidden, which is information
   * about a person who asked not to be shown.
   */
  @CloudFunction({
    methods: ['GET'],
    rateLimit: {windowMs: 60_000, max: 120},
    validation: {requireUser: false, fields: {slug: {required: true, type: String}}},
    swagger: {
      summary: 'Get a public student profile',
      description: 'Public. Returns 404-equivalent for an unpublished or unknown slug.',
      tags: ['Public'],
      responses: {
        '200': {description: 'A safe public profile'},
        '404': {description: 'No such published profile'},
      },
    },
  })
  async getTalentProfile(req: Parse.Cloud.FunctionRequest): Promise<PublicStudentProfileDto> {
    const params = (req.params ?? {}) as Record<string, unknown>;

    const found = await findPublishedProfileBySlug(params['slug']);
    if (!found) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'PUBLIC_PROFILE_NOT_FOUND');
    }

    const labels = await findCatalogLabels([found.profile]);

    safeLog.info('Public profile read', {
      op: 'getTalentProfile',
      ok: true,
      count: found.publications.length,
    });

    return toPublicProfile(found.profile, found.publications, {
      targetRole: labelOf(found.profile, 'targetRole', labels),
      city: labelOf(found.profile, 'city', labels),
      educationStatus: String(found.profile.get('educationStatus') ?? '').trim() || undefined,
      // A Student may name an institution outside the catalog, in which case
      // the free-text one is what they wrote and is what should be shown.
      institution:
        labelOf(found.profile, 'institution', labels) ||
        String(found.profile.get('customInstitutionName') ?? '').trim() ||
        undefined,
      major: labelOf(found.profile, 'major', labels),
    });
  }

  /**
   * The Talent Reel feed.
   *
   * The same published rows as the directory, in the same order, carrying only
   * what one full-screen item shows. It is a separate endpoint rather than a
   * flag on the directory because the two return different shapes, and a single
   * endpoint that returned either would be one an caller could get wrong.
   */
  @CloudFunction({
    methods: ['GET'],
    rateLimit: {windowMs: 60_000, max: 120},
    validation: {requireUser: false},
    swagger: {
      summary: 'List the public Talent Reel',
      description:
        'Public. A page of full-screen reel items, newest first. Paginated so a ' +
        'client can load as it scrolls rather than preloading everything.',
      tags: ['Public'],
      responses: {'200': {description: 'A page of safe reel items'}},
    },
  })
  async listTalentReels(
    req: Parse.Cloud.FunctionRequest
  ): Promise<PublicPageDto<PublicReelItemDto>> {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const page = boundPage(params['skip'], params['limit']);
    const filters = readFilters(params);

    const {items, total} = await findPublishedPage(filters, page);

    const profiles = items
      .map(row => row.get('studentProfile') as Parse.Object | undefined)
      .filter((profile): profile is Parse.Object => Boolean(profile));
    const labels = await findCatalogLabels(profiles);

    const reel: PublicReelItemDto[] = [];
    for (const publication of items) {
      const profile = publication.get('studentProfile') as Parse.Object | undefined;
      if (!profile || !profile.get('publicProfileSlug')) continue;
      reel.push(
        toPublicReelItem(publication, profile, {
          targetRole: labelOf(profile, 'targetRole', labels),
          city: labelOf(profile, 'city', labels),
        })
      );
    }

    safeLog.info('Public reel listed', {op: 'listTalentReels', ok: true, count: reel.length});

    return {items: reel, total, skip: page.skip, limit: page.limit};
  }

  /**
   * The filter values worth offering.
   *
   * Built from published rows, so every option returns at least one result. A
   * dropdown offering a city with nobody in it is a dropdown that looks broken
   * the first time somebody picks it.
   */
  @CloudFunction({
    methods: ['GET'],
    rateLimit: {windowMs: 60_000, max: 60},
    validation: {requireUser: false},
    swagger: {
      summary: 'List public filter options',
      description: 'Public. Distinct roles, cities, education statuses, and technologies.',
      tags: ['Public'],
      responses: {'200': {description: 'Filter option lists'}},
    },
  })
  async getTalentFilters(): Promise<PublicFilterOptionsDto> {
    const [error, options] = await catchError(findFilterOptions());
    if (error || !options) {
      return {targetRoles: [], cities: [], educationStatuses: [], technologies: []};
    }
    return options;
  }
}

export {PublicTalentFunctions};
