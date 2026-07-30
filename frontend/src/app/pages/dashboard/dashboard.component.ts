/**
 * Dashboard Page
 *
 * This is the default landing page after login.
 * Add your project-specific dashboard widgets here.
 *
 * Example widgets you might add:
 *   - Welcome banner with user greeting
 *   - Stat cards (counts, KPIs)
 *   - Recent activity feed
 *   - Charts (status distribution, trends)
 *   - Pending items list
 */
import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PageTitleService } from '../../services/page-title.service';

@Component({
  selector: 'app-dashboard',
  imports: [
    TranslateModule,
    // Add your dashboard widget components here
  ],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy {
  private pageTitleService = inject(PageTitleService);
  private translate = inject(TranslateService);

  ngOnInit(): void {
    this.translate
      .get('nav.dashboard')
      .subscribe((t) => this.pageTitleService.setTitle(t));
  }

  ngOnDestroy(): void {
    this.pageTitleService.setTitle('');
  }
}
