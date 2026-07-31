/**
 * Repository-integrity guard for the browser-facing security headers and the
 * Google origin configuration ⟨CP2B closeout⟩.
 *
 * Google Identity Services opens a popup and talks back to the page that opened
 * it. Chrome severs that link unless the **document** declares
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which is what produced
 * the reported *"Cross-Origin-Opener-Policy policy would block the
 * window.postMessage call"* warning.
 *
 * The only serving layer this repository controls is the Angular dev server;
 * production hosting lives outside it and is documented instead. These checks
 * assert the configuration, not a live response — the live response is verified
 * during runtime validation.
 *
 * Like `templatePreservation.test.ts`, this lives in the backend suite because
 * it is the only suite with filesystem access.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'create-project.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repository root not found');
}

const REPO_ROOT = findRepoRoot();
const FRONTEND = join(REPO_ROOT, 'frontend');

const COOP_HEADER = 'Cross-Origin-Opener-Policy';
const COOP_VALUE = 'same-origin-allow-popups';

interface AngularWorkspace {
  projects: Record<
    string,
    {
      architect?: Record<
        string,
        {
          builder?: string;
          options?: Record<string, unknown>;
          configurations?: Record<string, Record<string, unknown>>;
        }
      >;
    }
  >;
}

const workspace = JSON.parse(
  readFileSync(join(FRONTEND, 'angular.json'), 'utf8')
) as AngularWorkspace;

const serveTargets = Object.values(workspace.projects)
  .map(project => project.architect?.['serve'])
  .filter((target): target is NonNullable<typeof target> => Boolean(target));

describe('Cross-Origin-Opener-Policy', () => {
  test('the dev server declares same-origin-allow-popups', () => {
    assert.ok(serveTargets.length > 0, 'a serve target must exist');

    for (const target of serveTargets) {
      const headers = (target.options?.['headers'] ?? {}) as Record<string, string>;
      assert.equal(
        headers[COOP_HEADER],
        COOP_VALUE,
        `the serve target must set ${COOP_HEADER}: ${COOP_VALUE}`
      );
    }
  });

  test('no build or serve configuration contradicts it', () => {
    // A per-configuration override would silently win over the base options.
    for (const target of serveTargets) {
      for (const [name, configuration] of Object.entries(target.configurations ?? {})) {
        const headers = (configuration['headers'] ?? {}) as Record<string, string>;
        if (COOP_HEADER in headers) {
          assert.equal(
            headers[COOP_HEADER],
            COOP_VALUE,
            `configuration '${name}' must not override ${COOP_HEADER}`
          );
        }
      }
    }
  });

  test('exactly one COOP value is declared anywhere in the repository', () => {
    const workspaceSource = readFileSync(join(FRONTEND, 'angular.json'), 'utf8');
    const occurrences = workspaceSource.split(COOP_HEADER).length - 1;
    assert.equal(occurrences, 1, 'a second declaration could contradict the first');

    for (const value of ['same-origin"', 'unsafe-none', 'same-origin-plus-coep']) {
      assert.ok(
        !workspaceSource.includes(`"${COOP_HEADER}": "${value}`),
        `conflicting COOP value declared: ${value}`
      );
    }
  });

  test('no Cross-Origin-Embedder-Policy is imposed', () => {
    // COEP would block Google's cross-origin button iframe outright.
    const workspaceSource = readFileSync(join(FRONTEND, 'angular.json'), 'utf8');
    assert.ok(!workspaceSource.includes('Cross-Origin-Embedder-Policy'));

    const indexHtml = readFileSync(join(FRONTEND, 'src', 'index.html'), 'utf8');
    assert.ok(!indexHtml.includes('Cross-Origin-Embedder-Policy'));
  });

  test('the policy is not attempted from a meta tag', () => {
    // COOP is only honoured as an HTTP header; a meta tag would be a silent
    // no-op that looks like a fix.
    const indexHtml = readFileSync(join(FRONTEND, 'src', 'index.html'), 'utf8');
    assert.ok(
      !/http-equiv=["']?Cross-Origin-Opener-Policy/i.test(indexHtml),
      'COOP must be an HTTP header, not a meta tag'
    );
  });
});

describe('Google origin configuration', () => {
  const environments = ['environment.ts', 'environment.prod.ts'].map(name =>
    readFileSync(join(FRONTEND, 'src', 'environments', name), 'utf8')
  );

  test('no Google client secret exists in the browser bundle', () => {
    for (const source of environments) {
      assert.ok(!/clientSecret/i.test(source));
      assert.ok(!/GOCSPX-/.test(source), 'a Google client secret must never ship');
    }
  });

  test('the client id is a bare public Web client id, with no origin baked in', () => {
    for (const source of environments) {
      const declared = /googleClientId:\s*'([^']*)'/.exec(source);
      assert.ok(declared, 'googleClientId must be declared');
      const value = declared![1];
      assert.ok(
        value === '' || /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value),
        'googleClientId must be empty or a public Google Web client id'
      );
      // An origin or route in this field would mean the two settings had been
      // confused: authorised origins are configured in Google Cloud, not here.
      assert.ok(!value.includes('http'), 'no origin belongs in the client id');
      assert.ok(!value.includes('/'), 'no route belongs in the client id');
    }
  });

  test('no authorised-origin list is hardcoded in the frontend', () => {
    // Authorised JavaScript origins live in the Google Cloud console. A list
    // here would be misleading — it would configure nothing.
    for (const source of environments) {
      assert.ok(!/authorized(Java[Ss]cript)?Origins/i.test(source));
    }
  });

  test('the Google library is loaded from Google, with a language only', () => {
    const service = readFileSync(
      join(FRONTEND, 'src', 'app', 'services', 'google-identity.service.ts'),
      'utf8'
    );
    assert.ok(service.includes('https://accounts.google.com/gsi/client'));
    assert.ok(service.includes('?hl='), 'the language is set on the script URL');
    // The origin is never sent by us; the browser sends it, and Google checks it.
    assert.ok(!/origin=/.test(service), 'we must not fabricate an origin parameter');
  });
});

describe('backend CORS is unchanged and still fails closed', () => {
  const corsSource = readFileSync(
    join(REPO_ROOT, 'backend', 'src', 'cloudCode', 'utils', 'config', 'cors.ts'),
    'utf8'
  );

  /**
   * Comments are stripped before matching: the file documents *why* it never
   * returns `'*'`, and that prose must not read as a wildcard.
   */
  const corsCode = corsSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  test('no wildcard origin exists on any path', () => {
    assert.ok(!/origin:\s*true/.test(corsCode), 'no reflected-origin mode');
    assert.ok(!corsCode.includes("'*'"), 'no wildcard origin');
  });

  test('production without configuration still allows nothing', () => {
    assert.ok(
      corsSource.includes('cors-disallowed.invalid'),
      'the unmatchable production sentinel must remain'
    );
  });

  test('credentials stay disabled — this API uses a session-token header', () => {
    assert.ok(/credentials:\s*false/.test(corsSource));
  });

  test('the COOP work introduced no CORS change', () => {
    // COOP governs the *document* and its popups; CORS governs the API. Loosening
    // the API would be an unrelated and unnecessary risk.
    assert.ok(!corsSource.includes('Cross-Origin-Opener-Policy'));
    assert.ok(!corsSource.includes('accounts.google.com'));
  });
});
