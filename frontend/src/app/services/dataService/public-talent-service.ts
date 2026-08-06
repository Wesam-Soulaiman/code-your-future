import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  PublicFilterOptions,
  PublicPage,
  PublicReelItem,
  PublicStudentCard,
  PublicStudentProfile,
  PublicTalentFilters,
  PublicTalentSort,
} from '../../models/PublicTalent';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';

/**
 * The public talent surface ⟨CP8⟩.
 *
 * ── No session, deliberately ────────────────────────────────────────────────
 * Nothing here sends a session token, and nothing here needs one. These pages
 * are for people who have never signed in — a recruiter following a link, or a
 * Student showing their family what they built. The interceptor attaches a
 * token when one happens to exist, which is harmless: the endpoints ignore it.
 *
 * ── Read-only, entirely ─────────────────────────────────────────────────────
 * There is no method on this service that creates, updates, or deletes
 * anything, because there is no such endpoint. A Student changes what the
 * public sees by editing their own Final Task behind their own session.
 *
 * ── Pagination is the server's ──────────────────────────────────────────────
 * Every list method takes a page and returns a total. Nothing here fetches
 * everything and slices — the Reel in particular must not preload every video,
 * so it asks for one page at a time as somebody scrolls.
 *
 * All calls opt out of the interceptor's global toast: these pages render their
 * own translated messages, and a Visitor should never see a raw server string.
 */
@Injectable({
  providedIn: 'root',
})
export class PublicTalentApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  /** Turn the filter object into query parameters the server understands. */
  private toParams(
    filters: PublicTalentFilters,
    page: { skip: number; limit: number },
    sort?: PublicTalentSort,
  ): HttpParams {
    let params = new HttpParams()
      .set('skip', String(page.skip))
      .set('limit', String(page.limit));

    if (filters.targetRole) params = params.set('targetRole', filters.targetRole);
    if (filters.city) params = params.set('city', filters.city);
    if (filters.educationStatus) {
      params = params.set('educationStatus', filters.educationStatus);
    }
    // Sent comma-separated so a filtered view survives being copied out of the
    // address bar and pasted to somebody else.
    if (filters.technologies?.length) {
      params = params.set('technologies', filters.technologies.join(','));
    }
    // Only sent when it narrows. An unchecked box is not a filter.
    if (filters.hasDemo) params = params.set('hasDemo', 'true');
    if (filters.search?.trim()) params = params.set('search', filters.search.trim());
    // Newest is the server's default, so it is not worth a parameter.
    if (sort === 'oldest') params = params.set('sort', 'oldest');

    return params;
  }

  /** One page of the public directory. */
  listStudents(
    filters: PublicTalentFilters,
    page: { skip: number; limit: number },
    sort: PublicTalentSort = 'newest',
  ): Observable<PublicPage<PublicStudentCard>> {
    return this.httpClient.get<PublicPage<PublicStudentCard>>(
      `${this.baseURL}/talent/listTalentDiscovery`,
      { context: this.context, params: this.toParams(filters, page, sort) },
    );
  }

  /**
   * One public profile, by slug.
   *
   * A slug that is unknown and a slug belonging to somebody unpublished fail
   * identically — the server decided that, and this method cannot tell them
   * apart either.
   */
  getStudent(slug: string): Observable<PublicStudentProfile> {
    return this.httpClient.get<PublicStudentProfile>(
      `${this.baseURL}/talent/getTalentProfile`,
      { context: this.context, params: new HttpParams().set('slug', slug) },
    );
  }

  /** One page of the vertical Talent Reel. */
  listReel(
    filters: PublicTalentFilters,
    page: { skip: number; limit: number },
  ): Observable<PublicPage<PublicReelItem>> {
    return this.httpClient.get<PublicPage<PublicReelItem>>(
      `${this.baseURL}/talent/listTalentReels`,
      { context: this.context, params: this.toParams(filters, page) },
    );
  }

  /**
   * The values worth offering as filters.
   *
   * Built server-side from what is actually published, so every option returns
   * at least one result. A dropdown offering a city with nobody in it looks
   * broken the first time somebody picks it.
   */
  getFilterOptions(): Observable<PublicFilterOptions> {
    return this.httpClient.get<PublicFilterOptions>(
      `${this.baseURL}/talent/getTalentFilters`,
      { context: this.context },
    );
  }

  /** The absolute address of a public photo path the server sent. */
  photoUrl(path: string): string {
    return `${this.baseURL}${path}`;
  }
}
