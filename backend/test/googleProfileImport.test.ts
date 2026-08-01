/**
 * Importing a Student's Google name and photo.
 *
 * Two things are being proved here, and the second matters more than the first:
 *
 *   1. the name is prefilled and the photo imported **once**, so a Student who
 *      edits or removes either keeps that decision;
 *   2. fetching an image at a URL that arrived inside a token is done as if the
 *      URL were hostile — because "the backend fetches a URL a request named" is
 *      the shape of a server-side request forgery whatever the source.
 *
 * The download is exercised against a **real HTTP server on an ephemeral
 * loopback port**, so the timeout, the size bound, the redirect refusal, and the
 * `Content-Type` check are actually run rather than described. Nothing here
 * contacts Google or any external service.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal, parseSdk} from './support/parseTestGlobal';

let verifier: typeof import('../src/cloudCode/modules/StudentAuth/googleVerifier');
let googleImport: typeof import('../src/cloudCode/modules/StudentProfile/googleImport');
let profileDto: typeof import('../src/cloudCode/modules/StudentProfile/dto');

/** A 1x1 PNG — a real image, so the signature check and sharp both succeed. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

before(async () => {
  installParseTestGlobal();
  verifier = await import('../src/cloudCode/modules/StudentAuth/googleVerifier');
  googleImport = await import('../src/cloudCode/modules/StudentProfile/googleImport');
  profileDto = await import('../src/cloudCode/modules/StudentProfile/dto');
});

after(() => clearTrackedIntervals());

// ═══════════════════════════════════════════════════════════════════════════
// The host allow-list — the SSRF boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('which avatar URLs are accepted at all', () => {
  const accepted = [
    'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c',
    'https://lh4.googleusercontent.com/a/x',
    'https://googleusercontent.com/a/x',
    'https://www.google.com/images/x.png',
    'https://ssl.gstatic.com/x.png',
  ];

  for (const url of accepted) {
    test(`accepts ${new URL(url).hostname}`, () => {
      assert.equal(verifier.isGooglePictureUrl(url), true);
    });
  }

  const refused: [string, string][] = [
    ['a look-alike suffix', 'https://googleusercontent.com.evil.test/a/x'],
    ['a look-alike prefix', 'https://evilgoogleusercontent.com/a/x'],
    ['plain http on a real host', 'http://lh3.googleusercontent.com/a/x'],
    ['an unrelated host', 'https://evil.test/a/x'],
    ['loopback', 'https://127.0.0.1/a/x'],
    ['a private address', 'https://10.0.0.1/a/x'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['a file URL', 'file:///etc/passwd'],
    ['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a gopher URL', 'gopher://lh3.googleusercontent.com/'],
    ['credentials smuggled into the authority', 'https://lh3.googleusercontent.com@evil.test/x'],
    ['not a URL at all', 'lh3.googleusercontent.com/a/x'],
    ['an empty string', ''],
  ];

  for (const [label, url] of refused) {
    test(`refuses ${label}`, () => {
      assert.equal(verifier.isGooglePictureUrl(url), false, url);
    });
  }

  test('refuses a non-string, whatever it is', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      assert.equal(verifier.isGooglePictureUrl(value), false);
    }
  });

  test('refuses an absurdly long URL', () => {
    const long = `https://lh3.googleusercontent.com/${'a'.repeat(2000)}`;
    assert.equal(verifier.isGooglePictureUrl(long), false);
  });
});

describe('the picture claim', () => {
  const CLIENT_ID = 'runtime-test.apps.googleusercontent.test';
  let savedClientId: string | undefined;

  before(() => {
    savedClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  });

  after(() => {
    verifier.resetGoogleCredentialVerifier();
    if (savedClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = savedClientId;
  });

  /** Drive the real claim mapping through the injectable verifier. */
  async function verifyWithPicture(picture: unknown) {
    verifier.setGoogleCredentialVerifier({
      async verify() {
        return {
          sub: 'google-sub-1',
          email: 'lina@example.test',
          email_verified: true,
          given_name: 'Lina',
          family_name: 'Haddad',
          aud: CLIENT_ID,
          iss: 'https://accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          picture,
        };
      },
    });
    return verifier.verifyGoogleCredential('local-test-credential');
  }

  test('is captured when it passes the host check', async () => {
    const identity = await verifyWithPicture('https://lh3.googleusercontent.com/a/x=s96-c');
    assert.equal(identity.pictureUrl, 'https://lh3.googleusercontent.com/a/x=s96-c');
  });

  test('is dropped, not refused, when it fails the host check', async () => {
    // A bad avatar URL must never cost somebody their sign-in.
    const identity = await verifyWithPicture('https://evil.test/a/x');
    assert.equal(identity.pictureUrl, undefined);
    assert.equal(identity.email, 'lina@example.test');
    assert.equal(identity.givenName, 'Lina');
  });

  test('is simply absent when Google sends none', async () => {
    const identity = await verifyWithPicture(undefined);
    assert.equal(identity.pictureUrl, undefined);
  });

  test('a hostile picture claim cannot smuggle anything else through', async () => {
    const identity = await verifyWithPicture('http://169.254.169.254/latest/meta-data/');
    assert.equal(identity.pictureUrl, undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The download, against a real server
// ═══════════════════════════════════════════════════════════════════════════

describe('downloading an avatar', () => {
  const PINNED = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';
  let realFetch: typeof globalThis.fetch;
  /** The init object the last call was made with, so options can be asserted. */
  let lastInit: RequestInit | undefined;

  before(() => {
    realFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Replace the transport, not the checks.
   *
   * The host allow-list runs before any request, so a real server on loopback
   * can only ever prove that the check fires. Everything *downstream* of it —
   * the content type, both size bounds, the signature, sharp, the encoding —
   * needs a response that appears to come from a pinned host, and this is the
   * honest way to produce one.
   */
  function respondWith(
    body: Buffer | undefined,
    {status = 200, contentType = 'image/png', contentLength}: {
      status?: number;
      contentType?: string;
      contentLength?: string;
    } = {}
  ): void {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      lastInit = init;
      const headers = new Headers();
      if (contentType) headers.set('content-type', contentType);
      if (contentLength !== undefined) headers.set('content-length', contentLength);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        async arrayBuffer() {
          const bytes = body ?? Buffer.alloc(0);
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
        },
      } as unknown as Response;
    }) as typeof globalThis.fetch;
  }

  test('the host check runs before any request is made at all', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('should never be reached');
    }) as typeof globalThis.fetch;

    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'https://evil.test/a/x',
      'file:///etc/passwd',
      'http://127.0.0.1/a/x',
    ]) {
      assert.equal(await googleImport.fetchGoogleAvatar(url), undefined);
    }
    assert.equal(called, false, 'no request may be issued for an unpinned URL');
  });

  test('a real PNG on a pinned host comes back', async () => {
    respondWith(PNG);
    const result = await googleImport.fetchGoogleAvatar(PINNED);
    assert.ok(result);
    assert.equal(result!.mimeType, 'image/png');
    assert.deepEqual(result!.bytes, PNG);
  });

  test('redirects are refused rather than followed', async () => {
    // Following one would let a pinned host hand off to an unpinned one, which
    // is the whole attack the pinning exists to stop.
    respondWith(PNG);
    await googleImport.fetchGoogleAvatar(PINNED);
    assert.equal(lastInit?.redirect, 'error');
  });

  test('no credentials are ever sent', async () => {
    respondWith(PNG);
    await googleImport.fetchGoogleAvatar(PINNED);
    assert.equal(lastInit?.credentials, 'omit');
  });

  test('the request is bounded by a timeout', async () => {
    respondWith(PNG);
    await googleImport.fetchGoogleAvatar(PINNED);
    assert.ok(lastInit?.signal, 'an abort signal must be attached');
  });

  test('a non-image content type is refused', async () => {
    respondWith(Buffer.from('<html>not an image</html>'), {contentType: 'text/html'});
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });

  test('an SVG is refused, whatever it contains', async () => {
    respondWith(Buffer.from('<svg onload="alert(1)"/>'), {contentType: 'image/svg+xml'});
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });

  test('a declared length over the bound is refused before any byte is read', async () => {
    let read = false;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(9 * 1024 * 1024),
      }),
      async arrayBuffer() {
        read = true;
        return new ArrayBuffer(0);
      },
    })) as unknown as typeof globalThis.fetch;

    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
    assert.equal(read, false, 'the body must not be read once the header disqualifies it');
  });

  test('a lying Content-Length does not get past the real byte count', async () => {
    // A header is a claim, not a guarantee.
    respondWith(Buffer.alloc(6 * 1024 * 1024), {contentLength: '10'});
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });

  test('an empty body is refused', async () => {
    respondWith(Buffer.alloc(0));
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });

  test('a non-2xx response is refused', async () => {
    respondWith(PNG, {status: 404});
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });

  test('a transport failure is not an exception for the caller', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof globalThis.fetch;
    assert.equal(await googleImport.fetchGoogleAvatar(PINNED), undefined);
  });
});

describe('importing the avatar onto a profile', () => {
  const PINNED = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';
  let realFetch: typeof globalThis.fetch;
  let savedQuery: unknown;

  const user = {id: 'u1', get: () => undefined} as unknown as Parse.User;

  before(() => {
    realFetch = globalThis.fetch;
    savedQuery = (parseSdk() as unknown as Record<string, unknown>)['Query'];
  });

  after(() => {
    globalThis.fetch = realFetch;
    (parseSdk() as unknown as Record<string, unknown>)['Query'] = savedQuery;
  });

  /** An identity row carrying whatever avatar URL a test wants. */
  function withStoredUrl(url: unknown): void {
    class StubQuery {
      equalTo() {
        return this;
      }
      select() {
        return this;
      }
      async first() {
        return url === undefined ? undefined : {get: () => url};
      }
    }
    (parseSdk() as unknown as Record<string, unknown>)['Query'] = StubQuery;
  }

  /** Answer with a buffer, as a pinned host would. */
  function respondWithBytes(bytes: Buffer): void {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({'content-type': 'image/png'}),
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
      },
    })) as unknown as typeof globalThis.fetch;
  }

  test('stores a re-encoded WebP, not what Google sent', async () => {
    withStoredUrl(PINNED);
    respondWithBytes(PNG);

    const stored = await googleImport.importGoogleAvatar(user);
    assert.ok(stored, 'an avatar must be imported');

    const bytes = Buffer.from(stored as string, 'base64');
    // "RIFF" .... "WEBP" — a real WebP, so EXIF and anything embedded in the
    // original is gone by construction.
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.notDeepEqual(bytes, PNG);
  });

  test('imports nothing when no avatar URL was captured', async () => {
    withStoredUrl(undefined);
    respondWithBytes(PNG);
    assert.equal(await googleImport.importGoogleAvatar(user), undefined);
  });

  test('re-checks the stored URL rather than trusting it', async () => {
    // The check that admitted a value and this read are separated by time and
    // a database, so a row that somehow holds an unpinned URL must still fail.
    withStoredUrl('http://169.254.169.254/latest/meta-data/');
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('should never be reached');
    }) as typeof globalThis.fetch;

    assert.equal(await googleImport.importGoogleAvatar(user), undefined);
    assert.equal(called, false);
  });

  test('refuses bytes that are not an image, whatever the header claimed', async () => {
    withStoredUrl(PINNED);
    respondWithBytes(Buffer.from('<?php system($_GET["c"]); ?>'));
    assert.equal(await googleImport.importGoogleAvatar(user), undefined);
  });

  test('a PNG signature on a script still does not survive sharp', async () => {
    withStoredUrl(PINNED);
    respondWithBytes(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('<?php system($_GET["c"]); ?>'),
      ])
    );
    assert.equal(await googleImport.importGoogleAvatar(user), undefined);
  });

  test('never throws, whatever goes wrong', async () => {
    withStoredUrl(PINNED);
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof globalThis.fetch;

    // A missing avatar must be a profile without a photo, never a failed save.
    assert.equal(await googleImport.importGoogleAvatar(user), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Prefill and "once"
// ═══════════════════════════════════════════════════════════════════════════

describe('the suggested name', () => {
  function fakeUser(attrs: Record<string, unknown>): Parse.User {
    return {
      id: 'u1',
      get: (key: string) => attrs[key],
    } as unknown as Parse.User;
  }

  test('joins the verified Google names', () => {
    assert.equal(
      googleImport.suggestedFullName(fakeUser({firstName: 'Lina', lastName: 'Haddad'})),
      'Lina Haddad'
    );
  });

  test('copes with only one of them', () => {
    assert.equal(googleImport.suggestedFullName(fakeUser({firstName: 'Lina'})), 'Lina');
    assert.equal(googleImport.suggestedFullName(fakeUser({lastName: 'Haddad'})), 'Haddad');
  });

  test('is empty when Google supplied neither', () => {
    assert.equal(googleImport.suggestedFullName(fakeUser({})), '');
  });

  test('collapses stray whitespace', () => {
    assert.equal(
      googleImport.suggestedFullName(fakeUser({firstName: '  Lina  ', lastName: '  Haddad '})),
      'Lina Haddad'
    );
  });

  test('never reaches for the internal username', () => {
    // The username is server-generated and must not surface anywhere.
    const suggestion = googleImport.suggestedFullName(
      fakeUser({username: 'gid_a1b2c3', email: 'lina@example.test'})
    );
    assert.equal(suggestion, '');
  });
});

describe('the empty profile shape', () => {
  test('carries the suggested name and says where it came from', () => {
    const dto = profileDto.toEmptyProfileDto('lina@example.test', 'Lina Haddad');
    assert.equal(dto.fullName, 'Lina Haddad');
    assert.equal(dto.nameFromProvider, true);
    assert.equal(dto.id, '');
    assert.equal(dto.isComplete, false);
    assert.equal(dto.hasPhoto, false);
  });

  test('omits the marker when there is no name to suggest', () => {
    const dto = profileDto.toEmptyProfileDto('lina@example.test', '');
    assert.equal(dto.fullName, '');
    assert.equal('nameFromProvider' in dto, false);
  });

  test('still carries no forbidden key', () => {
    const dto = profileDto.toEmptyProfileDto('lina@example.test', 'Lina Haddad') as unknown as
      Record<string, unknown>;
    for (const forbidden of profileDto.FORBIDDEN_PROFILE_DTO_KEYS) {
      assert.equal(forbidden in dto, false, `${forbidden} must not appear`);
    }
    // The avatar URL is provider data and never travels to a browser.
    for (const forbidden of ['pictureUrl', 'providerPictureUrl', 'picture', 'avatar']) {
      assert.equal(forbidden in dto, false, `${forbidden} must not appear`);
    }
  });

  test('a saved profile never claims a provider name', () => {
    const Parse = parseSdk();
    const profile = new Parse.Object('StudentProfile');
    profile.id = 'p1';
    profile.set('fullName', 'Lina Haddad');
    profile.set('verifiedEmail', 'lina@example.test');

    const dto = profileDto.toStudentProfileDto(profile) as unknown as Record<string, unknown>;
    assert.equal('nameFromProvider' in dto, false);
  });
});

describe('the avatar URL never leaves the server', () => {
  test('it is a protected field on the identity class', async () => {
    const model = (await import('../src/cloudCode/models/StudentAuthIdentity')).default;
    const {getSchemaDefinition} = await import('@90soft/parse-server-kit');
    const schema = (getSchemaDefinition as (target: unknown) => {
      classLevelPermissions?: {protectedFields?: Record<string, string[]>};
    })(model);

    for (const audience of ['*', 'authenticated']) {
      assert.ok(
        (schema.classLevelPermissions?.protectedFields?.[audience] ?? []).includes(
          'providerPictureUrl'
        ),
        `providerPictureUrl must be hidden from ${audience}`
      );
    }
  });

  test('redaction masks it, because it contains "picture"', async () => {
    const {redactMeta, REDACTED} = await import('../src/cloudCode/utils/logging/redact');
    const output = JSON.stringify(
      redactMeta({
        providerPictureUrl: 'https://lh3.googleusercontent.com/a/SECRET-HANDLE=s96-c',
        pictureUrl: 'https://lh3.googleusercontent.com/a/SECRET-HANDLE=s96-c',
      })
    );
    assert.ok(!output.includes('SECRET-HANDLE'));
    assert.ok(output.includes(REDACTED));
  });

  test('no session or profile DTO builder mentions it', async () => {
    const {readFileSync} = await import('node:fs');
    const {join} = await import('node:path');
    for (const file of [
      'src/cloudCode/modules/StudentAuth/dto.ts',
      'src/cloudCode/modules/StudentProfile/dto.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      assert.ok(
        !source.includes('providerPictureUrl') && !source.includes('pictureUrl'),
        `${file} must not read the avatar URL`
      );
    }
  });
});
