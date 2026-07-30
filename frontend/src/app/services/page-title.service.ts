import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PageTitleService {
  title = signal('');
  showTitle = signal(true);
  showBack = signal(false);
  backRoute = signal<string | null>(null);

  // Selection state for bulk actions
  selectionCount = signal(0);
  private clearSelectionFn: (() => void) | null = null;

  // Search state for title bar
  showSearch = signal(false);
  searchPlaceholder = signal('Search...');
  searchLoading = signal(false);
  searchInitialValue = signal('');
  searchResetKey = signal(0);
  searchResultCount = signal<number | null>(null);
  private searchCallbackFn: ((term: string) => void) | null = null;

  setSearch(opts: { placeholder?: string; loading?: boolean; initialValue?: string; callback: (term: string) => void }): void {
    this.showSearch.set(true);
    this.searchPlaceholder.set(opts.placeholder ?? 'Search...');
    if (opts.loading !== undefined) this.searchLoading.set(opts.loading);
    this.searchInitialValue.set(opts.initialValue ?? '');
    this.searchResetKey.update(k => k + 1);
    this.searchCallbackFn = opts.callback;
  }

  updateSearchLoading(loading: boolean): void {
    this.searchLoading.set(loading);
  }

  onSearch(term: string): void {
    this.searchCallbackFn?.(term);
  }

  updateSearchResultCount(count: number | null): void {
    this.searchResultCount.set(count);
  }

  resetSearch(): void {
    this.showSearch.set(false);
    this.searchResultCount.set(null);
    this.searchCallbackFn = null;
  }

  setTitle(title: string): void {
    this.title.set(title);
  }

  setShowTitle(show: boolean): void {
    this.showTitle.set(show);
  }

  setBack(route: string | null): void {
    this.showBack.set(!!route);
    this.backRoute.set(route);
  }

  clearBack(): void {
    this.showBack.set(false);
    this.backRoute.set(null);
  }

  setSelection(count: number, clearFn: () => void): void {
    this.selectionCount.set(count);
    this.clearSelectionFn = clearFn;
  }

  clearSelection(): void {
    if (this.clearSelectionFn) {
      this.clearSelectionFn();
    }
    this.selectionCount.set(0);
  }

  resetSelection(): void {
    this.selectionCount.set(0);
    this.clearSelectionFn = null;
  }

  // Action buttons in title bar (e.g. Edit, Print)
  actionButtons = signal<{ icon: string; tooltip: string; callback: () => void; loading?: boolean; disabledWhenLoading?: boolean }[]>([]);

  setActionButton(config: { icon: string; tooltip: string; callback: () => void; loading?: boolean; disabledWhenLoading?: boolean }): void {
    this.actionButtons.update(btns => [...btns, config]);
  }

  setActionButtonsLoading(loading: boolean): void {
    this.actionButtons.update(btns =>
      btns.map(b => b.disabledWhenLoading !== false ? { ...b, loading } : b)
    );
  }

  clearActionButton(): void {
    this.actionButtons.set([]);
  }
}
