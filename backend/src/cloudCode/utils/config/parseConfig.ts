import {createSchemaConfig} from '@90soft/parse-server-kit';

/**
 * Creates the Parse Server configuration object.
 *
 * Most values come from environment variables (see .env.example).
 * Modify this file to add auth adapters, change file-upload rules,
 * or enable LiveQuery for your project's classes.
 */
export function createParseConfig() {
  return {
    // ── LiveQuery ────────────────────────────────────────────
    // Real-time subscriptions over WebSocket.
    // Add class names that need live updates (e.g., chat messages, notifications).
    // Each class listed here must also have a `beforeSubscribe` hook in main.ts.
    liveQuery: {
      classNames: [
        // Add your LiveQuery class names here, e.g.:
        // 'Notification',
        // 'ChatMessage',
      ],
    },

    // ── Core Settings (from .env) ────────────────────────────
    databaseURI: process.env.databaseURI,       // MongoDB connection string
    appName: process.env.appName,               // Display name for dashboard/emails
    appId: process.env.appId,                   // Unique app identifier
    restAPIKey: process.env.restAPIKey,          // REST API key for client requests
    cloud: './build/src/cloudCode/main.js',      // Path to compiled Cloud Code entry
    masterKey: process.env.masterKey,            // Master key — full access, never expose
    javascriptKey: process.env.javascriptKey,    // JS SDK key (optional)
    serverURL: process.env.serverURL,            // Internal URL for Cloud Code calls
    masterKeyIps: ['::/0', '0.0.0.0/0'],         // IPs allowed to use masterKey (open = all)
    publicServerURL: process.env.publicServerURL, // External URL clients connect to
    mountPath: process.env.mountPath,            // Express mount path (e.g., '/api')

    // ── Security & Limits ────────────────────────────────────
    // When true, Cloud Code triggers (beforeSave, afterSave, etc.) can read
    // protectedFields even without masterKey — needed for trigger logic.
    protectedFieldsTriggerExempt: true,
    requestComplexity: {
      batchRequestLimit: 50, // Max sub-requests in a single batch call
    },

    // ── File Upload ──────────────────────────────────────────
    // Controls who can upload files to Parse Server.
    fileUpload: {
      enableForAnonymousUser: true,       // Allow anonymous users to upload
      enableForAuthenticatedUser: true,    // Allow logged-in users to upload
      enableForPublic: false,              // Block unauthenticated public uploads
    },

    // ── Schema ───────────────────────────────────────────────
    // Auto-generated from model decorators. See database/schema.ts.
    schema: createSchemaConfig(),
  };
}

/**
 * Initializes and starts the Parse Server instance.
 * Called once from app.ts during server bootstrap.
 */
export async function initializeParseServer() {
  const ParseServer = require('parse-server').ParseServer;
  const parseConfig = createParseConfig();
  const parseServer = new ParseServer(parseConfig);
  await parseServer.start();
  return parseServer;
}
