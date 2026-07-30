/**
 * Deny-by-default schema hardening.
 *
 * `createSchemaConfig()` in `@90soft/parse-server-kit` applies an insecure
 * fallback when a `@ParseClass` omits an `ACL` option:
 *
 *     classLevelPermissions.ACL = defaultACL || { '*': { read: true, write: true } };
 *
 * That makes every new class publicly readable *and writable* by default. The
 * kit lives in node_modules and must not be patched, so the fallback is
 * neutralised here — at the boundary where this project builds its schema.
 *
 * Two rules are enforced on every class definition:
 *
 *   1. A class with no explicit CLP is a programming error and aborts startup.
 *      Silence must never mean "public".
 *   2. A public wildcard entry (`'*'`) granting read or write in the default
 *      object ACL is rejected. Classes may only grant access to a named role,
 *      and a class that reached the kit's fallback is rewritten to `{}` (no
 *      access without the master key) rather than being trusted.
 *
 * Adding a new private class therefore fails closed: forget the ACL and the
 * server refuses to start instead of publishing the collection.
 */

import {createSchemaConfig} from '@90soft/parse-server-kit';
import {AppRole} from '../constants/roles';
import {safeLog} from '../logging/safeLogger';

type AclTemplate = Record<string, {read?: boolean; write?: boolean}>;

interface SchemaDefinitionLike {
  className: string;
  fields?: unknown;
  classLevelPermissions?: {
    ACL?: AclTemplate;
    protectedFields?: Record<string, string[]>;
    [operation: string]: unknown;
  };
  [key: string]: unknown;
}

/** Operations that must be explicitly decided on every class. */
const CLP_OPERATIONS = ['find', 'get', 'count', 'create', 'update', 'delete'] as const;

/**
 * Classes Parse Server owns. `_Role` is emitted by the kit itself and is
 * validated, but it is not required to carry a default object ACL template.
 */
const SYSTEM_CLASSES = new Set(['_Role', '_Session', '_Installation']);

export class InsecureSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureSchemaError';
  }
}

function hasPublicGrant(acl: AclTemplate | undefined): boolean {
  if (!acl) return false;
  const wildcard = acl['*'];
  return Boolean(wildcard && (wildcard.read || wildcard.write));
}

/**
 * Harden one definition in place. Returns a note when something was rewritten,
 * so startup can report it.
 */
function hardenDefinition(definition: SchemaDefinitionLike): string | undefined {
  const {className} = definition;
  const clp = definition.classLevelPermissions;

  if (!clp) {
    throw new InsecureSchemaError(
      `Class '${className}' declares no classLevelPermissions. Every @ParseClass ` +
        'must declare an explicit `clp` (use {} to deny all client access). ' +
        'Missing access metadata is never treated as public.'
    );
  }

  const undecided = CLP_OPERATIONS.filter(operation => clp[operation] === undefined);
  if (undecided.length > 0 && !SYSTEM_CLASSES.has(className)) {
    throw new InsecureSchemaError(
      `Class '${className}' leaves these operations undecided: ${undecided.join(', ')}. ` +
        'Declare each one explicitly ({} denies all client access).'
    );
  }

  if (hasPublicGrant(clp.ACL)) {
    // Either the class opted into a public ACL (not allowed for any class in
    // this product) or it hit the kit's fallback. Both fail closed.
    clp.ACL = {};
    return `${className}: public wildcard ACL removed (deny-by-default applied)`;
  }

  if (!clp.ACL && !SYSTEM_CLASSES.has(className)) {
    clp.ACL = {};
    return `${className}: absent ACL template replaced with deny-by-default`;
  }

  return undefined;
}

/**
 * Build the Parse Server `schema` config for this project, then harden it.
 *
 * `adminRole` is passed as `Admin` so the kit generates `_Role` CLP for the real
 * application role rather than the legacy template `SuperAdmin`.
 */
export function createHardenedSchemaConfig() {
  const config = createSchemaConfig({adminRole: AppRole.ADMIN}) as unknown as {
    definitions: SchemaDefinitionLike[];
    [key: string]: unknown;
  };

  const notes: string[] = [];
  for (const definition of config.definitions) {
    const note = hardenDefinition(definition);
    if (note) notes.push(note);
  }

  safeLog.info('Schema hardened (deny-by-default)', {
    op: 'createHardenedSchemaConfig',
    ok: true,
    classCount: config.definitions.length,
    classNames: config.definitions.map(definition => definition.className),
    rewrittenCount: notes.length,
  });

  for (const note of notes) {
    safeLog.warn('Schema hardening rewrote an insecure default', {
      op: 'createHardenedSchemaConfig',
      detail: note,
    });
  }

  return config;
}

/** Exported for tests: harden an arbitrary definition list. */
export function hardenDefinitions(definitions: SchemaDefinitionLike[]): string[] {
  const notes: string[] = [];
  for (const definition of definitions) {
    const note = hardenDefinition(definition);
    if (note) notes.push(note);
  }
  return notes;
}
