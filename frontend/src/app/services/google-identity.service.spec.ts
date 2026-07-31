import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../environments/environment';
import { GoogleIdentityService } from './google-identity.service';

/**
 * The Google Identity Services wrapper.
 *
 * **Nothing here loads Google's script or contacts Google.** `injectScript` is
 * the single seam over the DOM and the network, so a subclass replaces it and
 * every state — unconfigured, blocked script, ready — is driven deterministically.
 */

interface FakeGoogleApi {
  initialize: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
  disableAutoSelect: ReturnType<typeof vi.fn>;
}

/** A test double that reports a scripted load outcome and a scripted API. */
class TestableGoogleIdentityService extends GoogleIdentityService {
  scriptLoads = true;
  scriptCalls = 0;
  requestedLocales: string[] = [];
  fakeApi: FakeGoogleApi | undefined;

  protected override injectScript(locale = 'en'): Promise<boolean> {
    this.scriptCalls += 1;
    this.requestedLocales.push(locale);
    return Promise.resolve(this.scriptLoads);
  }

  protected override api() {
    return this.fakeApi as never;
  }
}

function makeApi(): FakeGoogleApi {
  return {
    initialize: vi.fn(),
    renderButton: vi.fn(),
    disableAutoSelect: vi.fn(),
  };
}

function service(clientId: string): TestableGoogleIdentityService {
  environment.googleClientId = clientId;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: GoogleIdentityService, useClass: TestableGoogleIdentityService },
    ],
  });
  return TestBed.inject(GoogleIdentityService) as TestableGoogleIdentityService;
}

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const originalClientId = environment.googleClientId;

describe('GoogleIdentityService', () => {
  beforeEach(() => {
    environment.googleClientId = originalClientId;
  });

  describe('configuration', () => {
    it('reports unconfigured when no client id is set', async () => {
      const google = service('');
      expect(google.isConfigured()).toBe(false);

      const ready = await google.initialize(() => {});
      expect(ready).toBe(false);
      expect(google.state()).toBe('notConfigured');
    });

    it('loads no script at all when unconfigured', async () => {
      const google = service('');
      await google.initialize(() => {});
      // Nothing is fetched, so a visitor who never signs in contacts Google not
      // at all.
      expect(google.scriptCalls).toBe(0);
    });

    it('treats a whitespace-only client id as unconfigured', async () => {
      const google = service('   ');
      expect(google.isConfigured()).toBe(false);
      expect(await google.initialize(() => {})).toBe(false);
    });

    it('reports configured for a real client id', () => {
      expect(service(CLIENT_ID).isConfigured()).toBe(true);
    });
  });

  describe('a blocked or failing script', () => {
    it('ends in the unavailable state rather than throwing', async () => {
      const google = service(CLIENT_ID);
      google.scriptLoads = false;

      const ready = await google.initialize(() => {});
      expect(ready).toBe(false);
      expect(google.state()).toBe('unavailable');
    });

    it('is unavailable when the script loads but exposes no API', async () => {
      const google = service(CLIENT_ID);
      google.scriptLoads = true;
      google.fakeApi = undefined;

      expect(await google.initialize(() => {})).toBe(false);
      expect(google.state()).toBe('unavailable');
    });

    it('renders nothing when it is not ready', async () => {
      const google = service(CLIENT_ID);
      google.scriptLoads = false;
      await google.initialize(() => {});

      const host = document.createElement('div');
      google.renderButton(host, 'en');
      expect(host.innerHTML).toBe('');
    });
  });

  describe('a successful load', () => {
    it('becomes ready and initialises Google with the public client id', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();

      expect(await google.initialize(() => {})).toBe(true);
      expect(google.state()).toBe('ready');

      const config = google.fakeApi.initialize.mock.calls[0][0];
      expect(config.client_id).toBe(CLIENT_ID);
    });

    it('never signs anybody in automatically', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();
      await google.initialize(() => {});

      const config = google.fakeApi.initialize.mock.calls[0][0];
      expect(config.auto_select).toBe(false);
    });

    it('forwards a credential to the caller', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();
      const received: string[] = [];
      await google.initialize((credential) => received.push(credential));

      const config = google.fakeApi.initialize.mock.calls[0][0];
      config.callback({ credential: 'header.payload.signature' });
      expect(received).toEqual(['header.payload.signature']);
    });

    it('ignores a response that carries no credential', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();
      const received: string[] = [];
      await google.initialize((credential) => received.push(credential));

      const config = google.fakeApi.initialize.mock.calls[0][0];
      config.callback({});
      config.callback({ credential: '' });
      expect(received).toEqual([]);
    });

    it('initialises Google only once across repeated calls', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();

      await google.initialize(() => {});
      await google.initialize(() => {});
      expect(google.fakeApi.initialize).toHaveBeenCalledTimes(1);
    });

    it('loads the library for the requested language', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();

      await google.initialize(() => {}, 'ar');
      expect(google.requestedLocales).toEqual(['ar']);
    });

    it('reloads the library when the language changes', async () => {
      // Google fixes the button language when its script loads, so a language
      // switch has to fetch the script again — verified in a real browser,
      // where `renderButton({locale})` alone left the button in the old
      // language.
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();

      await google.initialize(() => {}, 'en');
      await google.initialize(() => {}, 'ar');

      expect(google.requestedLocales).toEqual(['en', 'ar']);
      expect(google.scriptCalls).toBe(2);
      expect(google.state()).toBe('ready');
    });

    it('does not reload when the language is unchanged', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();

      await google.initialize(() => {}, 'ar');
      await google.initialize(() => {}, 'ar');
      expect(google.scriptCalls).toBe(1);
    });

    it('renders Google’s button with the requested locale', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();
      await google.initialize(() => {});

      const host = document.createElement('div');
      google.renderButton(host, 'ar');

      const [target, options] = google.fakeApi.renderButton.mock.calls[0];
      expect(target).toBe(host);
      expect(options.locale).toBe('ar');
    });

    it('replaces any previous button rather than stacking them', async () => {
      const google = service(CLIENT_ID);
      google.fakeApi = makeApi();
      await google.initialize(() => {});

      const host = document.createElement('div');
      host.innerHTML = '<span>stale</span>';
      google.renderButton(host, 'en');
      expect(host.innerHTML).toBe('');
    });
  });

  it('never stores a credential anywhere', async () => {
    localStorage.clear();
    const google = service(CLIENT_ID);
    google.fakeApi = makeApi();
    await google.initialize(() => {});

    const config = google.fakeApi.initialize.mock.calls[0][0];
    config.callback({ credential: 'header.payload.signature' });

    expect(JSON.stringify(localStorage)).not.toContain('header.payload.signature');
    expect(JSON.stringify(sessionStorage)).not.toContain('header.payload.signature');
  });
});
