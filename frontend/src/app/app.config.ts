import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation, withViewTransitions } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { ConfirmationService, MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
import { httpInterceptor } from './services/http.interceptor';
import { MyPreset } from './theme';
import { SessionService } from './services/session.service';
import { UserService } from './services/dataService/user-service';
import { catchError, firstValueFrom, of, tap } from 'rxjs';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([httpInterceptor])),
    MessageService,
    ConfirmationService,
    provideAppInitializer(async () => {
      const session = inject(SessionService);
      const userService = inject(UserService);
      if (session.isLoggedIn()) {
        await firstValueFrom(
          userService.getCurrentUser().pipe(
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
      lang: 'en',
    }),
  ],
};
