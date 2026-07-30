import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule],
  template: `
    <router-outlet />
    <p-toast [preventOpenDuplicates]="true" />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
