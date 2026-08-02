import {ParseClass, ParseField, BaseModel, BeforeSave} from '@90soft/parse-server-kit';

import {
  LIVE_LIMITS,
  SLIDE_TYPE,
  SLIDE_TYPES,
  SlideType,
  isAnswerType,
  needsOptions,
} from '../modules/LiveSlides/constants';

/**
 * `LiveSlide` — one slide belonging to one session ⟨CP6⟩.
 *
 * Two types and nothing else: **INFORMATION** and **QUESTION**. The prototype
 * sketched Welcome and Closing as well, but those are Information slides with
 * different words on them, and a type that changes no behaviour is a type that
 * eventually grows behaviour by accident.
 *
 * ── Frozen once the lecture starts ──────────────────────────────────────────
 * Slides are created, edited, reordered, and deleted while the session is Draft.
 * From Ready onwards the operations refuse to touch them, and once a session has
 * gone Live the freeze is permanent — a Student's answer must keep pointing at
 * the exact question they were asked, including the exact option labels.
 *
 * ── `lockedAt` is a one-way door ────────────────────────────────────────────
 * A Question closes when the Admin navigates away from it. It never reopens:
 * returning to the Slide is presentation only. That is what makes "you cannot
 * change your answer" true for the class as a whole and not just for one
 * Student.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * No `correctAnswer`, no score, no weighting, no feedback, no image, no file, no
 * speaker notes, no per-slide theme, and no generic metadata column. Every one
 * of those was named as out of scope, and a column is where a feature starts.
 */
@ParseClass('LiveSlide', {
  clp: {
    find: {},
    get: {},
    count: {},
    create: {},
    update: {},
    delete: {},
    protectedFields: {
      '*': [
        'session',
        'type',
        'title',
        'content',
        'question',
        'description',
        'answerType',
        'options',
        'displayOrder',
        'lockedAt',
      ],
      authenticated: [
        'session',
        'type',
        'title',
        'content',
        'question',
        'description',
        'answerType',
        'options',
        'displayOrder',
        'lockedAt',
      ],
    },
  },
  ACL: {},
  compoundIndexes: [
    {
      // The presenter's query: every Slide of one session, in order. One index
      // serves the filter and the sort.
      //
      // `_p_session` is the MongoDB column the pointer occupies; naming the
      // logical field would index a column that does not exist.
      fields: ['_p_session', 'displayOrder'],
      name: 'live_slide_session_order_index',
    },
  ],
  description:
    'One slide of one session. Information or Question. Frozen once the ' +
    'session starts. Never readable or writable directly by any client.',
})
export default class LiveSlide extends BaseModel {
  constructor() {
    super('LiveSlide');
  }

  @ParseField({
    type: 'Pointer',
    targetClass: 'LiveSlideSession',
    required: true,
    description: 'The session that owns this Slide. Immutable',
  })
  session!: Parse.Object;

  @ParseField({
    type: 'String',
    required: true,
    description: 'INFORMATION or QUESTION. Immutable after creation',
  })
  type!: SlideType;

  @ParseField({type: 'String', description: 'Information title'})
  title!: string;

  @ParseField({type: 'String', description: 'Information body text. Plain text only'})
  content!: string;

  @ParseField({type: 'String', description: 'The question asked'})
  question!: string;

  @ParseField({type: 'String', description: 'Optional question description'})
  description!: string;

  @ParseField({type: 'String', description: 'One of the five approved answer types'})
  answerType!: string;

  @ParseField({
    type: 'Array',
    description: 'Structured options: {id, text}. Ids are server-generated',
  })
  options!: {id: string; text: string}[];

  @ParseField({type: 'Number', required: true, description: 'Position within its session'})
  displayOrder!: number;

  @ParseField({
    type: 'Date',
    description: 'When this Question closed for good. Never set by a client',
  })
  lockedAt!: Date;

  /**
   * The shape rules, enforced at the database boundary.
   *
   * The most important of these is the last one: a Slide carries the fields of
   * **its own type and no others**. Without it an Information slide could keep a
   * stale `answerType` from an earlier edit, and a Question could keep a
   * `content` nobody can see — both of which are the sort of quiet inconsistency
   * that turns into a rendering bug months later.
   */
  @BeforeSave({description: 'Reject client writes, freeze the type, clear foreign fields'})
  static async onBeforeSave(request: Parse.Cloud.BeforeSaveRequest<LiveSlide>): Promise<void> {
    const object = request.object;

    if (!request.master) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'LiveSlide is written only by authorised server operations'
      );
    }

    if (object.isNew()) {
      if (!object.get('session')) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Slide requires a session');
      }
    } else {
      // A Slide that could change session or type would rewrite history for
      // every answer already pointing at it.
      for (const immutable of ['session', 'type']) {
        if (object.dirty(immutable)) {
          throw new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            `${immutable} cannot change after a Slide is created`
          );
        }
      }
    }

    const type = object.get('type');
    if (!SLIDE_TYPES.includes(type as SlideType)) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported slide type');
    }

    const order = object.get('displayOrder');
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
      throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'displayOrder must be a whole number');
    }

    if (type === SLIDE_TYPE.INFORMATION) {
      const title = String(object.get('title') ?? '').trim();
      const content = String(object.get('content') ?? '').trim();
      if (title.length < LIVE_LIMITS.slideTitle.min) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'An Information slide requires a title');
      }
      if (content.length < LIVE_LIMITS.slideContent.min) {
        throw new Parse.Error(
          Parse.Error.VALIDATION_ERROR,
          'An Information slide requires content'
        );
      }
      // Nothing that belongs to a Question survives on an Information slide.
      for (const foreign of ['question', 'description', 'answerType', 'options', 'lockedAt']) {
        object.unset(foreign);
      }
    } else {
      const question = String(object.get('question') ?? '').trim();
      if (question.length < LIVE_LIMITS.question.min) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A Question slide requires a question');
      }

      const answerType = object.get('answerType');
      if (!isAnswerType(answerType)) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Unsupported answer type');
      }

      const options = object.get('options');
      if (needsOptions(answerType)) {
        if (!Array.isArray(options) || options.length < 2) {
          throw new Parse.Error(
            Parse.Error.VALIDATION_ERROR,
            'This answer type requires at least two options'
          );
        }
      } else if (options !== undefined) {
        // Text answers carry no options, ever.
        object.unset('options');
      }

      // Nothing that belongs to an Information slide survives on a Question.
      object.unset('title');
      object.unset('content');
    }

    object.setACL(new Parse.ACL());
  }
}
