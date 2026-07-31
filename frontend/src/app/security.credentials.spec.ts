import { describe, expect, it } from 'vitest';

import { environment } from '../environments/environment';
import { environment as productionEnvironment } from '../environments/environment.prod';

/**
 * Frontend credential audit.
 *
 * The browser bundle is public: anything in it is readable by any visitor. These
 * tests assert that only **non-privileged Parse client configuration** ships, and
 * that no backend-only credential has leaked in.
 *
 * Classification of `parseApiKey`: it is the Parse **REST API key** — a client
 * key, in the same family as `javascriptKey` and `clientKey`. Parse treats client
 * keys as non-secret; they identify the application, they do not authorise
 * anything. All authority in this product comes from the session token plus live
 * role membership, on top of deny-by-default CLP. It is **not** a Master Key and
 * must not be classified as a secret.
 *
 * Classification of `googleClientId`: it is the Google OAuth 2.0 **Web
 * application Client ID**, which is embedded in the sign-in page by design and
 * identifies the application to Google. It authorises nothing on its own — the
 * backend verifies every ID token's signature and audience server-side. There is
 * deliberately no Google **client secret** anywhere in the browser bundle,
 * because the flow used here never exchanges an authorization code.
 *
 * What genuinely must never appear: `masterKey`, `readOnlyMasterKey`,
 * `maintenanceKey`, a database URI, an OAuth client secret, or an Admin password.
 */

type EnvironmentShape = Record<string, unknown>;

const environments: [string, EnvironmentShape][] = [
  ['environment.ts', environment as unknown as EnvironmentShape],
  ['environment.prod.ts', productionEnvironment as unknown as EnvironmentShape],
];

/** Keys the frontend environment is allowed to declare. */
const ALLOWED_ENVIRONMENT_KEYS = [
  'production',
  'appVersion',
  'apiUrl',
  'wsUrl',
  'parseAppId',
  'parseApiKey',
  'vapidPublicKey',
  'googleClientId',
];

/** Key names that would indicate a backend-only credential. */
const FORBIDDEN_KEY_FRAGMENTS = [
  'masterkey',
  'readonlymasterkey',
  'maintenancekey',
  'databaseuri',
  'mongodburi',
  'connectionstring',
  'clientsecret',
  'privatekey',
  'adminpassword',
  'password',
  'secret',
  'sessiontoken',
  'authdata',
];

function normalise(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

describe('frontend environment shape', () => {
  for (const [name, env] of environments) {
    it(`${name} declares only allow-listed keys`, () => {
      expect(Object.keys(env).sort()).toEqual([...ALLOWED_ENVIRONMENT_KEYS].sort());
    });

    it(`${name} contains no backend-only credential key`, () => {
      for (const key of Object.keys(env)) {
        const normalised = normalise(key);
        for (const forbidden of FORBIDDEN_KEY_FRAGMENTS) {
          expect(
            normalised.includes(forbidden),
            `${name} must not declare '${key}'`,
          ).toBe(false);
        }
      }
    });
  }
});

describe('no privileged credential value ships to the browser', () => {
  for (const [name, env] of environments) {
    const serialised = JSON.stringify(env);

    it(`${name} contains no MongoDB connection string`, () => {
      expect(/mongodb(\+srv)?:\/\//i.test(serialised)).toBe(false);
    });

    it(`${name} contains no credentials embedded in a URL`, () => {
      // e.g. https://user:pass@host
      expect(/:\/\/[^/@"\s]+:[^/@"\s]+@/.test(serialised)).toBe(false);
    });

    it(`${name} contains no Parse session token`, () => {
      expect(/\br:[A-Za-z0-9]{16,}\b/.test(serialised)).toBe(false);
    });

    it(`${name} carries no populated VAPID private material`, () => {
      // vapidPublicKey is public by definition; a private counterpart must not exist.
      expect('vapidPrivateKey' in env).toBe(false);
    });
  }
});

describe('parseApiKey is public client configuration, not a secret', () => {
  it('is a non-empty string used to identify the app', () => {
    expect(typeof environment.parseApiKey).toBe('string');
    expect(environment.parseApiKey.length).toBeGreaterThan(0);
  });

  it('is not shaped like a Parse master key reference', () => {
    // A master key would typically be surfaced under a master-ish name; assert the
    // environment exposes no such field at all.
    const env = environment as unknown as EnvironmentShape;
    expect('masterKey' in env).toBe(false);
    expect('readOnlyMasterKey' in env).toBe(false);
    expect('maintenanceKey' in env).toBe(false);
  });

  it('is sent only as the documented Parse client header', () => {
    // Guards against the key being repurposed as, say, an Authorization bearer.
    expect(environment.parseApiKey).not.toMatch(/^Bearer\s/i);
  });
});

describe('googleClientId is public configuration and carries no secret', () => {
  for (const [name, env] of environments) {
    it(`${name} declares no Google client secret`, () => {
      for (const key of Object.keys(env)) {
        expect(normalise(key)).not.toContain('googleclientsecret');
        expect(normalise(key)).not.toContain('googlesecret');
      }
      expect('googleClientSecret' in env).toBe(false);
    });

    it(`${name} declares only a public Google Web client id, if any`, () => {
      // A Google Web client id is public by design — it is embedded in the
      // sign-in page and identifies the application to Google. What must never
      // appear is a client *secret*; that is asserted above. An empty value is
      // equally valid and simply leaves the UI in its "not configured" state.
      const value = (env as {googleClientId?: unknown}).googleClientId;
      expect(typeof value).toBe('string');
      if (String(value).length > 0) {
        expect(String(value)).toMatch(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
      }
    });

    it(`${name} carries no Google credential or ID token`, () => {
      const serialised = JSON.stringify(env);
      // A Google ID token is a three-segment JWT beginning with a JOSE header.
      expect(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(serialised)).toBe(false);
    });
  }
});

describe('apiUrl configuration', () => {
  it('development points at localhost', () => {
    expect(environment.apiUrl).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)/);
  });

  it('production is not left pointing at localhost', () => {
    expect(productionEnvironment.apiUrl).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('production websocket uses TLS', () => {
    expect(productionEnvironment.wsUrl.startsWith('wss://')).toBe(true);
  });

  it('production flag is set correctly in each file', () => {
    expect(environment.production).toBe(false);
    expect(productionEnvironment.production).toBe(true);
  });
});
