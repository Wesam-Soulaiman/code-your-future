import {createHardenedSchemaConfig} from './schemaGuard';
import {parseAllowOrigin} from './cors';
import {parseLoggerAdapter, safeLog} from '../logging/safeLogger';

/**
 * Parse Server configuration.
 *
 * Security posture for Checkpoint 1:
 *   - master key usable from localhost only (never the whole internet);
 *   - read-only master key likewise restricted;
 *   - anonymous users disabled — Students authenticate via OAuth in Checkpoint 3;
 *   - client class creation disabled;
 *   - direct file upload closed for every caller class;
 *   - schema hardened to deny-by-default (see `schemaGuard.ts`);
 *   - all Parse logging routed through the redacting logger adapter.
 *
 * No value from `.env` is ever logged; only which keys were present.
 */

/**
 * Master-key IP allow-list.
 *
 * Fails closed: with nothing configured the master key is usable only from the
 * machine running Parse Server. Deployments override it with `MASTER_KEY_IPS`
 * (comma-separated) — no production topology is hardcoded here.
 *
 * The template previously shipped `['::/0', '0.0.0.0/0']`, which allowed master
 * key use from any address on the internet.
 */
function masterKeyIps(): string[] {
  const configured = (process.env.MASTER_KEY_IPS || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  if (configured.length > 0) {
    safeLog.info('Master key IP allow-list loaded from environment', {
      op: 'masterKeyIps',
      entryCount: configured.length,
    });
    return configured;
  }

  return ['127.0.0.1', '::1'];
}

export function createParseConfig() {
  return {
    // ── LiveQuery ────────────────────────────────────────────
    // No class is LiveQuery-enabled yet. Any class added here MUST also get a
    // `beforeSubscribe` hook in main.ts — role-based CLP alone is not reliably
    // enforced for LiveQuery in this Parse Server version.
    liveQuery: {
      classNames: [] as string[],
    },

    // ── Core settings (from .env) ────────────────────────────
    databaseURI: process.env.databaseURI,
    appName: process.env.appName,
    appId: process.env.appId,
    restAPIKey: process.env.restAPIKey,
    cloud: './build/src/cloudCode/main.js',
    masterKey: process.env.masterKey,
    javascriptKey: process.env.javascriptKey,
    serverURL: process.env.serverURL,
    publicServerURL: process.env.publicServerURL,
    mountPath: process.env.mountPath,

    // ── Master key boundaries ────────────────────────────────
    masterKeyIps: masterKeyIps(),
    // The read-only master key defaults to "any IP" in Parse Server. Restrict it
    // to localhost too; it bypasses CLP, ACL, and protectedFields on reads.
    readOnlyMasterKeyIps: ['127.0.0.1', '::1'],

    // ── CORS ─────────────────────────────────────────────────
    // Parse Server writes its own Access-Control-Allow-Origin header from its
    // mounted app, defaulting to '*' and overriding any upstream cors()
    // middleware. Feeding it the same allow-list from utils/config/cors.ts is
    // what actually removes the wildcard for /api/* responses.
    allowOrigin: parseAllowOrigin(),

    // ── Access boundaries ────────────────────────────────────
    // A client may not invent classes. Combined with the hardened schema this
    // means every collection is declared in source and fails closed.
    allowClientClassCreation: false,
    // Anonymous users would be an unauthenticated identity that bypasses the
    // "no public signup" rule. Students sign in with Google (Checkpoint 3).
    enableAnonymousUsers: false,
    // Client-chosen objectIds let a caller collide with or guess record ids.
    allowCustomObjectId: false,

    // Cloud Code triggers may read protectedFields — needed by the File/IMG
    // triggers, which run server-side only.
    protectedFieldsTriggerExempt: true,
    requestComplexity: {
      batchRequestLimit: 50,
    },

    // ── File upload ──────────────────────────────────────────
    // Direct upload is closed for every caller class. File and IMG records are
    // created only by a server-controlled cloud function that has authorised the
    // caller first (see the extension points documented on those models).
    fileUpload: {
      enableForAnonymousUser: false,
      enableForAuthenticatedUser: false,
      enableForPublic: false,
    },

    // ── Logging ──────────────────────────────────────────────
    // Every Parse log line passes through recursive redaction, so cloud-function
    // params and result bodies cannot leak credentials or personal data.
    loggerAdapter: parseLoggerAdapter,
    logLevel: process.env.LOG_LEVEL || 'info',

    // ── Schema ───────────────────────────────────────────────
    // Deny-by-default. Aborts startup if a class omits explicit access metadata.
    schema: createHardenedSchemaConfig(),
  };
}

/**
 * Initialise and start Parse Server. Called once from app.ts during bootstrap.
 */
export async function initializeParseServer() {
  const ParseServer = require('parse-server').ParseServer;
  const parseConfig = createParseConfig();
  const parseServer = new ParseServer(parseConfig);
  await parseServer.start();
  return parseServer;
}
