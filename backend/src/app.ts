/**
 * Application Entry Point
 *
 * This file bootstraps the Express server, mounts Parse Server,
 * applies middleware, seeds the database, and starts LiveQuery.
 *
 * Startup order:
 *   1. Load environment variables (.env)
 *   2. Pre-load models (so schema decorators register before Parse Server starts)
 *   3. Initialize Parse Server with config from parseConfig.ts
 *   4. Apply Express middleware (CORS, route guards, JSON parsing)
 *   5. Mount Parse Server on the configured mountPath
 *   6. Register cloud functions, triggers, and cron jobs
 *   7. Setup Swagger API docs
 *   8. Start HTTP server + LiveQuery WebSocket server
 *   9. Run database seed + indexes + validators
 */

import express = require('express');
require('dotenv').config();

const cors = require('cors');
const ParseServer = require('parse-server').ParseServer;
const app = express();
const server = require('http').createServer(app);

// Import Swagger setup for auto-generated API documentation
import {setupSwagger} from '@90soft/parse-server-kit';

// Pre-load all models so the schema decorator system populates the classNames
// array BEFORE Parse Server reads the schema config. This must happen early.
import {join} from 'path';
import {importFiles} from '@90soft/parse-server-kit';
console.log('|||||||||||| Pre-loading Models for Schema ||||||||||||');
const mainModelsPath = join(__dirname, 'cloudCode/models');
importFiles(mainModelsPath);

import path = require('path');

// Import utilities
import {seedAll} from './cloudCode/database/seed';
import {
  CloudFunctionRegistry, TriggerRegistry, CronRegistry,
  catchError, applyMongoValidators, applyUniqueIndexes,
  conditionalJsonMiddleware, removeResultMiddleware,
  restrictRoutes, validateEntityRoutes, validateFunctionRoutes,
} from '@90soft/parse-server-kit';
import {initializeParseServer} from './cloudCode/utils/config/parseConfig';
import './cloudCode/cron'; // Load cron job definitions (must import before CronRegistry.initialize)

// ── Main Bootstrap ──────────────────────────────────────────
async function main() {
  // Initialize Parse Server with the config from parseConfig.ts
  const parseServer = await initializeParseServer();
  Parse.masterKey = process.env.masterKey;

  // ── Middleware Stack ────────────────────────────────────────
  // Order matters! Middleware runs top-to-bottom for each request.

  // Strips the {result: ...} wrapper from Parse Server cloud function responses
  // so the frontend receives clean JSON.
  app.use(removeResultMiddleware);

  // Enable CORS for all origins (tighten in production if needed).
  app.use(cors());

  // Validates entity-based routes: /api/{entity}/{action} → rewrites to /functions/{name}
  // Returns 404 for unregistered routes, 405 for wrong HTTP method.
  app.use(process.env.mountPath as string, validateEntityRoutes as any);

  // Legacy: validates /api/functions/{name} routes (kept for internal Parse Server use)
  app.use(process.env.mountPath + '/functions', validateFunctionRoutes as any);

  // Parses JSON bodies for non-Parse routes (custom Express endpoints).
  app.use(conditionalJsonMiddleware);

  // ── Custom Routes ──────────────────────────────────────────
  // Add your own Express routes here, BEFORE restrictRoutes.
  // Example:
  //   import {myWebhookRouter} from './cloudCode/routes/myWebhook';
  //   app.use(`${process.env.mountPath}/my-webhook`, myWebhookRouter);

  // Blocks direct access to internal Parse Server endpoints (classes, schemas, etc.)
  // Only cloud functions and allowed routes pass through.
  app.use(`${process.env.mountPath}`, restrictRoutes);

  // ── Mount Parse Server ─────────────────────────────────────
  // All Parse REST API endpoints are served under mountPath (e.g., /api).
  app.use(process.env.mountPath as string, parseServer.app);

  // Serve static files (uploaded files, public assets) from /files directory
  app.use(express.static(path.join(__dirname, '../../files')));

  // Serve .well-known directory (used for domain verification, SSL, etc.)
  app.use(
    '/.well-known',
    express.static(path.join(__dirname, '../../files/.well-known'))
  );

  // ── Initialize Registries ──────────────────────────────────
  // These read decorator metadata and register cloud functions, triggers, and cron jobs
  // with Parse Server. Must happen after Parse Server is mounted.
  CloudFunctionRegistry.initialize();
  TriggerRegistry.initialize();
  CronRegistry.initialize();

  // ── Swagger API Documentation ──────────────────────────────
  // Auto-generates OpenAPI docs from registered cloud functions.
  // Access at: http://localhost:1337/api-docs
  setupSwagger(app, {
    title: process.env.APP_NAME || 'Backend API',
    version: '1.0.0',
    description: 'Auto-generated API documentation for Parse Server backend',
    basePath: process.env.mountPath || '/parse',
  });

  // ── Start HTTP Server ──────────────────────────────────────
  server.listen(1337, async () => {
    // Seed default roles and admin user (skips if already exist)
    seedAll();
    // Apply unique indexes defined in model decorators
    await applyUniqueIndexes(parseServer);
    // Apply MongoDB validators from field validation decorators
    await applyMongoValidators(parseServer);
    console.log('The Server is up and running on port 1337.');
  });

  // ── Start LiveQuery WebSocket Server ───────────────────────
  // Enables real-time subscriptions. Clients connect via WebSocket.
  // Configure which classes support LiveQuery in parseConfig.ts.
  const [err] = await catchError(ParseServer.createLiveQueryServer(server));
  if (err) {
    console.error('Error starting Live Query Server:', err);
  }
  console.log('Live Query Server started successfully');

  // Log WebSocket upgrade requests (useful for debugging LiveQuery connections)
  server.on('upgrade', (request: any, socket: any, head: any) => {
    console.log('WebSocket upgrade request:', request.url);
  });
}

// ── Start Application ────────────────────────────────────────
main()
  .then(() => {
    console.log('--- Server Initialized ---');
  })
  .catch(error => {
    console.error('Error starting the server:', error);
  });
