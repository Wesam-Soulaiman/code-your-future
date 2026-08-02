/**
 * Joining a Batch — the public preview, redemption, and a Student's own reads.
 *
 * Two surfaces, because two audiences:
 *
 *   `/api/join`             — **public**. One operation, `previewInvitation`,
 *                             callable by somebody who has proved nothing.
 *   `/api/student-batches`  — a signed-in Student's own memberships.
 *
 * ── Why preview is a POST ───────────────────────────────────────────────────
 * The token travels in the body, not the query string. A GET would put it in
 * the URL, and URLs end up in access logs, proxy logs, and browser history —
 * which is exactly where a join token must never be. The same reasoning applies
 * to redemption.
 *
 * ── An invitation is required only to *join* ────────────────────────────────
 * Nothing here gates sign-in, account creation, or completing a profile. A
 * Student can do all of that with no invitation at all; the token is asked for
 * at the moment of joining a Batch and at no other point.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {AppRole} from '../../utils/constants/roles';
import {getAppRoles, requireUser} from '../../utils/auth/authorize';
import {isProfileComplete} from '../StudentProfile/completion';
import {acceptsEnrollment} from './constants';
import {toInvitationPreviewDto, toStudentBatchDto} from './dto';
import {
  BatchError,
  EnrollmentError,
  InvitationError,
  batchError,
  isBatchSurfaceErrorCode,
} from './errors';
import {resolveInvitationToken} from './invitationService';
import {batchLog} from './logging';
import {
  createEnrollment,
  findBatchById,
  findEnrollment,
  findEnrollmentsForStudent,
  isDuplicateKeyError,
} from './repository';

function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (typeof message === 'string') {
    const [code] = message.split(':');
    if (isBatchSurfaceErrorCode(code)) return error as Parse.Error;
  }
  return batchError(BatchError.BATCH_SAVE_FAILED);
}

/**
 * Require a live Student.
 *
 * An Admin is refused rather than quietly enrolled: Batches are something
 * Students belong to, and an Admin holding a join link is a person who opened
 * the wrong thing, not a member.
 */
async function requireStudentUser(
  req: Parse.Cloud.FunctionRequest,
  op: string
): Promise<Parse.User> {
  const user = requireUser(req);
  const roles = await getAppRoles(user);

  if (!roles.includes(AppRole.STUDENT)) {
    batchLog.warn('Enrollment operation refused for a non-Student', {
      op,
      stage: 'authorize',
      ok: false,
      userId: user.id,
      code: EnrollmentError.NOT_A_STUDENT,
    });
    throw batchError(EnrollmentError.NOT_A_STUDENT);
  }

  return user;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public
// ═══════════════════════════════════════════════════════════════════════════

@Route('join')
class InvitationPublicFunctions {
  /**
   * What a link is worth, before anybody signs in.
   *
   * Answers with the smallest useful shape: whether joining is possible, why
   * not when it is not, and — only when the token actually resolved — the
   * Batch's name and dates so the person can recognise what they were invited
   * to.
   *
   * A failing preview carries **no Batch at all**, so somebody feeding random
   * strings to this endpoint cannot harvest Batch names. Unknown and malformed
   * tokens produce the same answer, so they cannot learn which strings were
   * ever real either.
   */
  @CloudFunction({
    methods: ['POST'],
    rateLimit: {windowMs: 60_000, max: 30},
    validation: {requireUser: false, fields: {token: {required: true, type: String}}},
    swagger: {
      summary: 'Preview an invitation',
      description:
        'Public. Returns whether a join link is usable and, when it is valid, ' +
        'the Batch name and dates. Never a Student, a count, or an id.',
      tags: ['Batch'],
      responses: {'200': {description: 'Safe preview DTO'}},
    },
  })
  async previewInvitation(req: Parse.Cloud.FunctionRequest) {
    const params = (req.params ?? {}) as Record<string, unknown>;

    const [error, resolved] = await catchError(resolveInvitationToken(params['token']));
    if (error || !resolved) throw toClientError(error);

    // Logged by outcome only. The token never appears, and neither does the
    // Batch when the token did not resolve.
    batchLog.info('Invitation previewed', {
      op: 'previewInvitation',
      stage: 'redeem',
      ok: resolved.usable,
      batchId: resolved.batch?.id,
      code: resolved.reason,
    });

    return toInvitationPreviewDto(
      resolved.usable ? resolved.batch : undefined,
      resolved.usable,
      resolved.reason
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Student
// ═══════════════════════════════════════════════════════════════════════════

@Route('student-batches')
class StudentBatchFunctions {
  /**
   * Redeem an invitation.
   *
   * The Student comes from the **session**, never from the request: there is no
   * `studentId` parameter and no way to add one, so this operation cannot be
   * pointed at anybody else.
   *
   * ── Idempotent by construction ──────────────────────────────────────────
   * A unique index on `(batch, student)` decides who wins. A second tap, a
   * double-submitted form, or two devices racing all end with one row: the
   * loser's write fails on the index, and we re-read the winner and report the
   * Student is already enrolled. An "are they already in?" check could not do
   * that — both racers would pass it before either wrote.
   */
  @CloudFunction({
    methods: ['POST'],
    rateLimit: {windowMs: 60_000, max: 20},
    validation: {requireUser: true, fields: {token: {required: true, type: String}}},
    swagger: {
      summary: 'Join a Batch with an invitation',
      description:
        'Redeems a join link for the authenticated Student. Idempotent: a ' +
        'repeat returns the existing membership.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Joined, or already a member'},
        '403': {description: 'Not a Student, profile incomplete, or Batch not active'},
      },
    },
  })
  async joinBatchWithInvitation(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudentUser(req, 'joinBatchWithInvitation');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const [resolveError, resolved] = await catchError(resolveInvitationToken(params['token']));
    if (resolveError || !resolved) throw toClientError(resolveError);

    if (!resolved.usable || !resolved.batch) {
      batchLog.warn('Invitation refused at redemption', {
        op: 'joinBatchWithInvitation',
        stage: 'redeem',
        ok: false,
        userId: student.id,
        batchId: resolved.batch?.id,
        code: resolved.reason ?? InvitationError.INVITATION_INVALID,
      });
      throw batchError(
        (resolved.reason ?? InvitationError.INVITATION_INVALID) as never
      );
    }

    const batch = resolved.batch;

    // Re-checked here as well as in `resolveInvitationToken`: the two reads are
    // separated by time, and a Batch could have been completed in between.
    if (!acceptsEnrollment(batch.get('status'))) {
      throw batchError(EnrollmentError.BATCH_NOT_ACTIVE);
    }

    // A Batch is a cohort of people the product knows something about. Joining
    // before finishing a profile would create a membership with nothing behind
    // it, so the form comes first — and the join page says so rather than
    // failing silently.
    const complete = await isProfileComplete(student, [AppRole.STUDENT]);
    if (complete !== true) {
      batchLog.warn('Enrollment refused: the profile is not complete', {
        op: 'joinBatchWithInvitation',
        stage: 'enroll',
        ok: false,
        userId: student.id,
        batchId: batch.id,
        code: EnrollmentError.PROFILE_INCOMPLETE,
      });
      throw batchError(EnrollmentError.PROFILE_INCOMPLETE);
    }

    const alreadyIn = await findEnrollment(batch.id as string, student);
    if (alreadyIn) {
      return {
        alreadyEnrolled: true,
        batch: toStudentBatchDto(batch, alreadyIn.get('joinedAt') as Date | undefined),
      };
    }

    const [createError, enrollment] = await catchError(
      createEnrollment(batch, student, resolved.invitation)
    );

    if (createError || !enrollment) {
      if (isDuplicateKeyError(createError)) {
        // Another request enrolled this Student while we were working. The
        // outcome they wanted has happened; reporting a failure would be
        // wrong, so re-read the winner and answer with it.
        const winner = await findEnrollment(batch.id as string, student);
        if (winner) {
          batchLog.info('Concurrent redemption resolved to the existing membership', {
            op: 'joinBatchWithInvitation',
            stage: 'enroll',
            ok: true,
            userId: student.id,
            batchId: batch.id,
            enrollmentId: winner.id,
            code: EnrollmentError.ALREADY_ENROLLED,
          });
          return {
            alreadyEnrolled: true,
            batch: toStudentBatchDto(batch, winner.get('joinedAt') as Date | undefined),
          };
        }
      }
      batchLog.error('Enrollment failed', {
        op: 'joinBatchWithInvitation',
        stage: 'enroll',
        ok: false,
        userId: student.id,
        batchId: batch.id,
        code: EnrollmentError.ENROLLMENT_FAILED,
      });
      throw batchError(EnrollmentError.ENROLLMENT_FAILED);
    }

    const created = enrollment as Parse.Object;

    batchLog.info('Student joined a Batch', {
      op: 'joinBatchWithInvitation',
      stage: 'complete',
      ok: true,
      userId: student.id,
      batchId: batch.id,
      enrollmentId: created.id,
    });

    return {
      alreadyEnrolled: false,
      batch: toStudentBatchDto(batch, created.get('joinedAt') as Date | undefined),
    };
  }

  /**
   * The Batches this Student belongs to.
   *
   * Resolved from the session, so there is no id to substitute and no way to
   * ask for anybody else's memberships.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'List my Batches',
      description: "The authenticated Student's own memberships. Students only.",
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe Batch DTOs'},
        '403': {description: 'Not a Student'},
      },
    },
  })
  async listMyBatches(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudentUser(req, 'listMyBatches');

    const [error, enrollments] = await catchError(findEnrollmentsForStudent(student));
    if (error || !enrollments) throw toClientError(error);

    const items = (enrollments as Parse.Object[])
      .map(enrollment => {
        const batch = enrollment.get('batch') as Parse.Object | undefined;
        if (!batch || batch.get('name') === undefined) return undefined;
        return toStudentBatchDto(batch, enrollment.get('joinedAt') as Date | undefined);
      })
      .filter((dto): dto is NonNullable<typeof dto> => dto !== undefined);

    batchLog.info('Student Batches listed', {
      op: 'listMyBatches',
      stage: 'load',
      ok: true,
      userId: student.id,
      count: items.length,
    });

    return {items};
  }

  /**
   * One Batch this Student belongs to.
   *
   * Membership is checked first and the answer for "no membership" is the same
   * as for "no such Batch" — a Student must not be able to probe which Batch
   * ids exist by watching the error change.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true, fields: {batchId: {required: true, type: String}}},
    swagger: {
      summary: 'Get one of my Batches',
      description:
        'A Batch the authenticated Student belongs to. No roster, no counts, ' +
        'no administrative detail.',
      tags: ['Batch'],
      responses: {
        '200': {description: 'Safe Batch DTO'},
        '403': {description: 'Not a Student'},
        '404': {description: 'Not a member, or no such Batch'},
      },
    },
  })
  async getMyBatch(req: Parse.Cloud.FunctionRequest) {
    const student = await requireStudentUser(req, 'getMyBatch');
    const params = (req.params ?? {}) as Record<string, unknown>;

    const batchId = String(params['batchId'] ?? '');
    const enrollment = await findEnrollment(batchId, student);
    if (!enrollment) throw batchError(BatchError.BATCH_NOT_FOUND);

    const batch = await findBatchById(batchId);
    if (!batch) throw batchError(BatchError.BATCH_NOT_FOUND);

    batchLog.info('Student Batch read', {
      op: 'getMyBatch',
      stage: 'load',
      ok: true,
      userId: student.id,
      batchId: batch.id,
    });

    return toStudentBatchDto(batch, enrollment.get('joinedAt') as Date | undefined);
  }
}

export default InvitationPublicFunctions;
export {StudentBatchFunctions, requireStudentUser};
