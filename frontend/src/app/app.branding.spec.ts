import { describe, expect, it } from 'vitest';

import enTranslations from '../../public/i18n/en.json';
import arTranslations from '../../public/i18n/ar.json';
import { routes } from './app.routes';

type Translations = Record<string, unknown>;

function flatten(source: Translations, prefix = ''): string[] {
  return Object.entries(source).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value as Translations, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function values(source: Translations): string[] {
  return Object.entries(source).flatMap(([, value]) =>
    value !== null && typeof value === 'object'
      ? values(value as Translations)
      : [String(value)],
  );
}

const en = enTranslations as Translations;
const ar = arTranslations as Translations;

describe('EN/AR translation parity', () => {
  it('has identical key sets', () => {
    expect(flatten(en).sort()).toEqual(flatten(ar).sort());
  });

  it('has the same number of keys', () => {
    expect(flatten(en).length).toBe(flatten(ar).length);
  });

  it('leaves no empty Arabic value', () => {
    for (const value of values(ar)) {
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Code Your Future branding', () => {
  it('exposes the product name in both languages', () => {
    expect((en['app'] as Translations)['name']).toBe('Code Your Future');
    expect((ar['app'] as Translations)['name']).toBe('Code Your Future');
  });

  it('carries no generic template placeholder branding', () => {
    const allValues = [...values(en), ...values(ar)];
    for (const placeholder of ['Fullstack Template', 'MyApp', 'your-entity']) {
      expect(allValues).not.toContain(placeholder);
    }
  });
});

describe('retired legacy vocabulary', () => {
  const allValues = [...values(en), ...values(ar)];
  const allKeys = [...flatten(en), ...flatten(ar)];

  for (const term of ['SuperAdmin', 'Employee', 'Employees', 'Program']) {
    it(`no user-facing string mentions '${term}'`, () => {
      expect(allValues.some((value) => value.includes(term))).toBe(false);
    });
  }

  it('no translation key targets the retired user-management screen', () => {
    expect(allKeys.some((key) => key.startsWith('users.'))).toBe(false);
    expect(allKeys.some((key) => key.startsWith('assignUser.'))).toBe(false);
  });

  it('nav has no users entry', () => {
    const nav = en['nav'] as Translations;
    expect(Object.keys(nav)).not.toContain('users');
  });
});

describe('approved Student copy', () => {
  it('states that an invitation is only needed to join a batch (EN)', () => {
    const auth = en['auth'] as Translations;
    expect(auth['studentInvitationNotice']).toBe(
      'You can sign in and complete your profile now. An invitation is required only to join a batch.',
    );
  });

  it('states the same in Arabic', () => {
    const auth = ar['auth'] as Translations;
    expect(auth['studentInvitationNotice']).toBe(
      'يمكنك تسجيل الدخول وإكمال ملفك الشخصي الآن. ستحتاج إلى دعوة فقط للانضمام إلى دفعة.',
    );
  });

  it('does not advertise Student email/password login', () => {
    const allValues = [...values(en), ...values(ar)];
    for (const value of allValues) {
      const lowered = value.toLowerCase();
      const advertisesStudentPassword =
        lowered.includes('student') && lowered.includes('password');
      expect(advertisesStudentPassword).toBe(false);
    }
  });
});

describe('route surface', () => {
  const paths = routes.map((route) => route.path);

  it('exposes only /auth, the Student area, the shell, and a wildcard', () => {
    expect(paths).toEqual(['auth', 'student', '', '**']);
  });

  it('no longer registers the /users management route', () => {
    const shell = routes.find((route) => route.path === '');
    const children = (shell?.children ?? []).map((child) => child.path);
    expect(children).not.toContain('users');
    expect(children).toEqual(['', 'dashboard']);
  });

  it('registers no future-checkpoint route', () => {
    const declared = JSON.stringify(paths);
    for (const future of ['join', 'reels', 'batches', 'profile', 'students']) {
      expect(declared).not.toContain(future);
    }
  });
});
