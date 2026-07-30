/**
 * Development Environment Configuration
 *
 * These values are used during `ng serve` (local development).
 * For production values, see environment.prod.ts.
 */
export const environment = {
  // false = development mode (enables Angular debug tools)
  production: false,

  // App version displayed in the UI (auto-incremented by CI in prod builds)
  appVersion: '0.1.0',

  // Parse Server REST API URL (must match backend's serverURL + mountPath)
  apiUrl: 'http://localhost:1337/api',

  // WebSocket URL for LiveQuery real-time subscriptions
  // Use ws:// for local dev, wss:// for production (TLS)
  wsUrl: 'ws://localhost:1337/api',

  // Parse Application ID — must match backend's appId in .env
  parseAppId: 'Code_your_future',

  // Parse REST API key — must match backend's restAPIKey in .env
  parseApiKey: '3401a54c9892f02b7073ba3a433c62',

  // VAPID public key for Web Push notifications (leave empty to disable)
  // Generate with: npx web-push generate-vapid-keys
  vapidPublicKey: '',
};
