import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withHashLocation, withViewTransitions } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { httpInterceptor } from './services/http.interceptor';
import { MyPreset } from './theme';
import { StudentAuthApiService } from './services/dataService/student-auth-service';
import { ChangeLangService } from './services/change-lang.service';
import { PrimeNgLocaleService } from './services/primeng-locale.service';
import { SwitchThemeService } from './services/switch-theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([httpInterceptor])),
    MessageService,
    ConfirmationService,

    /**
     * Language, direction, and theme initialization.
     *
     * Runs during bootstrap — before the router activates any route — so `/auth`
     * renders with the correct language AND the correct document direction from
     * the very first paint. Previously `initLang()` was called only from
     * `ShellComponent.ngOnInit`, so a cold load of `/auth` with `lang=ar` applied
     * RTL (via the service's effect) while leaving the text in English, and no
     * flash-free path existed for unauthenticated screens.
     *
     * Registered before the session initializer so the "restoring session" phase
     * is already correctly localised.
     */
    provideAppInitializer(() => {
      inject(ChangeLangService).initLang();
      inject(SwitchThemeService).initTheme();
      // PrimeNG does not read @ngx-translate: its DatePicker draws month and
      // day names from its own translation object, which defaults to English.
      // Instantiating the service here wires the two together before the first
      // paint and keeps them in step afterwards ⟨CP3A catalog⟩.
      inject(PrimeNgLocaleService).apply(inject(ChangeLangService).currentLang());
    }),

    /**
     * Session restoration.
     *
     * Fetches the safe, role-agnostic session DTO (no session token, no
     * username, no email, no phone) and clears local state if the token is
     * rejected. It runs for Admins and Students alike, and it is **awaited**, so
     * the router never activates a route while `status()` is still `restoring` —
     * that is what keeps a guard from deciding on unproven cached roles, and
     * what prevents a flash of protected content.
     *
     * `restoreSession()` shares one in-flight request, so a guard asking at the
     * same moment does not cause a second call.
     */
    provideAppInitializer(async () => {
      await inject(StudentAuthApiService).restoreSession();
    }),

    provideRouter(routes, withHashLocation(), withViewTransitions()),
    providePrimeNG({
      theme: {
        preset: MyPreset,
        options: {
          darkModeSelector: '.dark',
        },
      },
    }),
    provideTranslateService({
      loader: provideTranslateHttpLoader({
        prefix: './i18n/',
        suffix: '.json',
      }),
      fallbackLang: 'en',
      // The initial language comes from ChangeLangService.initLang() above, which
      // reads the persisted preference. A hardcoded `lang` here would race it.
      lang: 'en',
    }),
  ],
};
