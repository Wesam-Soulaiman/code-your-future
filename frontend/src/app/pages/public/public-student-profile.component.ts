import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { finalize } from 'rxjs';

import { PublicProject, PublicStudentProfile } from '../../models/PublicTalent';
import { ChangeLangService } from '../../services/change-lang.service';
import { PublicTalentApiService } from '../../services/dataService/public-talent-service';
import { educationStatusKey } from '../../utils/public-talent-constants';

/**
 * A public student profile ⟨CP8⟩.
 *
 * ── Nothing here is editable, and nothing here is an admin control ──────────
 * This page renders what a Student chose to publish. There is no button that
 * changes anything, because there is no public endpoint that would accept one.
 *
 * ── An unknown slug and a withdrawn one look identical ──────────────────────
 * That is the server's decision and this page keeps it: both render the same
 * "not found". Distinguishing them would tell somebody who guessed a real slug
 * that a person is there but hidden.
 *
 * ── The embed URL is trusted because of where it came from ──────────────────
 * `bypassSecurityTrustResourceUrl` is used, and that deserves justification.
 * The value is not user input: the server validated the URL against three
 * canonical YouTube forms, kept only the eleven-character id, and rebuilt
 * `https://www.youtube.com/embed/{id}` from that id alone. This page re-checks
 * that shape before trusting it, so the sanitiser is being told something that
 * has already been proven rather than being talked out of its job.
 */
@Component({
  selector: 'cyf-public-student-profile',
  imports: [TranslateModule, RouterLink],
  templateUrl: './public-student-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicStudentProfileComponent {
  private api = inject(PublicTalentApiService);
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  protected loading = signal(true);
  protected notFound = signal(false);
  protected profile = signal<PublicStudentProfile | null>(null);

  /** Which project's video the Visitor has chosen to load. */
  private playing = signal<string | null>(null);

  constructor() {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.load(slug);
  }

  private load(slug: string): void {
    if (!slug) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }

    this.api
      .getStudent(slug)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (profile) => {
          this.profile.set(profile);
          this.changeDetector.markForCheck();
        },
        // Every failure is "not found". A Visitor learns nothing from the
        // difference between a slug that never existed and one whose owner
        // withdrew consent this morning.
        error: () => {
          this.notFound.set(true);
          this.changeDetector.markForCheck();
        },
      });
  }

  protected photoSrc = computed(() => {
    const url = this.profile()?.photoUrl;
    return url ? this.api.photoUrl(url) : '';
  });

  protected initial = computed(() => {
    const name = this.profile()?.name?.trim() ?? '';
    return (name[0] ?? '?').toUpperCase();
  });

  /** A readable label for the stored education status. */
  protected educationLabel = computed(() => educationStatusKey(this.profile()?.educationStatus));

  protected hasLinks = computed(() => {
    const profile = this.profile();
    return Boolean(profile?.githubUrl || profile?.linkedinUrl || profile?.portfolioUrl);
  });

  /** Whether this project's iframe has been asked for. */
  protected isPlaying(project: PublicProject): boolean {
    return this.playing() === project.video.videoId;
  }

  /**
   * Load one video, on request.
   *
   * A profile can hold several projects, and mounting an iframe for each on
   * arrival would pull in a YouTube player per project before anybody asked to
   * watch anything. The poster is a plain image until it is clicked.
   */
  protected play(project: PublicProject): void {
    this.playing.set(project.video.videoId);
  }

  /**
   * The thumbnail YouTube publishes for an id.
   *
   * An image rather than an iframe: it costs one request instead of a player,
   * and it is the same id the embed would use, so there is nothing extra to
   * trust.
   */
  protected posterFor(project: PublicProject): string {
    return `https://i.ytimg.com/vi/${encodeURIComponent(project.video.videoId)}/hqdefault.jpg`;
  }

  /**
   * The embed URL, checked before it is trusted.
   *
   * The server already validated and rebuilt it. This re-derives the shape from
   * the id rather than trusting the string it was handed, so a response that
   * somehow carried something else could not reach an `iframe src`.
   */
  protected embedUrl(project: PublicProject): SafeResourceUrl | null {
    const id = project.video.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${id}?rel=0`,
    );
  }
}
