import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PublicReelItem } from '../../models/PublicTalent';
import { useTranslations } from '../../testing/i18n-testing';
import { TalentReelComponent } from './talent-reel.component';

/**
 * The Talent Reel ⟨CP8⟩.
 *
 * The load-bearing assertion is the one about iframes: **exactly one exists at
 * a time**. Everything else on this page is presentation, but a page that
 * mounted a YouTube player per item would keep several running out of sight,
 * which is the behaviour the product explicitly ruled out.
 */

function reelItem(index: number, overrides: Partial<PublicReelItem> = {}): PublicReelItem {
  const id = `vid${String(index).padStart(8, '0')}`.slice(0, 11);
  return {
    slug: `slug${index}`,
    name: `Student ${index}`,
    targetRole: 'Frontend Developer',
    title: `Project ${index}`,
    technologies: ['Angular', 'Parse'],
    pinned: false,
    video: {
      videoId: id,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    },
    ...overrides,
  };
}

describe('TalentReelComponent ⟨CP8⟩', () => {
  let fixture: ComponentFixture<TalentReelComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TalentReelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TalentReelComponent);
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function iframes(): HTMLIFrameElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('iframe'));
  }

  /** Answer the first page request. */
  function firstPage(items: PublicReelItem[], total = items.length): void {
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentReels'),
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items, total, skip: 0, limit: 6 });
    fixture.detectChanges();
  }

  // ── The request ───────────────────────────────────────────────────────────

  it('asks for one page, not the whole reel', () => {
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentReels'),
    );
    // Small on purpose: each item is a full screen with a player behind it.
    expect(Number(request.request.params.get('limit'))).toBeLessThanOrEqual(12);
    expect(request.request.params.get('skip')).toBe('0');
    request.flush({ items: [], total: 0, skip: 0, limit: 6 });
  });

  it('sends no session token of its own', () => {
    // These pages are for people who have never signed in.
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentReels'),
    );
    expect(request.request.headers.get('X-Parse-Session-Token')).toBeNull();
    request.flush({ items: [], total: 0, skip: 0, limit: 6 });
  });

  it('marks a pinned reel and keeps the server order ⟨CP8C⟩', () => {
    // The server returned these in order. The page says why the first one is
    // first; it does not re-sort, which would fight the next page's ordering.
    firstPage([reelItem(1, { pinned: true }), reelItem(2)]);

    const panels = Array.from(
      fixture.nativeElement.querySelectorAll('.cyf-reel-panel'),
    ) as HTMLElement[];
    expect(panels[0].textContent).toContain('Student 1');
    expect(panels[0].textContent).toContain('Featured');
    expect(panels[1].textContent).not.toContain('Featured');
  });
  // ── Only one video ────────────────────────────────────────────────────────

  it('mounts no iframe at all before somebody presses play', () => {
    // Nothing autoplays on arrival, so the page is silent until asked.
    firstPage([reelItem(1), reelItem(2), reelItem(3)]);
    expect(iframes()).toHaveLength(0);
    expect(fixture.nativeElement.querySelectorAll('.cyf-reel-poster').length).toBe(3);
  });

  it('mounts exactly one iframe once playing, however many items there are', () => {
    firstPage([reelItem(1), reelItem(2), reelItem(3), reelItem(4), reelItem(5)]);

    const poster = fixture.nativeElement.querySelector('.cyf-reel-poster') as HTMLButtonElement;
    poster.click();
    fixture.detectChanges();

    // The whole point: five panels, one player.
    expect(iframes()).toHaveLength(1);
  });

  it('the one iframe belongs to the panel that is on screen', () => {
    firstPage([reelItem(1), reelItem(2), reelItem(3)]);

    const poster = fixture.nativeElement.querySelector('.cyf-reel-poster') as HTMLButtonElement;
    poster.click();
    fixture.detectChanges();

    const src = iframes()[0].getAttribute('src') ?? '';
    expect(src).toContain('vid00000001'.slice(0, 11));
  });

  it('moves the single iframe when the current panel changes', () => {
    firstPage([reelItem(1), reelItem(2), reelItem(3)]);

    const poster = fixture.nativeElement.querySelector('.cyf-reel-poster') as HTMLButtonElement;
    poster.click();
    fixture.detectChanges();

    // Scrolling is what normally moves this; the observer sets the same signal.
    const component = fixture.componentInstance as unknown as {
      currentIndex: { set(value: number): void };
    };
    component.currentIndex.set(1);
    fixture.detectChanges();

    // Still one, and now it is the second item's — the previous player is gone
    // rather than paused in the background.
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0].getAttribute('src') ?? '').toContain(reelItem(2).video.videoId);
  });

  // ── The embed URL ─────────────────────────────────────────────────────────

  it('builds the embed from the id, not from anything the server sent as a URL', () => {
    firstPage([
      reelItem(1, {
        video: {
          videoId: 'dQw4w9WgXcQ',
          // A hostile embedUrl that must never reach the DOM.
          embedUrl: 'javascript:alert(1)',
          watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        },
      }),
    ]);

    (fixture.nativeElement.querySelector('.cyf-reel-poster') as HTMLButtonElement).click();
    fixture.detectChanges();

    const src = iframes()[0].getAttribute('src') ?? '';
    expect(src.startsWith('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    expect(src).not.toContain('javascript:');
  });

  it('refuses to mount an iframe for an id that is not an id', () => {
    firstPage([
      reelItem(1, {
        video: {
          videoId: '"><script>alert(1)</script>',
          embedUrl: 'https://www.youtube.com/embed/x',
          watchUrl: 'https://www.youtube.com/watch?v=x',
        },
      }),
    ]);

    (fixture.nativeElement.querySelector('.cyf-reel-poster') as HTMLButtonElement).click();
    fixture.detectChanges();

    // No player rather than a malformed one.
    expect(iframes()).toHaveLength(0);
  });

  // ── What a Reel shows, and what it does not ───────────────────────────────

  it('shows the name, role, demo title, and technologies', () => {
    firstPage([reelItem(1)]);
    const shown = text();
    expect(shown).toContain('Student 1');
    expect(shown).toContain('Frontend Developer');
    expect(shown).toContain('Project 1');
    expect(shown).toContain('Angular');
  });

  it('offers a way to the profile and nothing else', () => {
    firstPage([reelItem(1)]);
    const shown = text();
    expect(shown).toContain('View profile');
    // Explicitly out of scope for this product.
    for (const absent of ['Like', 'Comment', 'Share', 'Report', 'Save']) {
      expect(shown).not.toContain(absent);
    }
  });

  it('says so plainly when there is nothing published', () => {
    firstPage([]);
    expect(text()).toContain('nothing to show');
  });

  it('reports where you are in the reel', () => {
    firstPage([reelItem(1), reelItem(2)], 9);
    expect(text()).toContain('1 of 9');
  });
});
