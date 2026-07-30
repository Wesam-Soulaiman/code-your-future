/**
 * Production Environment Configuration
 *
 * These values are used during `ng build --configuration=production`.
 * Replace all placeholder values before deploying.
 *
 * Note: appVersion is auto-patched by the CI pipeline (see .gitlab-ci.yml)
 * to include the pipeline number (e.g., '0.1.42').
 */
export const environment = {
  // true = production mode (disables Angular debug tools, enables optimizations)
  production: true,

  // App version — auto-updated by CI with pipeline number
  appVersion: '0.1.0',

  // Parse Server REST API URL — your production domain
  apiUrl: 'https://your-domain.com/api',

  // WebSocket URL for LiveQuery — must use wss:// in production (TLS)
  wsUrl: 'wss://your-domain.com/api',

  // Parse Application ID — must match your production backend's appId
  parseAppId: 'Code_your_future',

  // Parse REST API key — must match your production backend's restAPIKey
  parseApiKey: '3401a54c9892f02b7073ba3a433c62',

  // VAPID public key for Web Push notifications
  vapidPublicKey: '',
};
