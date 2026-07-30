import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { finalize } from 'rxjs';

import { ChangeLangService } from '../../services/change-lang.service';
import { SessionService } from '../../services/session.service';
import { SwitchThemeService } from '../../services/switch-theme.service';
import { ToastService } from '../../services/toast.service';
import { UserService } from '../../services/dataService/user-service';
import { User } from '../../models/User';

@Component({
  selector: 'app-auth',
  imports: [TranslateModule, ButtonModule, InputTextModule, FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthComponent implements OnInit, OnDestroy {
  private userService = inject(UserService);
  private sessionService = inject(SessionService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  protected langService = inject(ChangeLangService);
  protected themeService = inject(SwitchThemeService);
  isDarkMode = signal(this.themeService.getCurrentTheme() === 'dark');

  readonly images = [
    'images/login1.webp',
    'images/login2.webp',
    'images/login3.webp',
    'images/login4.webp',
    'images/login5.webp',
    'images/login6.webp',
  ];
  activeIndex = signal(0);
  private intervalId?: ReturnType<typeof setInterval>;

  loading = signal(false);
  username = signal('');
  password = signal('');

  ngOnInit(): void {
    this.intervalId = setInterval(() => {
      this.activeIndex.set((this.activeIndex() + 1) % this.images.length);
    }, 3000);
  }

  ngOnDestroy(): void {
    clearInterval(this.intervalId);
  }

  changeLang(lang: string): void {
    this.langService.changeLang(lang as 'en' | 'ar');
  }

  login(): void {
    if (!this.username().trim() || !this.password().trim()) {
      this.toastService.warn('Please fill in all fields');
      return;
    }

    this.loading.set(true);

    this.userService
      .login({
        username: this.username(),
        password: this.password(),
      })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res: User) => {
          if (!res.sessionToken) return;

          this.sessionService.saveSession(res, res.sessionToken);
          this.router.navigate(['/']);
        },
      });
  }
}
