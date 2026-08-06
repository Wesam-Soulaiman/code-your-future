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
 *   8. Seed, then **apply and verify every declared index** ⟨CP4 closeout⟩
 *   9. Only then start the HTTP server + LiveQuery WebSocket server
 *
 * Step 8 used to run *inside* the listen callback, so the port was open while
 * the indexes were still being built. Two of those indexes are the sole
 * enforcement of a concurrency invariant, so that window was a window in which
 * the guarantee did not exist. Readiness now waits for them, and a failure
 * stops the boot rather than being logged and stepped over.
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
  catchError, applyMongoValidators,
  conditionalJsonMiddleware, removeResultMiddleware,
  restrictRoutes, validateEntityRoutes, validateFunctionRoutes,
} from '@90soft/parse-server-kit';
import {
  IndexStartupError,
  applyAndVerifyIndexes,
  indexFailureGuidance,
} from './cloudCode/startup/indexes';
import {
  SchemaDriftError,
  reconcileSchemaDrift,
  schemaDriftGuidance,
} from './cloudCode/startup/schemaDrift';
import {initializeParseServer} from './cloudCode/utils/config/parseConfig';
import {buildCorsOptions, logCorsPolicy} from './cloudCode/utils/config/cors';
import {googleAuthStatus} from './cloudCode/modules/StudentAuth/googleConfig';
import {studentProfilePhotoRouter} from './cloudCode/modules/StudentProfile/photoRoute';
import {batchResourceRouter} from './cloudCode/modules/BatchResource/resourceRoute';
import {publicTalentPhotoRouter} from './cloudCode/modules/PublicTalent/photoRoute';
import {taskAttachmentRouter} from './cloudCode/modules/BatchTask/attachmentRoute';
import {storageIsUsable, useFilesAdapter} from './cloudCode/modules/BatchResource/storage';
import {seedInstitutionCatalog} from './cloudCode/modules/ProfileCatalog/seed';
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

  // The Student profile photo — a dedicated **authenticated binary** endpoint
  // ⟨CP3A catalog⟩.
  //
  // Mounted here, ahead of validateEntityRoutes, because that middleware maps
  // any path under a registered entity prefix onto a cloud function and answers
  // 404 for the rest; this route terminates its own two paths and every other
  // request falls through untouched.
  //
  // It exists because Parse Server logs each cloud-function call with its
  // serialised input and result, which wrote a whole base64 image to the log on
  // every upload. Raw multipart also lets the 5 MiB limit apply at the socket,
  // before anything is decoded. It opens **no** file route: `/files/*` is still
  // 403 above, `File` and `IMG` are untouched, and no public URL is created —
  // the route serves the authenticated owner and nobody else.
  app.use(process.env.mountPath as string, studentProfilePhotoRouter());

  // Batch Resources — the second **authenticated binary** endpoint ⟨CP5⟩.
  //
  // Mounted here for the same reason the photo route is: `validateEntityRoutes`
  // maps any path under a registered entity prefix onto a cloud function and
  // answers 404 for the rest, so a binary route has to terminate its own paths
  // ahead of it.
  //
  // It opens no file route. `/api/files/*` is still 403 above, `File` and `IMG`
  // are untouched, and no public URL exists — a Resource is addressed by its
  // objectId and served only to an Admin or a Student enrolled in its Batch.
  app.use(process.env.mountPath as string, batchResourceRouter());

  // The Task attachment route ⟨CP7⟩. Mounted here for the same reason as the
  // two above: `validateEntityRoutes` maps a path segment to a registered
  // entity and would reject an unknown one.
  app.use(process.env.mountPath as string, taskAttachmentRouter());

  // The public profile photo ⟨CP8⟩. Mounted beside the other binary routes and
  // ahead of `validateEntityRoutes` for the same reason they are: that
  // middleware maps registered entity prefixes onto cloud functions, and this
  // is neither. It requires no session by design — the route re-checks that the
  // Student is published on every request.
  app.use(process.env.mountPath as string, publicTalentPhotoRouter());

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

  // ── Prepare the database BEFORE opening the port ───────────
  //
  // Everything below runs to completion first. The server is not "ready" until
  // every declared index physically exists, because two of them are the only
  // thing standing between two concurrent requests and a broken invariant.

  // Seeding is awaited so roles and the Admin account exist before indexes and
  // validators run (the template fired it off unawaited).
  const [seedError] = await catchError(seedAll());
  if (seedError) {
    safeLog.error('Seeding failed', {op: 'bootstrap', ok: false, stage: 'seedAll'});
  }

  // Hand the Resource storage layer the files adapter Parse already has ⟨CP5⟩.
  //
  // The default adapter is GridFS, on the same connection. Wired once here
  // rather than reached for per request, so a deployment whose adapter cannot
  // stream is reported at boot instead of under somebody's upload.
  useFilesAdapter((parseServer as {config?: {filesController?: {adapter?: unknown}}})?.config
    ?.filesController?.adapter);
  if (!storageIsUsable()) {
    safeLog.warn(
      'Private Resource storage is unavailable — the configured files adapter ' +
        'cannot stream. Batch Resource upload and download will refuse.',
      {op: 'bootstrap', ok: false, stage: 'resourceStorage'}
    );
  } else {
    safeLog.info('Private Resource storage is ready', {
      op: 'bootstrap',
      ok: true,
      stage: 'resourceStorage',
    });
  }

  // Apply **and verify** every declared index. This throws rather than
  // returning a flag, so there is no path that continues past a failure.
  await applyAndVerifyIndexes(parseServer);

  // Reconcile the stored schema with the models ⟨CP5 fix⟩.
  //
  // Parse adds fields to `_SCHEMA` and never removes them, so a `required`
  // field left behind by an earlier shape of a model refuses **every** create
  // on that class — as a bare `142 / "<field> is required"` naming a column the
  // running code has never heard of. Runs before the port opens, because a
  // class in that state cannot accept a single row.
  const removedFields = await reconcileSchemaDrift();
  if (removedFields > 0) {
    safeLog.warn('Stored schema reconciled with the models', {
      op: 'bootstrap',
      ok: true,
      stage: 'schemaDrift',
      count: removedFields,
    });
  }

  await applyMongoValidators(parseServer);

  // Move the Checkpoint 3A institution list into the catalog ⟨CP3A catalog⟩.
  // Idempotent and keyed on the item code, so it creates nothing on a second
  // boot and never overwrites an Admin's edits. Cities, majors, and target
  // roles are deliberately NOT seeded: no authoritative list exists, and an
  // invented one is worse than an empty one an Admin can fill in.
  //
  // Runs after the indexes exist, so the unique `(type, code)` constraint is
  // already enforcing what the seed relies on.
  const [catalogSeedError] = await catchError(seedInstitutionCatalog());
  if (catalogSeedError) {
    safeLog.error('Institution catalog seeding failed', {
      op: 'bootstrap',
      ok: false,
      stage: 'seedProfileCatalog',
    });
  }

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

  // ── Start HTTP Server ──────────────────────────────────────
  await new Promise<void>(resolve => {
    server.listen(PORT, () => {
      safeLog.info('Server listening', {op: 'bootstrap', ok: true, port: PORT});
      resolve();
    });
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
  .catch((error: unknown) => {
    // Never log the raw error: a boot failure can carry the database URI, and a
    // duplicate-key failure's driver message carries the duplicate **value**.
    if (error instanceof IndexStartupError) {
      // A required index is not in place. The collection and index names are
      // schema, not data, so they are safe to name — and they are the only
      // thing an operator needs to find the problem by hand.
      safeLog.error(indexFailureGuidance(error), {
        op: 'bootstrap',
        ok: false,
        stage: 'applyIndexes',
        code: error.code,
        collection: error.collection,
        indexName: error.indexName,
      });
    } else if (error instanceof SchemaDriftError) {
      // A stored required field the models no longer declare, still holding
      // data. Naming it is the whole point: without the name there is nothing
      // an operator can act on.
      safeLog.error(schemaDriftGuidance(error), {
        op: 'bootstrap',
        ok: false,
        stage: 'schemaDrift',
        code: error.code,
        className: error.className,
        fieldName: error.fieldName,
      });
    } else {
      safeLog.error('Server failed to start', {op: 'bootstrap', ok: false});
    }

    // Exit rather than linger: a process that is up but not listening looks
    // healthy to anything watching the process table.
    process.exit(1);
  });
