/**
 * Boot-time environment validation.
 *
 * Fails fast with the *names* of missing keys. Values are never read into a log
 * line, an error message, or a thrown stack — only presence is reported.
 */

import {safeLog} from '../logging/safeLogger';

/** Keys without which the server cannot serve a single request correctly. */
const REQUIRED_KEYS: readonly string[] = [
  'databaseURI',
  'appId',
  'masterKey',
  'serverURL',
  'mountPath',
];

/** Keys that are optional but change behaviour when present. */
const OPTIONAL_KEYS: readonly string[] = [
  'appName',
  'restAPIKey',
  'javascriptKey',
  'publicServerURL',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'ADMIN_EMAIL',
  'MASTER_KEY_IPS',
  'LOG_LEVEL',
  'PORT',
];

export interface EnvValidationResult {
  missing: string[];
  presentOptional: string[];
  absentOptional: string[];
}

function isPresent(key: string): boolean {
  const value = process.env[key];
  return typeof value === 'string' && value.trim().length > 0;
}

/** Inspect the environment without throwing. Returns key names only. */
export function inspectEnv(): EnvValidationResult {
  return {
    missing: REQUIRED_KEYS.filter(key => !isPresent(key)),
    presentOptional: OPTIONAL_KEYS.filter(isPresent),
    absentOptional: OPTIONAL_KEYS.filter(key => !isPresent(key)),
  };
}

/**
 * Validate and abort on failure. The thrown message lists missing key names and
 * nothing else — no values, no partial values, no lengths.
 */
export function assertEnv(): EnvValidationResult {
  const result = inspectEnv();

  if (result.missing.length > 0) {
    safeLog.error('Environment validation failed: required keys are missing', {
      op: 'assertEnv',
      ok: false,
      missingKeys: result.missing,
      missingCount: result.missing.length,
    });
    throw new Error(
      `Missing required environment keys: ${result.missing.join(', ')}. ` +
        'Set them in backend/.env (values are never logged).'
    );
  }

  safeLog.info('Environment validation passed', {
    op: 'assertEnv',
    ok: true,
    requiredCount: REQUIRED_KEYS.length,
    optionalPresentCount: result.presentOptional.length,
  });

  return result;
}

export {REQUIRED_KEYS, OPTIONAL_KEYS};
