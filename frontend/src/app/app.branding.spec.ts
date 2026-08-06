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

  it('exposes only auth, join, the public showcase, onboarding, the workspaces, and a wildcard', () => {
    // `join/:token` joined the top level in Checkpoint 4. It is deliberately
    // outside every guarded branch: it has to open for a Visitor.
    //
    // The three public talent routes joined in Checkpoint 8 and are outside
    // every guard for the same reason — they are what a recruiter or a family
    // member opens from a link, having never signed in. They also sit *before*
    // the `student` branch: `students` and `student` are different paths, and
    // ordering them explicitly here makes that impossible to get wrong later.
    //
    // `student/profile` is deliberately before and outside the Student shell,
    // so an unfinished Student never activates workspace chrome.
    expect(paths).toEqual([
      'auth',
      'join/:token',
      'students',
      'students/:slug',
      'talent-reel',
      'student/profile',
      'student',
      '',
      '**',
    ]);
  });

  it('every public route is reachable without a guard', () => {
    // A guard on any of these would make the public pages unreachable to the
    // people they exist for, which is the whole point of the checkpoint.
    for (const path of ['students', 'students/:slug', 'talent-reel']) {
      const route = routes.find((entry) => entry.path === path);
      expect(route, path).toBeDefined();
      expect(route?.canActivate, `${path} must have no guard`).toBeUndefined();
    }
  });

  it('no longer registers the /users management route', () => {
    const shell = routes.find((route) => route.path === '');
    const children = (shell?.children ?? []).map((child) => child.path);
    expect(children).not.toContain('users');
    // Every entry here is a real, working Admin page — nothing is stubbed.
    // Profile Catalogs arrived in Checkpoint 3A; Batches and Students in 4.
    expect(children).toEqual([
      '',
      'dashboard',
      'dashboard/profile-catalogs',
      'dashboard/batches',
      'dashboard/batches/new',
      'dashboard/batches/:batchId/edit',
      'dashboard/batches/:batchId',
      'dashboard/students',
      'dashboard/students/:studentId',
    ]);
  });

  it('declares the literal batch routes before the parameterised one', () => {
    // Order is load-bearing: `:batchId` would swallow `new`, and creating a
    // batch would try to open one whose id is the word "new".
    const shell = routes.find((route) => route.path === '');
    const children = (shell?.children ?? []).map((child) => child.path ?? '');
    expect(children.indexOf('dashboard/batches/new')).toBeLessThan(
      children.indexOf('dashboard/batches/:batchId'),
    );
    expect(children.indexOf('dashboard/batches/:batchId/edit')).toBeLessThan(
      children.indexOf('dashboard/batches/:batchId'),
    );
  });

  it('registers no future-checkpoint route', () => {
    // Batches, invitations, and the Student directory shipped in Checkpoint 4,
    // so they are no longer on this list. Everything still here belongs to a
    // checkpoint that has not happened.
    const declared = JSON.stringify(routes);
    for (const future of ['reels', 'resources', 'live-slides', 'tasks', 'pinned']) {
      expect(declared, `${future} belongs to a later checkpoint`).not.toContain(future);
    }
  });

  it('leaves the join page unguarded', () => {
    // The page decides what to ask a Visitor, a Student, or an Admin for. A
    // guard here would bounce a Visitor to sign-in having lost the invitation.
    const join = routes.find((route) => route.path === 'join/:token');
    expect(join).toBeTruthy();
    expect(join?.canActivate).toBeUndefined();
  });
});
