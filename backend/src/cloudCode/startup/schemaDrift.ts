/**
 * Reconciling a stored schema with the models that own it ⟨CP5 fix⟩.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 * Parse Server **adds** fields to `_SCHEMA` and never removes them. A field that
 * once existed on a class stays in the schema after the model that declared it
 * is changed — and if that field is marked `required`, Parse's `RestWrite`
 * refuses **every** subsequent create on the class:
 *
 *     throw new Parse.Error(Parse.Error.VALIDATION_ERROR, `${fieldName} is required`)
 *
 * That surfaces as a bare `142 / "<something> is required"` naming a column the
 * current code has never heard of, on a class that otherwise looks healthy — it
 * reads fine, it counts fine, and it refuses to accept a single row. A fresh
 * database is unaffected, so it survives every test and every clean install and
 * appears only on a database that has lived through a change.
 *
 * ── What this does about it ─────────────────────────────────────────────────
 * At startup, for every class the models declare, compare the stored required
 * fields with the declared ones. For a required field the model no longer
 * declares:
 *
 *   - if **no document has a value for it**, it is nobody's data: drop it
 *     through Parse's own schema API and log loudly that it happened;
 *   - if any document does have a value, **refuse to boot** and name the field.
 *     Deleting a column with data in it is a decision for a person, not for a
 *     startup step.
 *
 * The narrowness is the point. This does not "sync" the schema, it does not
 * remove optional leftovers, and it does not touch a field the models still
 * declare. It removes exactly the thing that makes a class unwritable, and only
 * when removing it cannot lose anything.
 */

import 'reflect-metadata';

import {catchError, classNames, getSchemaDefinition} from '@90soft/parse-server-kit';

import {safeLog} from '../utils/logging/safeLogger';

/** A stable reason the reconciliation refused to continue. */
export const SchemaDriftCode = {
  /** A stale required field still holds data, so only a person may remove it. */
  REQUIRED_FIELD_HAS_DATA: 'SCHEMA_REQUIRED_FIELD_HAS_DATA',
  /** The stale field could not be removed. */
  REPAIR_FAILED: 'SCHEMA_REPAIR_FAILED',
} as const;

export type SchemaDriftCodeValue = (typeof SchemaDriftCode)[keyof typeof SchemaDriftCode];

/**
 * A startup failure carrying a stable code and the identity of the field.
 *
 * A class name and a field name are schema, not data, so both are safe to
 * print — and without them the message would be unactionable.
 */
export class SchemaDriftError extends Error {
  readonly code: SchemaDriftCodeValue;
  readonly className: string;
  readonly fieldName: string;

  constructor(code: SchemaDriftCodeValue, className: string, fieldName: string) {
    super(`${code} (${className}.${fieldName})`);
    this.name = 'SchemaDriftError';
    this.code = code;
    this.className = className;
    this.fieldName = fieldName;
  }
}

/** Parse's own schema shape, narrowed to what this module reads. */
interface StoredField {
  type?: string;
  required?: boolean;
}

/**
 * `Parse.Schema`'s read and write, typed locally.
 *
 * Schema operations require the master key, and the SDK takes it as a request
 * option — but `@types/parse` declares `get()` and `update()` as taking no
 * arguments. Declaring the slice this module uses is the same approach the
 * Resource storage layer takes with the files adapter: describe what is
 * actually called, rather than assert past a signature and lose the checking
 * everywhere else in the file.
 */
interface SchemaLike {
  get(options: {useMasterKey: boolean}): Promise<{fields?: Record<string, StoredField>}>;
  update(options: {useMasterKey: boolean}): Promise<unknown>;
  deleteField(name: string): unknown;
}

function schemaFor(className: string): SchemaLike {
  return new Parse.Schema(className) as unknown as SchemaLike;
}

/**
 * The field names a model declares, from the same decorator metadata the schema
 * applier reads — so this cannot drift from what was actually asked for.
 *
 * Returns `undefined` when the class has no declaration at all, which is the
 * signal to leave it alone: an unknown class is not this module's business.
 */
function declaredFields(className: string): Set<string> | undefined {
  const constructor = Parse.Object.extend(className) as unknown;
  const definition = getSchemaDefinition(constructor as never) as
    | {className?: string; fields?: Record<string, unknown>}
    | undefined;

  if (!definition || definition.className !== className) return undefined;
  return new Set(Object.keys(definition.fields ?? {}));
}

/** Fields Parse maintains itself. Never the models' to declare. */
const BUILT_IN = new Set(['objectId', 'createdAt', 'updatedAt', 'ACL']);

/**
 * Required fields present in the stored schema that the model does not declare.
 */
function staleRequiredFields(
  stored: Record<string, StoredField>,
  declared: Set<string>
): string[] {
  return Object.entries(stored)
    .filter(([name, field]) => {
      if (BUILT_IN.has(name) || declared.has(name)) return false;
      return field?.required === true;
    })
    .map(([name]) => name);
}

/** Does any row actually hold a value for this field? */
async function fieldHasData(className: string, fieldName: string): Promise<boolean> {
  const query = new Parse.Query(className);
  query.exists(fieldName);

  const [error, count] = await catchError(query.count({useMasterKey: true}));
  // A count that cannot be taken is treated as "there might be data", because
  // the alternative is deleting a column on the strength of a failed query.
  if (error) return true;
  return (count as number) > 0;
}

/**
 * Reconcile every declared class, repairing what is safe and refusing what is
 * not.
 *
 * Returns the number of fields removed, so the caller can say something useful
 * when it is not zero.
 */
export async function reconcileSchemaDrift(): Promise<number> {
  let removed = 0;

  for (const className of classNames) {
    const declared = declaredFields(className);
    if (!declared) continue;

    const [readError, stored] = await catchError(schemaFor(className).get({useMasterKey: true}));
    // A class that does not exist yet has no drift to reconcile. This is the
    // normal first-boot path.
    if (readError || !stored) continue;

    const fields = stored?.fields ?? {};
    const stale = staleRequiredFields(fields, declared);
    if (stale.length === 0) continue;

    for (const fieldName of stale) {
      if (await fieldHasData(className, fieldName)) {
        safeLog.error(
          'A stored required field is not declared by its model and holds data. ' +
            'Every create on this class will fail until somebody decides what to ' +
            'do with it.',
          {
            op: 'reconcileSchemaDrift',
            stage: 'verify',
            ok: false,
            className,
            fieldName,
            code: SchemaDriftCode.REQUIRED_FIELD_HAS_DATA,
          }
        );
        throw new SchemaDriftError(
          SchemaDriftCode.REQUIRED_FIELD_HAS_DATA,
          className,
          fieldName
        );
      }

      const repair = schemaFor(className);
      repair.deleteField(fieldName);
      const [repairError] = await catchError(repair.update({useMasterKey: true}));
      if (repairError) {
        safeLog.error('Removing a stale required field failed', {
          op: 'reconcileSchemaDrift',
          stage: 'repair',
          ok: false,
          className,
          fieldName,
          code: SchemaDriftCode.REPAIR_FAILED,
        });
        throw new SchemaDriftError(SchemaDriftCode.REPAIR_FAILED, className, fieldName);
      }

      removed += 1;
      // Loud on purpose. A startup that silently changes a schema is a startup
      // nobody can reason about afterwards.
      safeLog.warn(
        'Removed a stale required field that no model declares and no row used. ' +
          'It was making every create on this class fail.',
        {op: 'reconcileSchemaDrift', stage: 'repair', ok: true, className, fieldName}
      );
    }
  }

  return removed;
}

/** What to do about a reconciliation failure, in words an operator can act on. */
export function schemaDriftGuidance(error: SchemaDriftError): string {
  if (error.code === SchemaDriftCode.REQUIRED_FIELD_HAS_DATA) {
    return (
      `'${error.className}.${error.fieldName}' is marked required in the stored ` +
      `schema, no model declares it, and rows still hold values for it. Parse ` +
      `refuses every create on '${error.className}' while that is true. Decide ` +
      `whether the data is still wanted: move it, then remove the column with ` +
      `Parse Dashboard or a schema update, and restart.`
    );
  }
  return (
    `'${error.className}.${error.fieldName}' could not be removed from the stored ` +
    `schema. Check that the master key is usable from this host and that the ` +
    `database is writable, then restart.`
  );
}
