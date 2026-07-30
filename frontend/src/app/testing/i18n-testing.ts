import { TranslateService } from '@ngx-translate/core';

import enTranslations from '../../../public/i18n/en.json';
import arTranslations from '../../../public/i18n/ar.json';

/** Shape ngx-translate accepts for a translation tree. */
export type TranslationTree = { [key: string]: string | TranslationTree };

export const EN_TRANSLATIONS = enTranslations as unknown as TranslationTree;
export const AR_TRANSLATIONS = arTranslations as unknown as TranslationTree;

export type TestLanguage = 'en' | 'ar';

/**
 * Load the real translation files into a TestBed `TranslateService` and select a
 * language.
 *
 * Tests use the shipped JSON rather than inline fixtures, so a missing or
 * renamed key fails the test instead of silently passing against a stub.
 */
export function useTranslations(
  translate: TranslateService,
  lang: TestLanguage = 'en',
): void {
  translate.setTranslation('en', EN_TRANSLATIONS);
  translate.setTranslation('ar', AR_TRANSLATIONS);
  translate.use(lang);
}

/** Flatten a translation tree to dotted key paths, for parity assertions. */
export function flattenKeys(tree: TranslationTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flattenKeys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Every leaf string in a translation tree. */
export function flattenValues(tree: TranslationTree): string[] {
  return Object.entries(tree).flatMap(([, value]) =>
    typeof value === 'object' && value !== null ? flattenValues(value) : [String(value)],
  );
}
