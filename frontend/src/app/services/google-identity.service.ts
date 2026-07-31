import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Google Identity Services — the official current browser sign-in flow.
 *
 * This service is a thin, testable wrapper around Google's `gsi/client` library.
 * It does not implement OAuth or JWT: it loads Google's script, hands it the
 * public Client ID, and forwards the credential Google returns to a callback.
 * All verification happens on the backend.
 *
 * ── What is deliberately not done here ──────────────────────────────────────
 *   - the credential is never stored, never logged, and never put in a URL;
 *   - no client secret exists in the browser — this flow issues an ID token
 *     directly and never exchanges an authorization code;
 *   - the script is loaded **only** when the Student page asks for it, so a
 *     visitor who never opens that page contacts Google not at all.
 *
 * `injectScript()` is the single seam over the DOM and the network, so tests
 * subclass this service instead of stubbing globals.
 */

/** Where the wrapper has got to. */
export type GoogleIdentityState =
  | 'idle'
  | 'notConfigured'
  | 'loading'
  | 'ready'
  | 'unavailable';

/** Google's callback payload. Only `credential` is used. */
interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleButtonOptions {
  theme?: string;
  size?: string;
  shape?: string;
  text?: string;
  width?: number;
  locale?: string;
  logo_alignment?: string;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    cancel_on_tap_outside?: boolean;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(host: HTMLElement, options: GoogleButtonOptions): void;
  disableAutoSelect(): void;
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Google's button language comes from the **script URL** (`?hl=`), not from the
 * `locale` option on `renderButton`.
 *
 * Verified in a real browser: with `locale: 'ar'` passed to `renderButton`, the
 * parameter never reached Google's button iframe and the control rendered in
 * Dutch on both an English and an Arabic page. Loading the script as
 * `gsi/client?hl=ar` produced "المواصلة باستخدام Google", and `?hl=en` produced
 * "Continue with Google". `locale` is still passed as well — it is the
 * documented option, so honouring it again later costs us nothing.
 *
 * The consequence is that changing language must reload Google's script, which
 * is what `initialize()` does when the requested locale differs.
 */

@Injectable({
  providedIn: 'root',
})
export class GoogleIdentityService {
  private stateSignal = signal<GoogleIdentityState>('idle');
  readonly state = this.stateSignal.asReadonly();

  private loadPromise: Promise<boolean> | null = null;
  private initialized = false;
  /** The language Google's script was last loaded with. */
  private loadedLocale: string | null = null;

  /** The public Client ID, or an empty string when the app is unconfigured. */
  get clientId(): string {
    return (environment.googleClientId ?? '').trim();
  }

  isConfigured(): boolean {
    return this.clientId.length > 0;
  }

  /**
   * Load Google's library and initialise it with the credential handler.
   *
   * Resolves `true` when Google is ready to render a button, `false` for every
   * other outcome — missing configuration, a blocked or failed script, or an
   * environment with no DOM. Callers render their own explanation from
   * `state()`; nothing here throws at a component.
   */
  async initialize(
    onCredential: (credential: string) => void,
    locale = 'en',
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      this.stateSignal.set('notConfigured');
      return false;
    }

    // A language change needs a fresh script: `hl` is fixed at load time.
    if (this.loadedLocale !== null && this.loadedLocale !== locale) {
      this.unload();
    }

    if (this.stateSignal() === 'ready' && this.initialized) return true;

    this.stateSignal.set('loading');

    if (!this.loadPromise) {
      this.loadedLocale = locale;
      this.loadPromise = this.injectScript(locale).catch(() => false);
    }

    const loaded = await this.loadPromise;
    const api = this.api();

    if (!loaded || !api) {
      // A blocked script, an offline browser, or a tracking-protection
      // extension. The page falls back to an explained, disabled control.
      this.loadPromise = null;
      this.loadedLocale = null;
      this.stateSignal.set('unavailable');
      return false;
    }

    if (!this.initialized) {
      api.initialize({
        client_id: this.clientId,
        callback: (response: GoogleCredentialResponse) => {
          const credential = response?.credential;
          // A response with no credential is a dismissal, not a sign-in.
          if (typeof credential === 'string' && credential.length > 0) {
            onCredential(credential);
          }
        },
        // Never sign somebody in without an explicit action.
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      this.initialized = true;
    }

    this.stateSignal.set('ready');
    return true;
  }

  /**
   * Render Google's own button into `host`.
   *
   * Google's button is used rather than a look-alike: it is the supported entry
   * point for this flow, it carries Google's required branding, and it localises
   * itself from `locale`. It sits in the same slot the page already reserved, so
   * nothing about the layout changes.
   */
  renderButton(host: HTMLElement, locale: string, width?: number): void {
    const api = this.api();
    if (!api || this.stateSignal() !== 'ready') return;

    host.innerHTML = '';
    api.renderButton(host, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      logo_alignment: 'center',
      locale,
      ...(width ? { width } : {}),
    });
  }

  /** Forget any remembered account, so the next visitor must choose again. */
  disableAutoSelect(): void {
    this.api()?.disableAutoSelect();
  }

  /**
   * Drop Google's script so it can be reloaded in another language.
   *
   * Removing the global is deliberate: the library caches its language at load
   * time, so leaving the old instance in place would keep serving the old
   * button. Nothing else in the application reads `window.google`.
   */
  private unload(): void {
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll(`script[src^="${GSI_SRC}"]`)
        .forEach((script) => script.remove());
    }
    delete (globalThis as unknown as {google?: unknown }).google;
    this.loadPromise = null;
    this.loadedLocale = null;
    this.initialized = false;
    this.stateSignal.set('idle');
  }

  /** The Google API object, when the library has loaded. */
  protected api(): GoogleIdApi | undefined {
    const google = (globalThis as unknown as {
      google?: { accounts?: { id?: GoogleIdApi } };
    }).google;
    return google?.accounts?.id;
  }

  /**
   * Add Google's script tag exactly once. The only place this service touches
   * the DOM or the network — overridden wholesale in tests.
   */
  protected injectScript(locale = 'en'): Promise<boolean> {
    if (typeof document === 'undefined') return Promise.resolve(false);

    const src = `${GSI_SRC}?hl=${encodeURIComponent(locale)}`;
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing && this.api()) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const script = existing ?? document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => resolve(true), { once: true });
      script.addEventListener('error', () => resolve(false), { once: true });
      if (!existing) document.head.appendChild(script);
    });
  }
}
