/**
 * Repository-integrity guard: the design system must be **additive**.
 *
 * Checkpoint 2A layers Code Your Future's tokens, typography, and layout on top
 * of the template's stylesheet. The Template Preservation Rule forbids deleting
 * template capability that the product does not currently import — FullCalendar,
 * Timeline, and Editor theming in particular.
 *
 * These assertions live in the backend suite because it is the only suite in
 * this repository with filesystem access: the Angular unit-test builder compiles
 * `?raw` CSS imports through its CSS pipeline rather than returning source text,
 * so a frontend spec cannot read stylesheet source.
 *
 * Nothing here imports backend code; it is a pure file check.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'create-project.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repository root not found');
}

const REPO_ROOT = findRepoRoot();
const FRONTEND_SRC = join(REPO_ROOT, 'frontend', 'src');

const read = (relative: string): string =>
  readFileSync(join(FRONTEND_SRC, relative), 'utf8');

const globalStyles = read('styles.css');
const tokens = read('styles/tokens.css');
const typography = read('styles/typography.css');
const layout = read('styles/layout.css');

describe('preserved template theming survives the design system', () => {
  test('FullCalendar theming is intact', () => {
    for (const marker of [
      'FullCalendar Theme',
      '--fc-border-color',
      '--fc-today-bg-color',
      '.fc .fc-button',
      '.fc .fc-col-header-cell',
      '.fc .fc-timegrid-slot',
      'fc-slot-pulse',
      '.fc .fc-event-custom',
    ]) {
      assert.ok(globalStyles.includes(marker), `FullCalendar marker missing: ${marker}`);
    }
  });

  test('Timeline theming is intact', () => {
    assert.ok(globalStyles.includes('p-timeline-event-connector'));
    assert.ok(globalStyles.includes('.p-timeline-vertical .p-timeline-event-opposite'));
    assert.ok(globalStyles.includes('.p-timeline-vertical .p-timeline-event-content'));
  });

  test('Editor theming is intact', () => {
    assert.ok(globalStyles.includes('.p-editor'));
    assert.ok(globalStyles.includes('--p-editor-toolbar-border-radius'));
  });

  test('other PrimeNG component overrides are intact', () => {
    for (const selector of [
      '.p-button',
      '.p-progressbar',
      '.p-avatar',
      '.p-divider-horizontal',
      '.p-divider-vertical',
      '.action-progress-low',
      '.action-progress-done',
      "input[type='range']",
      '.empty-img',
    ]) {
      assert.ok(globalStyles.includes(selector), `PrimeNG override missing: ${selector}`);
    }
  });

  test('template surface-layering variables and helpers are intact', () => {
    for (const marker of [
      '--app-bg',
      '--app-card',
      '--app-card-nested',
      '.app-card',
      '.app-card-nested',
      '::-webkit-scrollbar',
    ]) {
      assert.ok(globalStyles.includes(marker), `template marker missing: ${marker}`);
    }
  });

  test('the Cairo @font-face declarations are intact', () => {
    assert.ok(globalStyles.includes("font-family: 'Cairo'"));
    // The variable face plus seven static weights shipped with the template.
    const faceCount = (globalStyles.match(/@font-face/g) ?? []).length;
    assert.ok(faceCount >= 8, `expected at least 8 @font-face rules, found ${faceCount}`);
  });

  test('the design system is imported additively, not substituted', () => {
    for (const layer of ['tokens.css', 'typography.css', 'layout.css']) {
      assert.ok(
        globalStyles.includes(`@import './styles/${layer}'`),
        `missing layer import: ${layer}`
      );
    }
    // The template's own rules must still follow the imports.
    assert.ok(
      globalStyles.indexOf("@import './styles/layout.css'") <
        globalStyles.indexOf('FullCalendar Theme'),
      'template styling must still be present after the new layers'
    );
  });
});

describe('design tokens', () => {
  test('every required semantic token is defined', () => {
    const required = [
      '--cyf-primary',
      '--cyf-primary-hover',
      '--cyf-primary-active',
      '--cyf-primary-subtle',
      '--cyf-accent',
      '--cyf-bg',
      '--cyf-surface',
      '--cyf-surface-raised',
      '--cyf-surface-subtle',
      '--cyf-text',
      '--cyf-text-secondary',
      '--cyf-text-muted',
      '--cyf-text-inverse',
      '--cyf-border',
      '--cyf-border-strong',
      '--cyf-focus-ring',
      '--cyf-success',
      '--cyf-warning',
      '--cyf-error',
      '--cyf-info',
      '--cyf-disabled-bg',
      '--cyf-disabled-text',
      '--cyf-space-4',
      '--cyf-radius-md',
      '--cyf-shadow-md',
      '--cyf-width-form',
      '--cyf-width-content',
      '--cyf-transition',
      '--cyf-control-height',
      '--cyf-touch-target',
    ];
    for (const token of required) {
      assert.ok(tokens.includes(`${token}:`), `missing token: ${token}`);
    }
  });

  test('colour derives from the PrimeNG theme, not hardcoded hex', () => {
    // Shadows are the only place a literal colour is acceptable.
    const withoutShadows = tokens.replace(/--cyf-shadow-[a-z]+:[\s\S]*?;/g, '');
    assert.ok(
      !/#[0-9a-f]{6}\b/i.test(withoutShadows),
      'tokens must reference --p-* variables rather than hardcoding colours'
    );
  });

  test('the existing dark scheme is supported', () => {
    assert.ok(tokens.includes('.dark'));
  });

  test('touch targets are at least 44px', () => {
    assert.ok(tokens.includes('--cyf-touch-target: 2.75rem'));
    assert.ok(tokens.includes('--cyf-control-height: 2.75rem'));
  });
});

describe('typography', () => {
  test('the full hierarchy is defined', () => {
    for (const cls of [
      '.cyf-display',
      '.cyf-page-title',
      '.cyf-section-title',
      '.cyf-card-title',
      '.cyf-body',
      '.cyf-body-sm',
      '.cyf-label',
      '.cyf-helper',
      '.cyf-meta',
      '.cyf-error-text',
      '.cyf-nav-text',
      '.cyf-button-text',
    ]) {
      assert.ok(typography.includes(cls), `missing type class: ${cls}`);
    }
  });

  test('English and Arabic have distinct font stacks', () => {
    assert.ok(typography.includes('--cyf-font-en'));
    assert.ok(typography.includes('--cyf-font-ar'));
    assert.ok(typography.includes("html[lang='en']"));
    assert.ok(typography.includes("html[lang='ar']"));
  });

  test('Cairo stays self-hosted — no remote font dependency is introduced', () => {
    assert.ok(typography.includes("'Cairo'"));
    for (const source of [
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'use.typekit.net',
      'cdn.jsdelivr.net',
    ]) {
      assert.ok(!typography.includes(source), `remote font source found: ${source}`);
      assert.ok(!globalStyles.includes(source), `remote font source found: ${source}`);
    }
  });

  test('Arabic gets more generous line heights', () => {
    const arabicBlock = typography.slice(typography.indexOf("html[lang='ar'] {"));
    assert.ok(arabicBlock.includes('--cyf-leading-normal'));
  });

  /**
   * The English font override must EXCLUDE icon-bearing elements rather than
   * re-declare an icon family by name.
   *
   * An earlier revision re-asserted `font-family: 'Font Awesome 6 Free'` after
   * the override; the installed package is Font Awesome 7, so the named family
   * did not exist and every glyph in English fell back to a missing-character
   * box. Naming a version here would silently break again on the next upgrade.
   */
  test('icon fonts are excluded from the English override, not re-declared', () => {
    const source = typography.replace(/\/\*[\s\S]*?\*\//g, '');

    const override = source
      .split('\n')
      .filter((line) => line.includes("html[lang='en']"))
      .join('\n');
    assert.ok(override.includes("[class*='fa-']"), 'Font Awesome elements must be excluded');
    assert.ok(override.includes("[class*='pi-']"), 'PrimeNG icon elements must be excluded');

    assert.ok(
      !/font-family:[^;]*Font Awesome/i.test(source),
      'must not declare a versioned Font Awesome family',
    );
  });

  test('reduced motion is honoured', () => {
    assert.ok(typography.includes('prefers-reduced-motion'));
  });
});

describe('layout', () => {
  test('uses logical properties so one stylesheet serves LTR and RTL', () => {
    for (const property of [
      'margin-inline',
      'padding-inline',
      'inset-inline',
      'border-inline-start',
      'max-inline-size',
      'text-align: start',
    ]) {
      assert.ok(layout.includes(property), `expected logical property: ${property}`);
    }
  });

  test('guards against horizontal overflow', () => {
    assert.ok(layout.includes('overflow-x: hidden'));
    assert.ok(layout.includes('max-inline-size: 100%'));
  });

  test('the auth panel is capped by token, not a fixed pixel width', () => {
    assert.ok(layout.includes('max-inline-size: var(--cyf-width-form)'));

    // No px-based box sizing large enough to cause overflow. Anchored so a
    // media-query feature (`min-width: 768px` — a breakpoint, not a box) does
    // not match, and values below 5px are ignored so the standard
    // visually-hidden 1px clip in `.cyf-sr-only` is not flagged.
    const offenders = [...layout.matchAll(
      /(?:^|[\s;{])(width|max-width|inline-size|max-inline-size):\s*(\d+)px/gm
    )].filter((match) => Number(match[2]) > 4);

    assert.deepEqual(
      offenders.map((match) => match[0].trim()),
      [],
      'layout must not use fixed pixel widths'
    );
  });

  test('a visible focus ring is provided via :focus-visible', () => {
    assert.ok(layout.includes(':focus-visible'));
    assert.ok(layout.includes('outline: var(--cyf-focus-ring-width)'));
  });

  test('accessibility helpers exist', () => {
    assert.ok(layout.includes('.cyf-sr-only'));
    assert.ok(layout.includes('.cyf-skip-link'));
  });

  test('the auth layout is single-column until 1024px', () => {
    assert.ok(layout.includes('grid-template-columns: 1fr'));
    assert.ok(layout.includes('@media (min-width: 1024px)'));
    // The informational aside is hidden below the split breakpoint.
    assert.ok(layout.includes('.cyf-auth-aside'));
    assert.ok(layout.includes('display: none'));
  });
});

describe('no future product feature leaked into the frontend', () => {
  test('the route table declares no future product route', () => {
    const routes = read('app/app.routes.ts');
    for (const future of [
      "path: 'join'",
      "path: 'reels'",
      "path: 'batches'",
      "path: 'students'",
      "path: 'resources'",
      "path: 'tasks'",
    ]) {
      assert.ok(!routes.includes(future), `future route found: ${future}`);
    }
  });

  test('the Student auth page performs no authentication', () => {
    const student = read('app/pages/auth/student-auth.component.ts');
    const template = read('app/pages/auth/student-auth.component.html');

    // No service that could sign anyone in, and no imperative navigation.
    // `RouterLink` is fine — it is declarative markup for the Admin link.
    assert.ok(!student.includes('AuthApiService'));
    assert.ok(!student.includes('SessionService'));
    assert.ok(!student.includes('HttpClient'));
    assert.ok(!/inject\(\s*Router\s*\)/.test(student), 'no imperative Router');
    assert.ok(!/\.navigate(ByUrl)?\(/.test(student), 'no programmatic navigation');
    assert.ok(!student.includes('localStorage'), 'no direct session write');
    // No click handler on the Google control. Comments are stripped first —
    // the template documents its own "no (click) handler" rule in prose.
    const markup = template.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/\(click\)/.test(markup), 'Student page must have no click handler');
    assert.ok(!/\(submit\)|\(ngSubmit\)/.test(markup), 'Student page must have no form submit');

    // The Google control is disabled, so it is inert for pointer, keyboard and
    // programmatic activation alike.
    assert.ok(/class="cyf-btn-outline cyf-google-btn"[\s\S]*?disabled/.test(markup));
  });

  test('no Google OAuth dependency was added', () => {
    const packageJson = readFileSync(
      join(REPO_ROOT, 'frontend', 'package.json'),
      'utf8'
    );
    for (const forbidden of [
      'google-auth-library',
      'gapi',
      '@abacritt/angularx-social-login',
      'google-one-tap',
      '@react-oauth',
    ]) {
      assert.ok(!packageJson.includes(forbidden), `Google package found: ${forbidden}`);
    }
  });
});
