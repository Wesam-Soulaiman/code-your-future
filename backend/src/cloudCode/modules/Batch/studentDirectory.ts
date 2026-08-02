/**
 * The Admin Student directory.
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 * A **directory**: an Admin can find a Student and read what the product knows
 * about them. It is not User Management. There is no create, no edit, no
 * delete, no role assignment, no password reset, and no impersonation — not
 * hidden behind a permission, but **absent**, so there is no endpoint to reach
 * for and nothing to accidentally expose later.
 *
 * ── Every Student, including the ones with nothing yet ──────────────────────
 * The list is driven by `StudentProfile`, not by enrollment, so a Student who
 * has joined no Batch is as visible as one who has joined three. That is the
 * point of the page: the people who signed up and have not been placed anywhere
 * are exactly the ones an Admin needs to find.
 *
 * A Student who has signed in but not yet saved a profile has no row here; the
 * count of those is reported separately so an Admin can see they exist without
 * the list filling with blanks.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {requireAdmin} from '../../utils/auth/authorize';
import {BATCH_PAGE} from './constants';
import {BatchError, FieldReason, batchError, isBatchSurfaceErrorCode} from './errors';
import {batchLog} from './logging';
import {
  findBatchById,
  findEnrollmentsForStudents,
  findStudentIdsInBatch,
  pointerTo,
} from './repository';
import {
  AdminStudentSummaryDto,
  FORBIDDEN_STUDENT_SUMMARY_KEYS,
  toStudentSummary,
} from './studentSummary';
import {toStudentBatchDto} from './dto';
import {normaliseBatchSearch, normalisePaging} from './validation';

function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (typeof message === 'string') {
    const [code] = message.split(':');
    if (isBatchSurfaceErrorCode(code)) return error as Parse.Error;
  }
  return batchError(BatchError.BATCH_SAVE_FAILED);
}

/** The four catalog pointers the directory resolves and filters on. */
const CATALOG_FILTERS = ['city', 'institution', 'major', 'targetRole'] as const;
type CatalogFilter = (typeof CATALOG_FILTERS)[number];

@Route('student-directory')
class StudentDirectoryFunctions {
  /**
   * A page of Students.
   *
   * Filtering happens in the query wherever the database can do it — the
   * catalog pointers and the completion flag are indexed columns, so those
   * narrow the result set before it is read. The Batch filter resolves to a set
   * of Student ids first, because membership lives on a different class.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'List Students',
      description:
        'Every Student with a profile, including those in no Batch. Read-only ' +
        'summaries. Admins only.',
      tags: ['Students'],
      responses: {
        '200': {description: 'Safe Student summaries and a total'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not an Admin'},
      },
    },
  })
  async listStudents(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'listStudents');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const search = normaliseBatchSearch(params['search']);
    const {skip, limit} = normalisePaging(params);

    /** Build the base query fresh each time, so the count matches the page. */
    const build = (): Parse.Query => {
      const query = new Parse.Query('StudentProfile');

      if (search.length > 0) {
        // Escaped before it reaches a pattern: a search term is something a
        // person typed, and un-escaped it turns a search box into a way to
        // spend the database's CPU.
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const byName = new Parse.Query('StudentProfile');
        byName.matches('fullName', new RegExp(escaped), 'i');
        const byEmail = new Parse.Query('StudentProfile');
        byEmail.matches('verifiedEmail', new RegExp(escaped), 'i');
        return Parse.Query.or(byName, byEmail);
      }
      return query;
    };

    const applyFilters = (query: Parse.Query): Parse.Query => {
      for (const field of CATALOG_FILTERS) {
        const value = params[`${field}Id`];
        if (typeof value === 'string' && value.trim().length > 0) {
          query.equalTo(field, pointerTo('ProfileCatalogItem', value.trim()));
        }
      }

      const completion = params['profileComplete'];
      if (completion === true || completion === 'true') query.equalTo('isComplete', true);
      if (completion === false || completion === 'false') query.notEqualTo('isComplete', true);

      return query;
    };

    // The Batch filter has to become a set of Student ids, because membership
    // lives on BatchEnrollment rather than on the profile.
    let batchStudentIds: string[] | undefined;
    const batchId = params['batchId'];
    if (typeof batchId === 'string' && batchId.trim().length > 0) {
      const batch = await findBatchById(batchId.trim());
      if (!batch) {
        throw batchError(BatchError.BATCH_VALIDATION_FAILED, {
          batchId: FieldReason.NOT_ALLOWED,
        });
      }
      batchStudentIds = await findStudentIdsInBatch(batch.id as string);
      // Nobody has joined, so nobody matches. Answer without a query.
      if (batchStudentIds.length === 0) {
        return {items: [], total: 0, skip, limit};
      }
    }

    const withBatch = (query: Parse.Query): Parse.Query => {
      if (batchStudentIds) {
        query.containedIn(
          'user',
          batchStudentIds.map(id => pointerTo('_User', id))
        );
      }
      return query;
    };

    const listQuery = withBatch(applyFilters(build()));
    for (const field of CATALOG_FILTERS) listQuery.include(field);
    listQuery.ascending('fullName');
    listQuery.skip(skip);
    listQuery.limit(Math.min(limit, BATCH_PAGE.maxLimit));

    const countQuery = withBatch(applyFilters(build()));

    const [error, results] = await catchError(
      Promise.all([
        listQuery.find({useMasterKey: true}),
        countQuery.count({useMasterKey: true}),
      ])
    );
    if (error || !results) throw toClientError(error);

    const [profiles, total] = results as [Parse.Object[], number];

    const studentIds = profiles
      .map(profile => (profile.get('user') as Parse.Object | undefined)?.id)
      .filter((id): id is string => typeof id === 'string');

    const batchesByStudent = await findEnrollmentsForStudents(studentIds);

    const items: AdminStudentSummaryDto[] = profiles
      .map(profile => {
        const id = (profile.get('user') as Parse.Object | undefined)?.id;
        if (!id) return undefined;
        return toStudentSummary(id, profile, {
          batchCount: (batchesByStudent.get(id) ?? []).length,
        });
      })
      .filter((item): item is AdminStudentSummaryDto => item !== undefined);

    batchLog.info('Student directory listed', {
      op: 'listStudents',
      stage: 'load',
      ok: true,
      userId: admin.id,
      // A count, never the filters: a filter value can be a Student's name.
      count: items.length,
    });

    return {items, total, skip, limit};
  }

  /**
   * One Student, read-only.
   *
   * Returns the same allow-listed summary the list uses, plus the Batches they
   * belong to. There is no write counterpart to this operation anywhere.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {studentId: {required: true, type: String}}},
    swagger: {
      summary: 'Get one Student',
      description:
        'A read-only Student summary and their Batch memberships. Admins only. ' +
        'There is no operation to create, edit, or delete a Student.',
      tags: ['Students'],
      responses: {
        '200': {description: 'Safe Student summary'},
        '403': {description: 'Not an Admin'},
        '404': {description: 'No such Student'},
      },
    },
  })
  async getStudent(req: Parse.Cloud.FunctionRequest) {
    const admin = await requireAdmin(req, 'getStudent');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const studentId = String(params['studentId'] ?? '').trim();
    if (studentId.length === 0) throw batchError(BatchError.BATCH_NOT_FOUND);

    const query = new Parse.Query('StudentProfile');
    query.equalTo('user', pointerTo('_User', studentId));
    for (const field of CATALOG_FILTERS) query.include(field);

    const [error, profile] = await catchError(query.first({useMasterKey: true}));
    if (error) throw toClientError(error);
    if (!profile) throw batchError(BatchError.BATCH_NOT_FOUND);

    const memberships = await findEnrollmentsForStudents([studentId]);
    const batchIds = memberships.get(studentId) ?? [];

    const batches = [];
    for (const batchId of batchIds) {
      const batch = await findBatchById(batchId);
      if (batch) batches.push(toStudentBatchDto(batch));
    }

    batchLog.info('Student read', {
      op: 'getStudent',
      stage: 'load',
      ok: true,
      userId: admin.id,
      count: batches.length,
    });

    return {
      student: toStudentSummary(studentId, profile as Parse.Object, {
        batchCount: batchIds.length,
      }),
      batches,
    };
  }
}

export default StudentDirectoryFunctions;
export {FORBIDDEN_STUDENT_SUMMARY_KEYS};
