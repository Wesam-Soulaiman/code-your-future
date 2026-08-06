import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PublicStudentProfile } from '../../models/PublicTalent';
import { useTranslations } from '../../testing/i18n-testing';
import { PublicStudentProfileComponent } from './public-student-profile.component';

/**
 * A public student profile ⟨CP8⟩.
 *
 * The assertions that matter: an unknown slug and a withdrawn one are
 * indistinguishable, nothing on the page is editable, and a video is a poster
 * until somebody asks for it.
 */

const PROFILE: PublicStudentProfile = {
  slug: 'k3mq7wz2ptx9',
  name: 'Lina Haddad',
  targetRole: 'Frontend Developer',
  city: 'Damascus',
  educationStatus: 'GRADUATE',
  about: 'I want to build accessible interfaces people actually enjoy.',
  githubUrl: 'https://github.com/lina',
  linkedinUrl: 'https://www.linkedin.com/in/lina',
  portfolioUrl: 'https://lina.example',
  technologies: ['Angular', 'Parse Server'],
  projects: [
    {
      title: 'Neighbourhood Recipe Exchange',
      description: 'A place for one street to swap recipes.',
      contribution: 'I built the whole front end.',
      technologies: ['Angular', 'Parse Server'],
      video: {
        videoId: 'dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
        watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      isDemo: true,
      githubUrl: 'https://github.com/lina/recipes',
      liveDemoUrl: 'https://recipes.example',
    },
  ],
};

describe('PublicStudentProfileComponent ⟨CP8⟩', () => {
  let fixture: ComponentFixture<PublicStudentProfileComponent>;
  let http: HttpTestingController;

  async function mount(slug: string | null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PublicStudentProfileComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => slug } } },
        },
      ],
    }).compileComponents();

    useTranslations(TestBed.inject(TranslateService));
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PublicStudentProfileComponent);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    http?.verify();
    fixture?.destroy();
  });

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function load(profile: PublicStudentProfile): void {
    fixture.detectChanges();
    const request = http.expectOne((candidate) =>
      candidate.url.includes('talent/getTalentProfile'),
    );
    expect(request.request.params.get('slug')).toBe('k3mq7wz2ptx9');
    request.flush(profile);
    fixture.detectChanges();
  }

  // ── What it shows ─────────────────────────────────────────────────────────

  it('shows everything the Student chose to publish', async () => {
    await mount('k3mq7wz2ptx9');
    load(PROFILE);

    const shown = text();
    expect(shown).toContain('Lina Haddad');
    expect(shown).toContain('Frontend Developer');
    expect(shown).toContain('Damascus');
    expect(shown).toContain('accessible interfaces');
    expect(shown).toContain('Neighbourhood Recipe Exchange');
    expect(shown).toContain('I built the whole front end');
    expect(shown).toContain('Angular');
  });

  it('opens every outbound link safely', async () => {
    await mount('k3mq7wz2ptx9');
    load(PROFILE);

    // These addresses were supplied by a Student. An opened page must not be
    // able to reach back into this one.
    const external = Array.from(
      fixture.nativeElement.querySelectorAll('a[target="_blank"]'),
    ) as HTMLAnchorElement[];
    expect(external.length).toBeGreaterThan(0);
    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('has nothing editable and no admin control', async () => {
    await mount('k3mq7wz2ptx9');
    load(PROFILE);

    expect(fixture.nativeElement.querySelectorAll('input, textarea, select').length).toBe(0);
    const shown = text();
    for (const absent of ['Edit', 'Delete', 'Unpublish', 'Publish again', 'Save']) {
      expect(shown).not.toContain(absent);
    }
  });

  // ── The video ─────────────────────────────────────────────────────────────

  it('shows a poster rather than mounting a player on arrival', async () => {
    await mount('k3mq7wz2ptx9');
    load(PROFILE);

    // A profile with several projects must not pull in a player per project
    // before anybody asks to watch anything.
    expect(fixture.nativeElement.querySelectorAll('iframe').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.cyf-public-video-poster')).not.toBeNull();
  });

  it('mounts the player only when asked', async () => {
    await mount('k3mq7wz2ptx9');
    load(PROFILE);

    (
      fixture.nativeElement.querySelector('.cyf-public-video-poster') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const frames = fixture.nativeElement.querySelectorAll('iframe');
    expect(frames.length).toBe(1);
    expect(frames[0].getAttribute('src')).toContain(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    );
  });

  it('never puts anything but a valid id in an iframe src', async () => {
    await mount('k3mq7wz2ptx9');
    load({
      ...PROFILE,
      projects: [
        {
          ...PROFILE.projects[0],
          video: {
            videoId: '"><script>alert(1)</script>',
            embedUrl: 'javascript:alert(1)',
            watchUrl: 'javascript:alert(1)',
          },
        },
      ],
    });

    (
      fixture.nativeElement.querySelector('.cyf-public-video-poster') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    // No player rather than a malformed one.
    expect(fixture.nativeElement.querySelectorAll('iframe').length).toBe(0);
  });

  // ── Not found ─────────────────────────────────────────────────────────────

  it('renders one "not available" for a slug that does not exist', async () => {
    await mount('k3mq7wz2ptx9');
    fixture.detectChanges();
    http
      .expectOne((candidate) => candidate.url.includes('getTalentProfile'))
      .flush({ code: 101, error: 'PUBLIC_PROFILE_NOT_FOUND' }, {
        status: 404,
        statusText: 'Not Found',
      });
    fixture.detectChanges();

    expect(text()).toContain('not available');
  });

  it('renders the same thing when consent was withdrawn', async () => {
    // The server answers identically, and this page cannot tell them apart
    // either — which is what stops somebody learning that a person is there
    // but hidden.
    await mount('k3mq7wz2ptx9');
    fixture.detectChanges();
    http
      .expectOne((candidate) => candidate.url.includes('getTalentProfile'))
      .flush({ code: 101, error: 'PUBLIC_PROFILE_NOT_FOUND' }, {
        status: 404,
        statusText: 'Not Found',
      });
    fixture.detectChanges();

    const shown = text();
    expect(shown).toContain('not available');
    // No hint that somebody exists behind it.
    expect(shown).not.toContain('withdrawn');
    expect(shown).not.toContain('hidden');
    expect(shown).not.toContain('consent');
  });

  it('asks for nothing at all without a slug', async () => {
    await mount(null);
    fixture.detectChanges();
    // `verify()` in afterEach fails this test if a request went out.
    expect(text()).toContain('not available');
  });
});
