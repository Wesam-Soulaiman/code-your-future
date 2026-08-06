import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PublicStudentCard } from '../../models/PublicTalent';
import { useTranslations } from '../../testing/i18n-testing';
import { PublicStudentsComponent } from './public-students.component';

/**
 * Discover Talent ⟨CP8⟩ — the public directory.
 *
 * The assertions worth having are about the request: that it is paginated, that
 * it carries no session, and that a filter narrows it server-side rather than
 * the browser fetching everything and sieving.
 */

function card(index: number, overrides: Partial<PublicStudentCard> = {}): PublicStudentCard {
  return {
    slug: `slug${index}`,
    name: `Student ${index}`,
    targetRole: 'Frontend Developer',
    city: 'Damascus',
    technologies: ['Angular', 'Parse'],
    hasDemo: index % 2 === 0,
    pinned: false,
    ...overrides,
  };
}

describe('PublicStudentsComponent ⟨CP8⟩', () => {
  let fixture: ComponentFixture<PublicStudentsComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicStudentsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
      ],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PublicStudentsComponent);
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  /** Answer the filter-options call, which fires alongside the first page. */
  function answerOptions(): void {
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/getTalentFilters'),
    );
    request.flush({
      targetRoles: ['Frontend Developer', 'Backend Developer'],
      cities: ['Damascus', 'Aleppo'],
      educationStatuses: ['GRADUATE'],
      technologies: ['Angular', 'Parse', 'MongoDB'],
    });
  }

  function firstPage(items: PublicStudentCard[], total = items.length): void {
    fixture.detectChanges();
    answerOptions();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    request.flush({ items, total, skip: 0, limit: 24 });
    fixture.detectChanges();
  }

  // ── The request ───────────────────────────────────────────────────────────

  it('asks for one page and carries no session', () => {
    fixture.detectChanges();
    answerOptions();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );

    expect(request.request.params.get('skip')).toBe('0');
    expect(Number(request.request.params.get('limit'))).toBeGreaterThan(0);
    expect(request.request.headers.get('X-Parse-Session-Token')).toBeNull();
    request.flush({ items: [], total: 0, skip: 0, limit: 24 });
  });

  it('sends no filter when nothing is chosen', () => {
    fixture.detectChanges();
    answerOptions();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );

    // An unchecked box is not a filter, and an empty select is not one either.
    for (const key of [
      'targetRole',
      'city',
      'educationStatus',
      'technologies',
      'hasDemo',
      'search',
      'sort',
    ]) {
      expect(request.request.params.get(key), key).toBeNull();
    }
    request.flush({ items: [], total: 0, skip: 0, limit: 24 });
  });

  it('narrows server-side when a filter is chosen', () => {
    firstPage([card(1)]);

    const select = fixture.nativeElement.querySelector('#filter-role') as HTMLSelectElement;
    select.value = 'Frontend Developer';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    expect(request.request.params.get('targetRole')).toBe('Frontend Developer');
    // A new filter starts from the first page rather than page four of the old
    // result set.
    expect(request.request.params.get('skip')).toBe('0');
    request.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
  });

  it('sends the demo filter only when it narrows', () => {
    firstPage([card(1)]);

    const checkbox = fixture.nativeElement.querySelector('#filter-demo') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    const on = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    expect(on.request.params.get('hasDemo')).toBe('true');
    on.flush({ items: [card(2)], total: 1, skip: 0, limit: 24 });
    fixture.detectChanges();

    checkbox.click();
    fixture.detectChanges();

    const off = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    expect(off.request.params.get('hasDemo')).toBeNull();
    off.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
  });

  it('appends the next page rather than replacing what is on screen', () => {
    firstPage([card(1), card(2)], 4);

    const more = Array.from(
      fixture.nativeElement.querySelectorAll('p-button button'),
    ).find((element) => (element as HTMLElement).textContent?.includes('Show more')) as
      | HTMLButtonElement
      | undefined;
    expect(more).toBeDefined();
    more?.click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    // Asks for what comes after what is already loaded.
    expect(request.request.params.get('skip')).toBe('2');
    request.flush({ items: [card(3), card(4)], total: 4, skip: 2, limit: 24 });
    fixture.detectChanges();

    expect(text()).toContain('Student 1');
    expect(text()).toContain('Student 4');
  });

  // ── What a card shows ─────────────────────────────────────────────────────

  it('shows the name, role, city, technologies, and the demo badge', () => {
    firstPage([card(2)]);
    const shown = text();
    expect(shown).toContain('Student 2');
    expect(shown).toContain('Frontend Developer');
    expect(shown).toContain('Damascus');
    expect(shown).toContain('Angular');
    expect(shown).toContain('Has demo');
  });

  it('marks a pinned student and leaves the order alone ⟨CP8C⟩', () => {
    /*
      The server already returned these in order. The page's job is to say why
      the first one is first, not to re-sort — a browser that sorted by `pinned`
      would fight the server's own ordering as soon as a second page arrived.
    */
    firstPage([card(1, { pinned: true }), card(3), card(5)]);

    const shown = text();
    expect(shown).toContain('Featured');

    // The cards themselves. Each card holds two links, so querying anchors
    // counted the first card twice.
    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('li.cyf-public-card'),
    ).map((element) => (element as HTMLElement).textContent ?? '');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toContain('Student 1');
    expect(cards[0]).toContain('Featured');
    expect(cards[1]).not.toContain('Featured');
    expect(cards[2]).not.toContain('Featured');
  });

  it('shows no featured badge when nobody is pinned', () => {
    firstPage([card(1), card(3)]);
    expect(text()).not.toContain('Featured');
  });

  it('shows no demo badge for a student without one', () => {
    firstPage([card(1)]);
    expect(text()).not.toContain('Has demo');
  });

  it('links to a profile by slug and never by an internal id', () => {
    firstPage([card(1)]);
    const link = fixture.nativeElement.querySelector('a[href*="/students/"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('slug1');
  });

  it('searches by name, debounced, and sends the term to the server', async () => {
    firstPage([card(1)]);

    const box = fixture.nativeElement.querySelector('#filter-search') as HTMLInputElement;
    box.value = 'Lina';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Nothing yet: typing must not be a query per keystroke on an endpoint with
    // no session behind it.
    http.expectNone((candidate) => candidate.url.includes('listTalentDiscovery'));

    await new Promise((resolve) => setTimeout(resolve, 420));
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('listTalentDiscovery'),
    );
    expect(request.request.params.get('search')).toBe('Lina');
    // A new search starts from the first page.
    expect(request.request.params.get('skip')).toBe('0');
    request.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
  });

  it('sends a sort only when it is not the default', () => {
    firstPage([card(1)]);

    const select = fixture.nativeElement.querySelector('#filter-sort') as HTMLSelectElement;
    select.value = 'oldest';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const oldest = http.expectOne((candidate) =>
      candidate.url.includes('listTalentDiscovery'),
    );
    expect(oldest.request.params.get('sort')).toBe('oldest');
    oldest.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
    fixture.detectChanges();

    select.value = 'newest';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const newest = http.expectOne((candidate) =>
      candidate.url.includes('listTalentDiscovery'),
    );
    // Newest is the server's default, so it is not worth a parameter.
    expect(newest.request.params.get('sort')).toBeNull();
    newest.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
  });

  // ── Empty states ──────────────────────────────────────────────────────────

  it('distinguishes "nothing published" from "nothing matching"', () => {
    firstPage([]);
    expect(text()).toContain('Nobody has published');

    const checkbox = fixture.nativeElement.querySelector('#filter-demo') as HTMLInputElement;
    checkbox.click();
    fixture.detectChanges();

    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/listTalentDiscovery'),
    );
    request.flush({ items: [], total: 0, skip: 0, limit: 24 });
    fixture.detectChanges();

    // A different message, because the useful next action is different.
    expect(text()).toContain('No one matches these filters');
  });

  it('still renders the grid when the filter options fail to load', () => {
    // A missing filter list is not a broken page.
    fixture.detectChanges();
    http
      .expectOne((candidate) => candidate.url.includes('getTalentFilters'))
      .flush(null, { status: 500, statusText: 'Server Error' });

    const request = http.expectOne((candidate) =>
      candidate.url.includes('listTalentDiscovery'),
    );
    request.flush({ items: [card(1)], total: 1, skip: 0, limit: 24 });
    fixture.detectChanges();

    expect(text()).toContain('Student 1');
  });
});
