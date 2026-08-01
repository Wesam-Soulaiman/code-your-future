/**
 * Institution catalog seeding.
 *
 * ── What is seeded, and what deliberately is not ────────────────────────────
 * Only **institutions**, and only the list Checkpoint 3A already shipped as a
 * hard-coded constant. Moving it into the catalog is a migration of data that
 * already existed, so nobody's stored answer changes meaning.
 *
 * Cities, majors, and target roles are **not** seeded. There is no authoritative
 * source for any of them, and inventing one would put a plausible-looking list
 * in front of Students that nobody approved — worse than an empty list, because
 * an empty list is obviously empty. An Admin adds them through the catalog page;
 * until then the Student form says so plainly.
 *
 * ── Idempotence ─────────────────────────────────────────────────────────────
 * Keyed on the normalised `code`, which is derived from the English name and is
 * therefore stable across runs. Running this on every boot creates nothing the
 * second time, and — importantly — does **not** overwrite an Admin's edits: a
 * renamed or deactivated institution stays renamed and deactivated. The seed
 * establishes a starting point; it does not reassert itself forever.
 *
 * ── Arabic names ────────────────────────────────────────────────────────────
 * These are the institutions' own Arabic names, which is why they can be
 * supplied here rather than left blank: they are a matter of record, not a
 * translation decision. Anything an Admin disagrees with is one edit away.
 */

import {CATALOG_TYPE, INSTITUTION_KIND, InstitutionKind, normaliseCatalogCode} from './constants';
import {catalogLog} from './logging';
import {ensureItem} from './repository';
import {NormalisedCatalogItem} from './validation';

interface SeedInstitution {
  nameEn: string;
  nameAr: string;
  kind: InstitutionKind;
  isOther?: boolean;
}

/**
 * The Checkpoint 3A list, unchanged in content and order.
 *
 * Public universities first, then private ones, then `Other` last so it never
 * hides a real option — the same ordering rationale the constant carried.
 */
export const SEED_INSTITUTIONS: readonly SeedInstitution[] = [
  {nameEn: 'Damascus University', nameAr: 'جامعة دمشق', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'University of Aleppo', nameAr: 'جامعة حلب', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'Tishreen University', nameAr: 'جامعة تشرين', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'Al-Baath University', nameAr: 'جامعة البعث', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'Al-Furat University', nameAr: 'جامعة الفرات', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'Hama University', nameAr: 'جامعة حماة', kind: INSTITUTION_KIND.UNIVERSITY},
  {nameEn: 'Idlib University', nameAr: 'جامعة إدلب', kind: INSTITUTION_KIND.UNIVERSITY},
  {
    nameEn: 'Syrian Virtual University',
    nameAr: 'الجامعة الافتراضية السورية',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Higher Institute of Applied Sciences and Technology (HIAST)',
    nameAr: 'المعهد العالي للعلوم التطبيقية والتكنولوجيا',
    kind: INSTITUTION_KIND.INSTITUTE,
  },
  {
    nameEn: 'Damascus Higher Institute of Business Administration (HIBA)',
    nameAr: 'المعهد العالي لإدارة الأعمال',
    kind: INSTITUTION_KIND.INSTITUTE,
  },
  {
    nameEn: 'Arab International University',
    nameAr: 'الجامعة العربية الدولية',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Syrian Private University',
    nameAr: 'الجامعة السورية الخاصة',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Al-Sham Private University',
    nameAr: 'جامعة الشام الخاصة',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'International University for Science and Technology',
    nameAr: 'الجامعة الدولية للعلوم والتكنولوجيا',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Wadi International University',
    nameAr: 'جامعة الوادي الدولية',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Al-Andalus University for Medical Sciences',
    nameAr: 'جامعة الأندلس للعلوم الطبية',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Kalamoon Private University',
    nameAr: 'جامعة القلمون الخاصة',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Yarmouk Private University',
    nameAr: 'جامعة اليرموك الخاصة',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  {
    nameEn: 'Antioch Syrian University',
    nameAr: 'جامعة أنطاكية السورية',
    kind: INSTITUTION_KIND.UNIVERSITY,
  },
  // The escape hatch, last on purpose. `isOther` is what makes the form demand
  // a typed institution name.
  {nameEn: 'Other', nameAr: 'أخرى', kind: INSTITUTION_KIND.OTHER, isOther: true},
];

/** The normalised rows the seed will ensure exist. Exported for the tests. */
export function seedInstitutionValues(): NormalisedCatalogItem[] {
  return SEED_INSTITUTIONS.map((entry, index) => {
    const values: NormalisedCatalogItem = {
      type: CATALOG_TYPE.INSTITUTION,
      code: normaliseCatalogCode(entry.nameEn),
      nameEn: entry.nameEn,
      nameAr: entry.nameAr,
      active: true,
      // Ten apart, so an Admin can slot something between two seeded rows
      // without renumbering the whole list.
      sortOrder: (index + 1) * 10,
      institutionKind: entry.kind,
      isOther: entry.isOther === true,
    };
    return values;
  });
}

/**
 * Ensure the institution catalog exists.
 *
 * Safe to call on every boot and safe to call concurrently: `ensureItem` keys on
 * the unique `(type, code)` index, so a race ends with one row rather than two.
 * Never throws — a catalog that failed to seed must not stop the server from
 * starting, and the Admin page can create the rows by hand.
 */
export async function seedInstitutionCatalog(): Promise<{created: number; existing: number}> {
  let created = 0;
  let existing = 0;

  for (const values of seedInstitutionValues()) {
    try {
      const result = await ensureItem(values);
      if (result.created) created += 1;
      else existing += 1;
    } catch {
      // One bad row must not abandon the rest, and the reason is already a
      // stable code with nothing worth logging beyond the count below.
      catalogLog.warn('An institution could not be seeded', {
        op: 'seedInstitutionCatalog',
        stage: 'seed',
        ok: false,
        type: CATALOG_TYPE.INSTITUTION,
      });
    }
  }

  catalogLog.info('Institution catalog ensured', {
    op: 'seedInstitutionCatalog',
    stage: 'seed',
    ok: true,
    type: CATALOG_TYPE.INSTITUTION,
    count: created,
  });

  return {created, existing};
}
