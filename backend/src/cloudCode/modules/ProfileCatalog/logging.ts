/**
 * Logging boundary for the profile catalog.
 *
 * A catalog item is not personal data, but the surrounding operations are
 * privileged and the same discipline applies: this module accepts a fixed shape
 * rather than redacting an arbitrary one, so a future edit cannot start logging
 * a name, a search term, or a whole Parse object by adding a field to a call.
 *
 * Only these fields are ever emitted:
 *
 *   op        the operation name       e.g. 'createProfileCatalogItem'
 *   stage     a coarse progress marker
 *   ok        success or failure
 *   code      a stable CatalogError code
 *   userId    a Parse objectId
 *   itemId    a Parse objectId
 *   type      one of the four fixed categories — a closed vocabulary
 *   count     how many items were returned or written
 *   fieldCount how many fields failed validation — a number, never the names
 *
 * A search term is deliberately absent. It is something a person typed, and
 * "which cities did the Admin look for" is not information an operator needs.
 */

import {safeLog} from '../../utils/logging/safeLogger';
import {CatalogErrorCode} from './errors';
import {CatalogType} from './constants';

export type CatalogStage =
  | 'authorize'
  | 'load'
  | 'validate'
  | 'save'
  | 'delete'
  | 'seed'
  | 'complete';

export interface CatalogLogFields {
  op: string;
  stage?: CatalogStage;
  ok?: boolean;
  code?: CatalogErrorCode | string;
  userId?: string;
  itemId?: string;
  type?: CatalogType | string;
  count?: number;
  fieldCount?: number;
}

/** The only field names this module will emit. */
const ALLOWED_FIELDS: readonly (keyof CatalogLogFields)[] = [
  'op',
  'stage',
  'ok',
  'code',
  'userId',
  'itemId',
  'type',
  'count',
  'fieldCount',
];

/**
 * Reduce an arbitrary object to the allow-listed fields. Exported so a test can
 * assert the filter directly rather than inferring it from log output.
 */
export function toSafeCatalogFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function safeFields(fields: CatalogLogFields): Record<string, unknown> {
  return toSafeCatalogFields(fields as unknown as Record<string, unknown>);
}

export const catalogLog = {
  info(message: string, fields: CatalogLogFields): void {
    safeLog.info(message, safeFields(fields));
  },
  warn(message: string, fields: CatalogLogFields): void {
    safeLog.warn(message, safeFields(fields));
  },
  error(message: string, fields: CatalogLogFields): void {
    safeLog.error(message, safeFields(fields));
  },
};

export {ALLOWED_FIELDS as ALLOWED_CATALOG_LOG_FIELDS};
