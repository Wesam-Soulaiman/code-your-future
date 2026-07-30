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
import { SessionService } from './services/session.service';
import { AuthApiService } from './services/dataService/user-service';
import { ChangeLangService } from './services/change-lang.service';
import { SwitchThemeService } from './services/switch-theme.service';
import { catchError, firstValueFrom, of, tap } from 'rxjs';

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
    }),

    /**
     * Session restoration. Fetches the safe current-user DTO (no session token,
     * no email, no phone) and clears local state if the token is rejected.
     */
    provideAppInitializer(async () => {
      const session = inject(SessionService);
      const authApi = inject(AuthApiService);
      if (session.isLoggedIn()) {
        await firstValueFrom(
          authApi.getCurrentUser().pipe(
            tap((user) => session.saveSession(user, session.token()!)),
            catchError(() => {
              session.clearSession();
              return of(null);
            }),
          ),
        );
      }
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
