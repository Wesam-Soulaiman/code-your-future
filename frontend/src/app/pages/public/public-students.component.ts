import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import {
  PublicFilterOptions,
  PublicStudentCard,
  PublicTalentFilters,
  PublicTalentSort,
} from '../../models/PublicTalent';
import { ChangeLangService } from '../../services/change-lang.service';
import { PublicTalentApiService } from '../../services/dataService/public-talent-service';
import { PUBLIC_PAGE_SIZE, educationStatusKey } from '../../utils/public-talent-constants';

/**
 * Discover Talent — the public directory ⟨CP8⟩.
 *
 * ── Everybody here chose to be here ─────────────────────────────────────────
 * A card appears only for a Student whose Final Task is published and who
 * consented. That is decided server-side and this page cannot widen it: there
 * is no parameter it can send that returns anybody else.
 *
 * ── Filters, not search ─────────────────────────────────────────────────────
 * There is no free-text box, by decision. The filter values come from the
 * server and are built from what is actually published, so every option returns
 * at least one result — a dropdown offering a city with nobody in it looks
 * broken the first time somebody picks it.
 *
 * ── The filters live in the URL ─────────────────────────────────────────────
 * So a filtered view can be copied out of the address bar and sent to somebody,
 * and so the back button returns to what you were looking at rather than the
 * unfiltered top of the list.
 */
@Component({
  selector: 'cyf-public-students',
  imports: [TranslateModule, FormsModule, ButtonModule, RouterLink, AlertComponent],
  templateUrl: './public-students.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicStudentsComponent {
  private api = inject(PublicTalentApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  protected langService = inject(ChangeLangService);

  protected loading = signal(true);
  protected failed = signal(false);

  protected cards = signal<PublicStudentCard[]>([]);
  protected total = signal(0);
  protected skip = signal(0);

  protected options = signal<PublicFilterOptions>({
    targetRoles: [],
    cities: [],
    educationStatuses: [],
    technologies: [],
  });

  protected filters = signal<PublicTalentFilters>({});
  protected sort = signal<PublicTalentSort>('newest');

  /**
   * What is in the search box right now.
   *
   * Separate from `filters().search`, which is what has actually been asked
   * for. Typing should not fire a request per keystroke on an endpoint with no
   * session behind it, so the box holds a draft and a debounce promotes it.
   */
  protected searchDraft = signal('');
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Read the filters out of the URL once, then keep the two in step.
    const params = this.route.snapshot.queryParamMap;
    const initial: PublicTalentFilters = {};
    const role = params.get('role');
    if (role) initial.targetRole = role;
    const city = params.get('city');
    if (city) initial.city = city;
    const education = params.get('education');
    if (education) initial.educationStatus = education;
    const technologies = params.get('tech');
    if (technologies) initial.technologies = technologies.split(',').filter(Boolean);
    if (params.get('demo') === 'true') initial.hasDemo = true;
    const search = params.get('q');
    if (search) initial.search = search;
    this.filters.set(initial);
    this.searchDraft.set(search ?? '');
    if (params.get('sort') === 'oldest') this.sort.set('oldest');

    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    this.loadOptions();
    this.load();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  protected isEmpty = computed(() => !this.loading() && this.cards().length === 0);

  protected hasMore = computed(() => this.cards().length < this.total());

  protected activeCount = computed(() => {
    const filters = this.filters();
    return (
      (filters.targetRole ? 1 : 0) +
      (filters.city ? 1 : 0) +
      (filters.educationStatus ? 1 : 0) +
      (filters.technologies?.length ?? 0) +
      (filters.hasDemo ? 1 : 0) +
      (filters.search ? 1 : 0)
    );
  });

  protected photoSrc(card: PublicStudentCard): string {
    return card.photoUrl ? this.api.photoUrl(card.photoUrl) : '';
  }

  /** The first letter, for a card with no photo. Never an image of nobody. */
  protected initial(card: PublicStudentCard): string {
    return (card.name.trim()[0] ?? '?').toUpperCase();
  }

  /** A readable label for a stored education status, in either language. */
  protected educationLabel(value: string): string {
    return educationStatusKey(value);
  }

  protected isTechnologySelected(value: string): boolean {
    return (this.filters().technologies ?? []).includes(value);
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private loadOptions(): void {
    this.api.getFilterOptions().subscribe({
      next: (options) => {
        this.options.set(options);
        this.changeDetector.markForCheck();
      },
      // A missing filter list is not a broken page: the grid still works, it
      // simply cannot be narrowed. Failing the whole page over it would be
      // worse than showing it unfiltered.
      error: () => this.changeDetector.markForCheck(),
    });
  }

  private load(append = false): void {
    this.loading.set(true);
    this.failed.set(false);

    this.api
      .listStudents(
        this.filters(),
        { skip: append ? this.cards().length : 0, limit: PUBLIC_PAGE_SIZE },
        this.sort(),
      )
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.cards.update((current) => (append ? [...current, ...page.items] : page.items));
          this.total.set(page.total);
          this.skip.set(page.skip);
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.failed.set(true);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected loadMore(): void {
    if (this.loading() || !this.hasMore()) return;
    this.load(true);
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  /** Apply a change, put it in the URL, and reload from the first page. */
  private applyFilters(next: PublicTalentFilters): void {
    this.filters.set(next);

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        role: next.targetRole || null,
        city: next.city || null,
        education: next.educationStatus || null,
        tech: next.technologies?.length ? next.technologies.join(',') : null,
        demo: next.hasDemo ? 'true' : null,
        q: next.search || null,
        sort: this.sort() === 'oldest' ? 'oldest' : null,
      },
      // `replaceUrl` so ticking four filters does not leave four entries in the
      // back stack that a Visitor has to press through to leave the page.
      replaceUrl: true,
    });

    this.load();
  }

  protected setTargetRole(value: string): void {
    this.applyFilters({ ...this.filters(), targetRole: value || undefined });
  }

  protected setCity(value: string): void {
    this.applyFilters({ ...this.filters(), city: value || undefined });
  }

  protected setEducationStatus(value: string): void {
    this.applyFilters({ ...this.filters(), educationStatus: value || undefined });
  }

  protected toggleTechnology(value: string): void {
    const current = this.filters().technologies ?? [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    this.applyFilters({ ...this.filters(), technologies: next.length ? next : undefined });
  }

  protected toggleHasDemo(): void {
    this.applyFilters({ ...this.filters(), hasDemo: this.filters().hasDemo ? undefined : true });
  }

  /**
   * Type into the search box.
   *
   * Debounced, because every keystroke would otherwise be a database query on
   * an unauthenticated endpoint. 350ms is long enough to finish a word and
   * short enough that the grid feels like it is keeping up.
   */
  protected setSearch(value: string): void {
    this.searchDraft.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const term = value.trim();
      if ((this.filters().search ?? '') === term) return;
      this.applyFilters({ ...this.filters(), search: term || undefined });
    }, 350);
  }

  protected setSort(value: string): void {
    this.sort.set(value === 'oldest' ? 'oldest' : 'newest');
    this.applyFilters(this.filters());
  }

  protected clearFilters(): void {
    this.searchDraft.set('');
    clearTimeout(this.searchTimer);
    this.applyFilters({});
  }
}
