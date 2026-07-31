/**
 * Application Entry Point
 *
 * Startup order:
 *   1. Load environment variables (.env) and validate required keys by name
 *   2. Pre-load models so schema decorators register before Parse Server starts
 *   3. Initialize Parse Server with the hardened config from parseConfig.ts
 *   4. Apply Express middleware (CORS, route guards, JSON parsing)
 *   5. Mount Parse Server on the configured mountPath
 *   6. Register cloud functions, triggers, and cron jobs
 *   7. Setup Swagger API docs
 *   8. Start HTTP server + LiveQuery WebSocket server
 *   9. Await database seed, then apply indexes and validators
 */

import express = require('express');
require('dotenv').config();

const cors = require('cors');
const ParseServer = require('parse-server').ParseServer;
const app = express();
const server = require('http').createServer(app);

import {setupSwagger} from '@90soft/parse-server-kit';

// Validate the environment before anything reads it. Only key NAMES are
// reported on failure — never values.
import {assertEnv} from './cloudCode/utils/config/env';
import {safeLog} from './cloudCode/utils/logging/safeLogger';
assertEnv();

// Pre-load all models so the schema decorator system populates the classNames
// array BEFORE Parse Server reads the schema config. This must happen early.
import {join} from 'path';
import {importFiles} from '@90soft/parse-server-kit';
safeLog.info('Pre-loading models for schema registration', {op: 'bootstrap'});
const mainModelsPath = join(__dirname, 'cloudCode/models');
importFiles(mainModelsPath);

// Import utilities
import {seedAll} from './cloudCode/database/seed';
import {
  CloudFunctionRegistry, TriggerRegistry, CronRegistry,
  catchError, applyMongoValidators, applyUniqueIndexes,
  conditionalJsonMiddleware, removeResultMiddleware,
  restrictRoutes, validateEntityRoutes, validateFunctionRoutes,
} from '@90soft/parse-server-kit';
import {initializeParseServer} from './cloudCode/utils/config/parseConfig';
import {buildCorsOptions, logCorsPolicy} from './cloudCode/utils/config/cors';
import {googleAuthStatus} from './cloudCode/modules/StudentAuth/googleConfig';
import './cloudCode/cron'; // Load cron job definitions before CronRegistry.initialize

const PORT = Number(process.env.PORT) || 1337;

/**
 * Block anonymous access to Parse's built-in file endpoints.
 *
 * Parse Server serves stored files at `${mountPath}/files/:appId/:name` with no
 * authentication, and the kit's `restrictRoutes` whitelists `/files` as a system
 * route. File and IMG are private infrastructure in this product, so the raw
 * endpoint is closed here.
 *
 * FUTURE EXTENSION POINT: controlled read access arrives with StudentProfile
 * photos (Checkpoint 4) and Batch Resources (Checkpoint 7) as a cloud function
 * that authorises the caller and then streams the bytes. See Open Question OQ-10.
 * Uploads are separately disabled in parseConfig (`fileUpload.*: false`).
 */
function blockRawFileRoutes(req: any, res: any, next: any) {
  if (req.path === '/files' || req.path.startsWith('/files/')) {
    safeLog.warn('Blocked anonymous raw file request', {
      op: 'blockRawFileRoutes',
      ok: false,
      code: 'RAW_FILE_ACCESS_DISABLED',
    });
    return res.status(403).json({error: 'File access is not available'});
  }
  return next();
}

/**
 * Final error handler. Clients receive a stable, non-revealing payload; the
 * detail goes to the redacting logger instead of the response body.
 */
function sanitizedErrorHandler(err: any, req: any, res: any, next: any) {
  if (res.headersSent) return next(err);

  const parseCode = typeof err?.code === 'number' ? err.code : undefined;
  const status = parseCode === Parse.Error.OPERATION_FORBIDDEN ? 403 : 500;

  safeLog.error('Unhandled request error', {
    op: 'errorHandler',
    ok: false,
    route: req?.path,
    code: parseCode ?? 'UNKNOWN',
  });

  return res.status(status).json({error: 'Request failed'});
}

// ── Main Bootstrap ──────────────────────────────────────────
async function main() {
  const parseServer = await initializeParseServer();
  Parse.masterKey = process.env.masterKey;

  // ── Middleware Stack ────────────────────────────────────────
  // Order matters! Middleware runs top-to-bottom for each request.

  // Strips the {result: ...} wrapper from Parse Server cloud function responses.
  app.use(removeResultMiddleware);

  // CORS — fails closed. There is no wildcard fallback: an explicit allow-list
  // from CORS_ORIGINS, a narrow localhost list outside production, or nothing.
  // See utils/config/cors.ts.
  app.use(cors(buildCorsOptions()));
  logCorsPolicy();

  // Close Parse's unauthenticated raw file endpoints before anything can route
  // to them.
  app.use(process.env.mountPath as string, blockRawFileRoutes);

  // Validates entity-based routes: /api/{entity}/{action} → /functions/{name}
  app.use(process.env.mountPath as string, validateEntityRoutes as any);

  // Legacy: validates /api/functions/{name} routes.
  app.use(process.env.mountPath + '/functions', validateFunctionRoutes as any);

  // Parses JSON bodies for non-Parse routes.
  app.use(conditionalJsonMiddleware);

  // ── Custom Routes ──────────────────────────────────────────
  // Add your own Express routes here, BEFORE restrictRoutes.

  // Blocks direct access to internal Parse Server endpoints (/classes,
  // /schemas, /batch, ...). Only registered entity routes and cloud functions
  // pass through.
  app.use(`${process.env.mountPath}`, restrictRoutes);

  // ── Mount Parse Server ─────────────────────────────────────
  app.use(process.env.mountPath as string, parseServer.app);

  // NOTE: the template also served `backend/files` at the web root via
  // express.static, a second unauthenticated file surface. It was removed in
  // Checkpoint 1 — private files are never served straight off disk.

  // Serve .well-known (domain verification, ACME challenges).
  app.use(
    '/.well-known',
    express.static(join(__dirname, '../../files/.well-known'))
  );

  // ── Initialize Registries ──────────────────────────────────
  CloudFunctionRegistry.initialize();
  TriggerRegistry.initialize();
  CronRegistry.initialize();

  // ── Swagger API Documentation ──────────────────────────────
  setupSwagger(app, {
    title: process.env.APP_NAME || 'Code Your Future API',
    version: '1.0.0',
    description: 'Auto-generated API documentation for the Code Your Future backend',
    basePath: process.env.mountPath || '/api',
  });

  // Sanitized error handler must be registered last.
  app.use(sanitizedErrorHandler);

  // ── Start HTTP Server ──────────────────────────────────────
  server.listen(PORT, async () => {
    // Seeding is awaited so roles and the Admin account exist before indexes and
    // validators run (the template fired it off unawaited).
    const [seedError] = await catchError(seedAll());
    if (seedError) {
      safeLog.error('Seeding failed', {op: 'bootstrap', ok: false, stage: 'seedAll'});
    }

    await applyUniqueIndexes(parseServer);
    await applyMongoValidators(parseServer);

    // Student Google sign-in is optional configuration. Report presence by key
    // name only — the value is never read into a log line — and never fail the
    // boot: Admin password login must keep working without it.
    const google = googleAuthStatus();
    if (google.configured) {
      safeLog.info('Student Google sign-in is configured', {
        op: 'bootstrap',
        ok: true,
        stage: 'google-auth',
      });
    } else {
      safeLog.warn(
        'Student Google sign-in is NOT configured — the endpoint will refuse ' +
          'with GOOGLE_NOT_CONFIGURED. Admin login is unaffected.',
        {
          op: 'bootstrap',
          ok: false,
          stage: 'google-auth',
          requiredKeys: google.requiredKeys,
        }
      );
    }

    safeLog.info('Server listening', {op: 'bootstrap', ok: true, port: PORT});
  });

  // ── Start LiveQuery WebSocket Server ───────────────────────
  const [err] = await catchError(ParseServer.createLiveQueryServer(server));
  if (err) {
    safeLog.error('LiveQuery server failed to start', {op: 'bootstrap', ok: false});
  } else {
    safeLog.info('LiveQuery server started', {op: 'bootstrap', ok: true});
  }
}

// ── Start Application ────────────────────────────────────────
main()
  .then(() => {
    safeLog.info('Server initialized', {op: 'bootstrap', ok: true});
  })
  .catch(() => {
    // Never log the raw error: a boot failure can carry the database URI.
    safeLog.error('Server failed to start', {op: 'bootstrap', ok: false});
    process.exitCode = 1;
  });
