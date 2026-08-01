import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ProfileCatalogItem,
  ProfileCatalogItemInput,
  ProfileCatalogListResponse,
  ProfileCatalogMap,
} from '../../models/ProfileCatalogItem';
import { CatalogType } from '../../utils/profile-catalog-constants';
import { HANDLES_OWN_ERRORS } from '../../utils/auth-error';
import { SharedVarsService } from '../shared-vars';

/**
 * The profile catalog.
 *
 * Two surfaces, one service, because they describe the same data:
 *
 *   - `getStudentCatalog()` is what a Student's form calls. It returns **active
 *     items only**, and the backend decides that — passing a flag would make the
 *     browser responsible for a rule it must not own.
 *   - the `admin*` calls are the management screen, and are refused for anybody
 *     without a live Admin role.
 *
 * Every call names a category from a closed four-value list. There is no class
 * name in any signature, no `where`, and no generic query — the API has no way
 * to express one.
 *
 * All calls opt out of the interceptor's global toast: both pages render their
 * own translated messages, so a raw server string is never shown and a failure
 * is never reported twice.
 */
@Injectable({
  providedIn: 'root',
})
export class ProfileCatalogApiService {
  private httpClient = inject(HttpClient);
  private baseURL = inject(SharedVarsService).baseURL;

  private get context(): HttpContext {
    return new HttpContext().set(HANDLES_OWN_ERRORS, true);
  }

  // ── Student ───────────────────────────────────────────────────────────────

  /**
   * The active items a Student's form may offer.
   *
   * All four categories in one round trip by default. `language` only affects
   * the order the server sorts by; it authorises nothing.
   */
  getStudentCatalog(language: string, types?: readonly CatalogType[]): Observable<ProfileCatalogMap> {
    let params = new HttpParams().set('lang', language === 'ar' ? 'ar' : 'en');
    if (types && types.length > 0) params = params.set('types', types.join(','));

    return this.httpClient.get<ProfileCatalogMap>(
      `${this.baseURL}/student-catalog/getProfileCatalog`,
      { context: this.context, params },
    );
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /** Every item in one category, active or not. */
  adminList(
    type: CatalogType,
    language: string,
    search = '',
  ): Observable<ProfileCatalogListResponse> {
    let params = new HttpParams()
      .set('type', type)
      .set('lang', language === 'ar' ? 'ar' : 'en');
    if (search.trim()) params = params.set('search', search.trim());

    return this.httpClient.get<ProfileCatalogListResponse>(
      `${this.baseURL}/profile-catalogs/listProfileCatalogItems`,
      { context: this.context, params },
    );
  }

  adminCreate(input: ProfileCatalogItemInput): Observable<ProfileCatalogItem> {
    return this.httpClient.post<ProfileCatalogItem>(
      `${this.baseURL}/profile-catalogs/createProfileCatalogItem`,
      input,
      { context: this.context },
    );
  }

  adminUpdate(id: string, input: ProfileCatalogItemInput): Observable<ProfileCatalogItem> {
    return this.httpClient.post<ProfileCatalogItem>(
      `${this.baseURL}/profile-catalogs/updateProfileCatalogItem`,
      { ...input, id },
      { context: this.context },
    );
  }

  /**
   * Activate or deactivate.
   *
   * Deactivating is always allowed, including for an item Students already
   * reference — their stored answer keeps displaying, the value simply stops
   * being offered.
   */
  adminSetActive(id: string, type: CatalogType, active: boolean): Observable<ProfileCatalogItem> {
    return this.httpClient.post<ProfileCatalogItem>(
      `${this.baseURL}/profile-catalogs/setProfileCatalogItemActive`,
      { id, type, active },
      { context: this.context },
    );
  }

  /**
   * Delete an unused item.
   *
   * A referenced item comes back as `CATALOG_IN_USE`; the page explains that
   * deactivating is the way to retire a value somebody has already chosen.
   */
  adminDelete(id: string, type: CatalogType): Observable<{ id: string; deleted: boolean }> {
    return this.httpClient.post<{ id: string; deleted: boolean }>(
      `${this.baseURL}/profile-catalogs/deleteProfileCatalogItem`,
      { id, type },
      { context: this.context },
    );
  }
}
