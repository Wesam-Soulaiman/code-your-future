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

  // Google OAuth 2.0 **Web application Client ID** for Student sign-in.
  //
  // Public by design: it is embedded in the sign-in page and identifies the
  // application to Google. It is NOT a secret and there is no client secret in
  // the browser — the backend verifies the returned ID token's signature and
  // audience against its own GOOGLE_CLIENT_ID.
  //
  // Left empty on purpose so no real value is committed. Fill it in per
  // deployment; while it is empty the Student page shows the "sign-in is not
  // configured" state and issues no request.
  googleClientId: '1020047849769-faustv3raaj8g8o2hm9mm9j8a5mv2ssd.apps.googleusercontent.com',
};
