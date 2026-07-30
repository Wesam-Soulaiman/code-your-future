/**
 * Test harness support: the `Parse` global, plus a fix for a dependency that
 * would otherwise stop the test process from exiting.
 *
 * ── The Parse global ────────────────────────────────────────────────────────
 * Backend source treats `Parse` as an ambient global (Parse Server provides it at
 * runtime). To exercise models and decorators in a plain Node test process we
 * install the genuine SDK rather than a hand-written stub, so
 * `Parse.Object.registerSubclass`, `Parse.Object.extend`, `Parse.User`,
 * `Parse.Role`, `Parse.ACL`, and `Parse.Error` behave exactly as in production.
 *
 * The SDK is resolved through `parse-server`, which declares `parse` as a
 * dependency, so no new direct dependency (and therefore no lockfile change) is
 * required. `@types/parse` is already a direct dependency, so the types match.
 *
 * MUST be called before importing any model or any `@90soft/parse-server-kit`
 * module: the kit's `BaseModel` captures `Parse.Object` at module-load time.
 *
 * ── The interval that never exits ───────────────────────────────────────────
 * `@90soft/parse-server-kit/dist/middleware/rateLimit.js` calls `setInterval()`
 * at module scope to prune its rate-limit window map, and never calls `.unref()`
 * on the result. The kit's barrel re-exports that module, so importing *any* kit
 * symbol starts a timer that keeps the Node event loop alive forever — the test
 * process would hang after the last assertion.
 *
 * node_modules must not be patched, so the timer is handled here instead:
 * `setInterval` is wrapped for the duration of module loading so every interval
 * it creates is recorded and `unref()`d, and `clearTrackedIntervals()` clears
 * them in an `after()` hook. Nothing is hidden — the timer is tracked and
 * explicitly torn down, and `--test-force-exit` is never used.
 */

import {createRequire} from 'node:module';

let installed = false;

/** Intervals created after installation, so teardown can clear them. */
const trackedIntervals: NodeJS.Timeout[] = [];

function trackIntervals(): void {
  const original = globalThis.setInterval;

  const wrapped = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = (original as unknown as (...callArgs: unknown[]) => NodeJS.Timeout)(
      handler,
      timeout,
      ...args
    );
    // An unref'd interval still fires, but no longer holds the event loop open.
    if (timer && typeof timer.unref === 'function') timer.unref();
    trackedIntervals.push(timer);
    return timer;
  }) as unknown as typeof globalThis.setInterval;

  globalThis.setInterval = wrapped;
}

export function installParseTestGlobal(): void {
  if (installed) return;

  // Install the wrapper first so any interval created while the kit loads is
  // caught.
  trackIntervals();

  const backendRequire = createRequire(__filename);
  // Resolve `parse/node` from parse-server's own dependency tree.
  const parseServerManifest = backendRequire.resolve('parse-server/package.json');
  const parseServerRequire = createRequire(parseServerManifest);
  const ParseSdk = parseServerRequire('parse/node');

  // Local, inert credentials: nothing in these tests contacts a server, and no
  // real key is read from the environment.
  ParseSdk.initialize('cyf-test-app', 'cyf-test-js-key', 'cyf-test-master-key');
  ParseSdk.serverURL = 'http://127.0.0.1:1/unused';

  (globalThis as Record<string, unknown>)['Parse'] = ParseSdk;
  installed = true;
}

/**
 * Clear every interval started since installation. Call from an `after()` hook
 * so each test file leaves no timer behind.
 */
export function clearTrackedIntervals(): void {
  while (trackedIntervals.length > 0) {
    const timer = trackedIntervals.pop();
    if (timer) clearInterval(timer);
  }
}

/** The installed SDK, for tests that need it directly. */
export function parseSdk(): typeof Parse {
  installParseTestGlobal();
  return (globalThis as unknown as {Parse: typeof Parse}).Parse;
}
