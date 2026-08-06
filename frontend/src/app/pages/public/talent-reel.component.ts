import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { finalize } from 'rxjs';

import { PublicReelItem } from '../../models/PublicTalent';
import { PublicTalentApiService } from '../../services/dataService/public-talent-service';
import {
  PUBLIC_REEL_PAGE_SIZE,
  REEL_PREFETCH_THRESHOLD,
} from '../../utils/public-talent-constants';

/**
 * The Talent Reel ⟨CP8⟩ — one project per screen, scrolled vertically.
 *
 * ── Only one video is ever mounted ──────────────────────────────────────────
 * This is the constraint the whole component is built around. Every item is a
 * poster image; exactly one of them — the one filling the screen — is swapped
 * for an iframe. Scrolling away removes it, which is what "scrolling pauses the
 * previous video" means when the player belongs to YouTube: the element is
 * gone, so there is nothing left to be playing.
 *
 * Mounting all of them and pausing the others would mean a YouTube player per
 * item, each with its own network activity, on a page somebody might scroll
 * through fifty times.
 *
 * ── Which item is current is decided by the browser, not by us ──────────────
 * An `IntersectionObserver` on the scroll container reports which panel is
 * mostly on screen. Computing it from scroll offsets would mean re-deriving
 * something the browser already knows, and getting it wrong at every viewport
 * height.
 *
 * ── Pages are fetched as somebody approaches the end ────────────────────────
 * Never all at once. A Visitor who opens the page and leaves has loaded six
 * items and one player.
 */
@Component({
  selector: 'cyf-talent-reel',
  imports: [TranslateModule, RouterLink],
  templateUrl: './talent-reel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TalentReelComponent implements AfterViewInit {
  private api = inject(PublicTalentApiService);
  private sanitizer = inject(DomSanitizer);
  private changeDetector = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected loading = signal(true);
  protected failed = signal(false);
  protected items = signal<PublicReelItem[]>([]);
  protected total = signal(0);
  protected currentIndex = signal(0);

  /** Whether the Visitor has asked for sound. Starts off; nothing autoplays. */
  protected started = signal(false);

  private observer?: IntersectionObserver;

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  ngAfterViewInit(): void {
    this.observe();
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  protected isEmpty = computed(() => !this.loading() && this.items().length === 0);

  protected hasMore = computed(() => this.items().length < this.total());

  protected positionLabel = computed(() => ({
    current: Math.min(this.currentIndex() + 1, this.items().length),
    total: this.total(),
  }));

  /** Whether this index is the one on screen, and therefore the one that plays. */
  protected isCurrent(index: number): boolean {
    return this.currentIndex() === index;
  }

  protected photoSrc(item: PublicReelItem): string {
    return item.photoUrl ? this.api.photoUrl(item.photoUrl) : '';
  }

  /** The first letter, for somebody with no photo. Never an image of nobody. */
  protected initial(item: PublicReelItem): string {
    return (item.name.trim()[0] ?? '?').toUpperCase();
  }

  protected posterFor(item: PublicReelItem): string {
    return `https://i.ytimg.com/vi/${encodeURIComponent(item.video.videoId)}/hqdefault.jpg`;
  }

  /**
   * The embed URL for the one item that is playing.
   *
   * The id shape is re-checked here rather than the server's string being
   * trusted wholesale, so nothing but eleven safe characters can reach an
   * `iframe src`. `autoplay=1` is only ever applied to the current item, and
   * only after the Visitor pressed play once — the page is silent on arrival.
   */
  protected embedUrl(item: PublicReelItem): SafeResourceUrl | null {
    const id = item.video.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${id}?rel=0&autoplay=1&playsinline=1`,
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private load(append = false): void {
    this.loading.set(true);
    this.failed.set(false);

    this.api
      .listReel({}, { skip: append ? this.items().length : 0, limit: PUBLIC_REEL_PAGE_SIZE })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.items.update((current) => (append ? [...current, ...page.items] : page.items));
          this.total.set(page.total);
          this.changeDetector.markForCheck();
          // New panels exist now, so they need watching too.
          queueMicrotask(() => this.observe());
        },
        error: () => {
          this.failed.set(true);
          this.changeDetector.markForCheck();
        },
      });
  }

  /** Fetch the next page once the end is within a couple of screens. */
  private maybePrefetch(index: number): void {
    if (this.loading() || !this.hasMore()) return;
    if (index >= this.items().length - REEL_PREFETCH_THRESHOLD) this.load(true);
  }

  // ── Which item is on screen ───────────────────────────────────────────────

  /**
   * Watch the panels and follow whichever is mostly visible.
   *
   * Re-created after each page rather than incrementally observed: an observer
   * holding stale elements is a memory leak with a subtle failure mode, and
   * rebuilding a handful of observations costs nothing at this size.
   */
  private observe(): void {
    const root = this.scroller()?.nativeElement;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset['index'] ?? -1);
          if (index < 0 || index === this.currentIndex()) continue;
          this.currentIndex.set(index);
          this.maybePrefetch(index);
          this.changeDetector.markForCheck();
        }
      },
      // A panel counts as current once it is more than half on screen, which is
      // unambiguous: two panels cannot both be over 60% at the same time.
      { root, threshold: 0.6 },
    );

    for (const panel of Array.from(root.querySelectorAll('[data-index]'))) {
      this.observer.observe(panel);
    }
  }

  /**
   * Start playing.
   *
   * One press, for the whole session rather than per item — the product asks
   * for a reel, and making somebody press play on every screen would be a worse
   * page. Nothing plays before this: no autoplay on arrival.
   */
  protected start(): void {
    this.started.set(true);
  }
}
