import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SelectModule } from 'primeng/select';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { ImageCropperDialogComponent } from '../../components/shared/image-cropper-dialog/image-cropper-dialog.component';
import { BrandMarkComponent } from '../../components/shared/brand-mark.component';
import { LanguageSwitchComponent } from '../../components/shared/language-switch.component';
import { STUDENT_HOME } from '../../guards/home-route';
import { ProfileCatalogItem, ProfileCatalogMap, catalogItemName } from '../../models/ProfileCatalogItem';
import { StudentProfile, StudentProfileInput } from '../../models/StudentProfile';
import { ChangeLangService } from '../../services/change-lang.service';
import { ProfileCatalogApiService } from '../../services/dataService/profile-catalog-service';
import { StudentProfileApiService } from '../../services/dataService/student-profile-service';
import { StudentAuthApiService } from '../../services/dataService/student-auth-service';
import { SessionService } from '../../services/session.service';
import { ProfileErrorKey, mapProfileError } from '../../utils/profile-error';
import { CATALOG_TYPE, CatalogType } from '../../utils/profile-catalog-constants';
import {
  EDUCATION_STATUS,
  EDUCATION_STATUSES,
  LIMITS,
  PHONE_PATTERN,
  PHOTO,
  PHOTO_ACCEPT,
} from '../../utils/student-profile-constants';

/**
 * The form's own working copy.
 *
 * Catalog selections are held as **ids**, which is exactly what is sent: a name
 * the browser holds is a label to draw, never a value to save.
 *
 * The two dates are real `Date` objects because that is what the PrimeNG
 * DatePicker binds to. They are serialised at the boundary, so nothing
 * downstream has to know which representation the picker prefers.
 */
interface ProfileForm {
  fullName: string;
  phone: string;
  cityId: string;
  dateOfBirth: Date | null;
  institutionId: string;
  customInstitutionName: string;
  majorId: string;
  educationStatus: string;
  expectedGraduationMonth: Date | null;
  careerGoal: string;
  targetRoleId: string;
  targetRoleReason: string;
  githubUrl: string;
  linkedinUrl: string;
  portfolioUrl: string;
}

const EMPTY_FORM: ProfileForm = {
  fullName: '',
  phone: '',
  cityId: '',
  dateOfBirth: null,
  institutionId: '',
  customInstitutionName: '',
  majorId: '',
  educationStatus: '',
  expectedGraduationMonth: null,
  careerGoal: '',
  targetRoleId: '',
  targetRoleReason: '',
  githubUrl: '',
  linkedinUrl: '',
  portfolioUrl: '',
};

/** One option in a searchable select. */
export interface CatalogOption {
  value: string;
  label: string;
  /** True when the item has been retired since this profile chose it. */
  retired: boolean;
  /** The escape hatch that demands a typed institution name. */
  isOther: boolean;
  /** `UNIVERSITY` / `INSTITUTE` / `OTHER`, for the institution select only. */
  kind?: string;
}

/**
 * Complete Profile — the first real product page.
 *
 * Built entirely from the Checkpoint 2A design system: the tokens, the `.cyf-*`
 * type scale, and the existing field, card, alert, and button primitives, plus
 * the PrimeNG Select and DatePicker restyled through those same tokens. No new
 * design foundation and no redesign of the old one.
 *
 * ── What it does and does not decide ────────────────────────────────────────
 * The form validates as you go so mistakes surface early, but **the backend is
 * the authority**. It re-validates everything, resolves every catalog selection
 * from the id, calculates completion, and its field-level rejections replace
 * whatever the client thought.
 *
 * ── The save order ──────────────────────────────────────────────────────────
 * Picking a photo before the first save used to upload it immediately, against
 * a profile that did not exist yet — which is precisely what returned
 * `PROFILE_UNAVAILABLE`. Selecting an image is now a **local preview**; the
 * single Save action writes the profile first and only then uploads. If the
 * upload is the part that fails, the saved profile stands and the message says
 * so, because throwing away twelve correct fields over one image would be the
 * worse outcome.
 *
 * ── Honesty ─────────────────────────────────────────────────────────────────
 * There is no progress percentage and no statistic. A count of what is still
 * required is derived from the actual fields, so it cannot drift from reality.
 */
@Component({
  selector: 'app-student-profile',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    AlertComponent,
    BrandMarkComponent,
    LanguageSwitchComponent,
  ],
  templateUrl: './student-profile.component.html',
  styleUrl: './student-profile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Dynamic dialogs are opened per component, so the service is provided here
  // rather than globally: nothing else in the app opens one yet.
  providers: [DialogService],
})
export class StudentProfileComponent implements OnDestroy {
  private profileApi = inject(StudentProfileApiService);
  private catalogApi = inject(ProfileCatalogApiService);
  private studentAuthApi = inject(StudentAuthApiService);
  private router = inject(Router);
  private changeDetector = inject(ChangeDetectorRef);
  protected sessionService = inject(SessionService);
  protected langService = inject(ChangeLangService);
  private dialogService = inject(DialogService);
  private translate = inject(TranslateService);

  /** The open cropper, so it can be closed if the page goes away under it. */
  private cropperRef: DynamicDialogRef | null = null;

  /** Options and bounds, straight from the shared constants. */
  protected readonly educationStatuses = EDUCATION_STATUSES;
  protected readonly currentStudentStatus = EDUCATION_STATUS.CURRENT_STUDENT;
  protected readonly limits = LIMITS;
  protected readonly photoAccept = PHOTO_ACCEPT;
  protected readonly maxPhotoMb = Math.round(PHOTO.maxBytes / (1024 * 1024));

  /**
   * The latest date of birth the picker will accept.
   *
   * Today, so a future birthday is simply not reachable rather than typed and
   * then rejected. The lower age bound stays a validation rule, because a
   * picker that refuses to open on 2015 is confusing in a way a message is not.
   */
  protected readonly maxBirthDate = new Date();

  protected loading = signal(true);
  protected catalogLoading = signal(true);
  protected saving = signal(false);
  protected photoBusy = signal(false);
  protected saved = signal(false);

  /** Page-level failure, or null. Always a translation key. */
  protected errorKey = signal<ProfileErrorKey | null>(null);

  /** The profile saved but the photo did not. Shown as a warning, not an error. */
  protected partialSuccess = signal(false);

  /** Field name → translation key, from the backend's rejection. */
  protected serverFieldErrors = signal<Record<string, string>>({});

  /** Fields the user has interacted with, so errors appear when earned. */
  protected touched = signal<Record<string, boolean>>({});

  /** True once the user submits, which reveals every outstanding problem. */
  protected submitted = signal(false);

  protected form = signal<ProfileForm>({ ...EMPTY_FORM });

  /** The saved copy, for unsaved-change detection. */
  private pristine = signal<string>(JSON.stringify(EMPTY_FORM));

  protected profile = signal<StudentProfile | null>(null);

  /** The active catalog, keyed by category. */
  protected catalog = signal<ProfileCatalogMap>({});

  /**
   * The name Google supplied, prefilled into the field on a first visit.
   *
   * Held so the hint can disappear the moment the Student edits it: once they
   * have made the name their own, saying where it originally came from is
   * noise. Cleared for good after the first save.
   */
  private suggestedName = signal<string>('');

  /** True while the field still holds exactly what Google supplied. */
  protected showNameFromGoogle = computed(
    () => this.suggestedName().length > 0 && this.form().fullName === this.suggestedName(),
  );

  /** True when the catalog could not be loaded at all. */
  protected catalogFailed = signal(false);

  /**
   * The image to show: an object URL for the stored photo, or a local data URL
   * for one that has been chosen but not yet uploaded. Never a remote URL.
   */
  protected photoPreview = signal<string | null>(null);

  /** An object URL that must be revoked when it is replaced or the page leaves. */
  private objectUrl: string | null = null;

  /**
   * A photo chosen but not yet sent.
   *
   * Held here rather than uploaded on selection, so a Student filling the form
   * for the first time has something to attach it to by the time it is sent.
   */
  protected pendingPhoto = signal<File | null>(null);

  protected verifiedEmail = computed(() => this.profile()?.verifiedEmail ?? '');
  protected isEditing = computed(() => this.profile()?.isComplete === true);

  /** True when the working copy differs from what was last saved. */
  protected hasUnsavedChanges = computed(
    () => JSON.stringify(this.form()) !== this.pristine() || this.pendingPhoto() !== null,
  );

  // ── Catalog options ───────────────────────────────────────────────────────

  /**
   * Build the options for one category.
   *
   * The list is the **active** items, plus — when the profile already points at
   * something an Admin has since retired — that one item, marked `retired`. It
   * has to appear or the select would show a blank where the Student's answer
   * used to be; it is marked so they can tell it is no longer on offer, and the
   * backend still refuses it as a *new* choice for anybody else.
   */
  private buildOptions(type: CatalogType, selected: ProfileCatalogItem | undefined): CatalogOption[] {
    const language = this.langService.currentLang();
    const items = [...(this.catalog()[type] ?? [])];

    if (selected && !items.some((item) => item.id === selected.id)) {
      items.push(selected);
    }

    return items.map((item) => ({
      value: item.id,
      label: catalogItemName(item, language),
      retired: item.active !== true,
      isOther: item.isOther === true,
      kind: item.institutionKind,
    }));
  }

  protected cityOptions = computed(() =>
    this.buildOptions(CATALOG_TYPE.CITY, this.profile()?.city),
  );
  protected institutionOptions = computed(() =>
    this.buildOptions(CATALOG_TYPE.INSTITUTION, this.profile()?.institution),
  );
  protected majorOptions = computed(() =>
    this.buildOptions(CATALOG_TYPE.MAJOR, this.profile()?.major),
  );
  protected targetRoleOptions = computed(() =>
    this.buildOptions(CATALOG_TYPE.TARGET_ROLE, this.profile()?.targetRole),
  );

  /** True when a category has nothing to offer, so the form can say so plainly. */
  protected cityEmpty = computed(() => this.cityOptions().length === 0);
  protected institutionEmpty = computed(() => this.institutionOptions().length === 0);
  protected majorEmpty = computed(() => this.majorOptions().length === 0);
  protected targetRoleEmpty = computed(() => this.targetRoleOptions().length === 0);

  /** The custom institution name is required only for the `isOther` item. */
  protected needsCustomInstitution = computed(() => {
    const id = this.form().institutionId;
    return this.institutionOptions().some((option) => option.value === id && option.isOther);
  });

  protected needsGraduationMonth = computed(
    () => this.form().educationStatus === EDUCATION_STATUS.CURRENT_STUDENT,
  );

  /** The reason only exists alongside a role, so the field only exists then too. */
  protected showTargetRoleReason = computed(() => this.form().targetRoleId.length > 0);

  protected targetRoleReasonLength = computed(() => this.form().targetRoleReason.length);

  /** Guards the language effect's first run, which the constructor covers. */
  private languageWatched = false;

  constructor() {
    this.load();
    this.loadCatalog();

    // Reload the catalog when the language changes: the server sorts by the
    // localised name, so the order — not just the labels — belongs to the
    // language being read.
    //
    // `untracked` matters: the reload writes `catalogLoading`, and reading that
    // signal inside a tracked effect would make the effect depend on its own
    // side effect and fetch forever. The language is the only dependency.
    effect(() => {
      const language = this.langService.currentLang();
      untracked(() => {
        if (this.languageWatched) this.loadCatalog(language);
        else this.languageWatched = true;
      });
    });
  }

  ngOnDestroy(): void {
    this.releaseObjectUrl();
    // A dialog outlives its opener unless it is told not to.
    this.cropperRef?.close();
    this.cropperRef = null;
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private load(): void {
    this.profileApi
      .getMyProfile()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (profile) => {
          this.profile.set(profile);
          const form = this.toForm(profile);
          this.form.set(form);
          this.pristine.set(JSON.stringify(form));
          // Only ever set on the empty shape, so editing later cannot resurrect
          // the hint and a saved profile never shows it.
          this.suggestedName.set(profile.nameFromProvider ? (profile.fullName ?? '') : '');
          if (profile.hasPhoto) this.loadPhoto();
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapProfileError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  private loadCatalog(language = this.langService.currentLang()): void {
    this.catalogLoading.set(true);
    this.catalogApi
      .getStudentCatalog(language)
      .pipe(finalize(() => this.catalogLoading.set(false)))
      .subscribe({
        next: (catalog) => {
          this.catalog.set(catalog ?? {});
          this.catalogFailed.set(false);
          this.changeDetector.markForCheck();
        },
        error: () => {
          // The form is unusable without its options, so this is stated rather
          // than left as four mysteriously empty selects.
          this.catalog.set({});
          this.catalogFailed.set(true);
          this.errorKey.set('student.profile.errors.catalogUnavailable');
          this.changeDetector.markForCheck();
        },
      });
  }

  private loadPhoto(): void {
    this.profileApi.getMyPhoto().subscribe({
      next: (blob) => {
        this.setObjectUrl(blob);
        this.changeDetector.markForCheck();
      },
      // A missing photo is not worth interrupting the form for.
      error: () => {
        this.releaseObjectUrl();
        this.photoPreview.set(null);
      },
    });
  }

  /** Swap in a new object URL, revoking whatever it replaces. */
  private setObjectUrl(blob: Blob): void {
    this.releaseObjectUrl();
    this.objectUrl = URL.createObjectURL(blob);
    this.photoPreview.set(this.objectUrl);
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** `YYYY-MM-DD` from a local date, as picked. The backend normalises to UTC. */
  private toDateOnly(value: Date | null): string | undefined {
    if (!value) return undefined;
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }

  /** `YYYY-MM` from a local date. The backend stores the first of that month, UTC. */
  private toMonth(value: Date | null): string | undefined {
    if (!value) return undefined;
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    return `${value.getFullYear()}-${month}`;
  }

  private fromDateOnly(value: string | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private fromMonth(value: string | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, 1);
  }

  private toForm(profile: StudentProfile): ProfileForm {
    return {
      fullName: profile.fullName ?? '',
      phone: profile.phone ?? '',
      cityId: profile.city?.id ?? '',
      dateOfBirth: this.fromDateOnly(profile.dateOfBirth),
      institutionId: profile.institution?.id ?? '',
      customInstitutionName: profile.customInstitutionName ?? '',
      majorId: profile.major?.id ?? '',
      educationStatus: profile.educationStatus ?? '',
      expectedGraduationMonth: this.fromMonth(profile.expectedGraduationMonth),
      careerGoal: profile.careerGoal ?? '',
      targetRoleId: profile.targetRole?.id ?? '',
      targetRoleReason: profile.targetRoleReason ?? '',
      githubUrl: profile.githubUrl ?? '',
      linkedinUrl: profile.linkedinUrl ?? '',
      portfolioUrl: profile.portfolioUrl ?? '',
    };
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  protected update<K extends keyof ProfileForm>(field: K, value: ProfileForm[K]): void {
    this.form.update((current) => {
      const next = { ...current, [field]: value };

      // The reason belongs to the role. Clearing the role clears the answer,
      // rather than leaving text behind under a question nobody can see.
      if (field === 'targetRoleId' && !value) next.targetRoleReason = '';

      // Likewise a typed institution name only means anything under "Other".
      if (field === 'institutionId') {
        const stillOther = this.institutionOptions().some(
          (option) => option.value === value && option.isOther,
        );
        if (!stillOther) next.customInstitutionName = '';
      }

      // A graduate has already graduated; the product clears the expected date.
      if (field === 'educationStatus' && value !== EDUCATION_STATUS.CURRENT_STUDENT) {
        next.expectedGraduationMonth = null;
      }

      return next;
    });

    this.touched.update((current) => ({ ...current, [field]: true }));
    this.saved.set(false);
    this.partialSuccess.set(false);

    // A stale server rejection must not sit under a field being corrected.
    if (this.serverFieldErrors()[field]) {
      this.serverFieldErrors.update((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  protected markTouched(field: keyof ProfileForm): void {
    this.touched.update((current) => ({ ...current, [field]: true }));
  }

  // ── Client-side validation ────────────────────────────────────────────────

  /**
   * The first problem with a field, or null.
   *
   * Mirrors the backend's rules closely enough to be useful, and never
   * contradicts it: anything this accepts the server may still reject, and that
   * rejection wins.
   */
  private validateField(field: keyof ProfileForm): string | null {
    const raw = this.form()[field];
    const value = typeof raw === 'string' ? raw.trim() : raw;

    switch (field) {
      case 'fullName': {
        const text = String(value ?? '');
        if (!text) return 'student.profile.fieldErrors.required';
        if (text.length < LIMITS.fullName.min) return 'student.profile.fieldErrors.tooShort';
        if (text.length > LIMITS.fullName.max) return 'student.profile.fieldErrors.tooLong';
        return null;
      }

      case 'phone': {
        const text = String(value ?? '');
        if (!text) return 'student.profile.fieldErrors.required';
        if (!PHONE_PATTERN.test(text)) return 'student.profile.fieldErrors.invalid';
        return null;
      }

      case 'cityId':
      case 'majorId':
      case 'institutionId':
        if (!value) return 'student.profile.fieldErrors.required';
        return null;

      case 'customInstitutionName': {
        if (!this.needsCustomInstitution()) return null;
        const text = String(value ?? '');
        if (!text) return 'student.profile.fieldErrors.required';
        if (text.length < LIMITS.customInstitutionName.min) {
          return 'student.profile.fieldErrors.tooShort';
        }
        return null;
      }

      case 'educationStatus':
        if (!value) return 'student.profile.fieldErrors.required';
        return null;

      case 'expectedGraduationMonth':
        if (!this.needsGraduationMonth()) return null;
        if (!value) return 'student.profile.fieldErrors.required';
        return null;

      case 'careerGoal':
        if (String(value ?? '').length > LIMITS.careerGoal.max) {
          return 'student.profile.fieldErrors.tooLong';
        }
        return null;

      case 'targetRoleReason':
        // Optional, and only meaningful with a role. Never blocks a save.
        if (!this.showTargetRoleReason()) return null;
        if (String(value ?? '').length > LIMITS.targetRoleReason.max) {
          return 'student.profile.fieldErrors.tooLong';
        }
        return null;

      case 'githubUrl':
        return this.validateUrlField(String(value ?? ''), ['github.com', 'www.github.com']);

      case 'linkedinUrl':
        return this.validateUrlField(String(value ?? ''), ['linkedin.com', 'www.linkedin.com']);

      case 'portfolioUrl':
        return this.validateUrlField(String(value ?? ''));

      default:
        return null;
    }
  }

  private validateUrlField(value: string, hosts?: string[]): string | null {
    if (!value) return null;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return 'student.profile.fieldErrors.invalid';
    }

    // Only http(s): this is what rejects javascript:, data:, and file:.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'student.profile.fieldErrors.invalid';
    }
    if (hosts && !hosts.includes(parsed.hostname.toLowerCase())) {
      return 'student.profile.fieldErrors.wrongDomain';
    }
    if (hosts && parsed.pathname.replace(/\/+$/, '').length === 0) {
      return 'student.profile.fieldErrors.invalid';
    }
    return null;
  }

  /** The message to show under a field: the server's, else the client's. */
  protected fieldError(field: keyof ProfileForm): string | null {
    const fromServer = this.serverFieldErrors()[field];
    if (fromServer) return fromServer;

    const shouldShow = this.submitted() || this.touched()[field] === true;
    return shouldShow ? this.validateField(field) : null;
  }

  protected hasError(field: keyof ProfileForm): boolean {
    return this.fieldError(field) !== null;
  }

  /** Required fields still outstanding. A real count, never a fake percentage. */
  protected missingRequiredCount = computed(() => {
    const fields: (keyof ProfileForm)[] = [
      'fullName',
      'phone',
      'cityId',
      'institutionId',
      'customInstitutionName',
      'majorId',
      'educationStatus',
      'expectedGraduationMonth',
    ];
    const form = this.form();
    return fields.filter((field) => {
      if (field === 'customInstitutionName' && !this.needsCustomInstitution()) return false;
      if (field === 'expectedGraduationMonth' && !this.needsGraduationMonth()) return false;
      const value = form[field];
      if (value instanceof Date) return false;
      return String(value ?? '').trim().length === 0;
    }).length;
  });

  // ── Saving ────────────────────────────────────────────────────────────────

  /**
   * One coherent Save.
   *
   * Validate → save the profile → upload the pending photo, if any → refresh
   * the session → navigate. The order is the whole point: the photo endpoint
   * needs a profile to attach to, and on a first save there is none until this
   * call creates it.
   */
  protected save(): void {
    // Re-entrancy guard: the button is disabled while saving, but Enter can
    // still reach the form handler.
    if (this.saving() || this.photoBusy()) return;

    this.submitted.set(true);
    this.errorKey.set(null);
    this.partialSuccess.set(false);
    this.saved.set(false);

    const fields = Object.keys(this.form()) as (keyof ProfileForm)[];
    const invalid = fields.filter((field) => this.validateField(field) !== null);
    if (invalid.length > 0) {
      this.errorKey.set('student.profile.errors.validation');
      this.focusFirstError();
      return;
    }

    this.saving.set(true);
    this.serverFieldErrors.set({});

    this.profileApi.saveMyProfile(this.toInput()).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.pristine.set(JSON.stringify(this.form()));
        this.submitted.set(false);
        // The name is the Student's own from here on.
        this.suggestedName.set('');

        const pending = this.pendingPhoto();
        if (pending) {
          this.uploadPendingPhoto(pending);
          return;
        }

        this.saving.set(false);
        this.saved.set(true);
        // The save that creates a profile may have imported the Student's
        // Google photo, so `hasPhoto` can become true without an upload.
        if (profile.hasPhoto && !this.photoPreview()) this.loadPhoto();
        this.finishSave(profile);
      },
      error: (error: unknown) => {
        // The profile did not save, so the photo is not sent: attaching an image
        // to details that were rejected would be attaching it to nothing.
        this.saving.set(false);
        const failure = mapProfileError(error);
        this.errorKey.set(failure.key);
        this.serverFieldErrors.set(this.toFormFieldErrors(failure.fields));
        this.focusFirstError();
        this.changeDetector.markForCheck();
      },
    });
  }

  /**
   * Upload the photo the Student chose before the profile existed.
   *
   * A failure here is **not** a failed save. The profile is already stored and
   * stays stored; the page says the details are saved but the photo is not, and
   * the file is kept so it can be retried without re-entering the form.
   */
  private uploadPendingPhoto(file: File): void {
    this.profileApi
      .uploadPhoto(file)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.pendingPhoto.set(null);
          this.saved.set(true);
          // Re-read the profile so `hasPhoto` and the photo version come from
          // the server rather than from an assumption.
          this.profileApi.getMyProfile().subscribe({
            next: (refreshed) => {
              this.profile.set(refreshed);
              this.loadPhoto();
              this.finishSave(refreshed);
            },
            error: () => this.finishSave(this.profile()),
          });
        },
        error: (error: unknown) => {
          // Keep the file; keep the saved profile; say exactly what happened.
          this.partialSuccess.set(true);
          this.errorKey.set(mapProfileError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  /** Refresh the session, then leave if the server says the profile is done. */
  private finishSave(profile: StudentProfile | null): void {
    this.studentAuthApi.restoreSession().finally(() => {
      this.changeDetector.markForCheck();
      // Completion is the server's answer, never the form's.
      if (profile?.isComplete && !this.partialSuccess()) {
        this.router.navigate([STUDENT_HOME]);
      }
    });
  }

  /**
   * Map the backend's field names onto the form's.
   *
   * The API names the catalog selections `cityId`, `institutionId`, … and the
   * form fields have the same names, so this is mostly identity — it exists so
   * a future rename on either side fails visibly here rather than silently
   * dropping an error message.
   */
  private toFormFieldErrors(fields: Record<string, string>): Record<string, string> {
    const mapped: Record<string, string> = {};
    for (const [field, key] of Object.entries(fields)) mapped[field] = key;
    return mapped;
  }

  /** Move focus to the first field with a problem, so keyboard users land on it. */
  private focusFirstError(): void {
    if (typeof document === 'undefined') return;
    queueMicrotask(() => {
      const target = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      target?.focus();
    });
  }

  private toInput(): StudentProfileInput {
    const form = this.form();
    const input: StudentProfileInput = {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      cityId: form.cityId,
      institutionId: form.institutionId,
      majorId: form.majorId,
      educationStatus: form.educationStatus,
    };

    const dateOfBirth = this.toDateOnly(form.dateOfBirth);
    if (dateOfBirth) input.dateOfBirth = dateOfBirth;

    if (this.needsCustomInstitution() && form.customInstitutionName) {
      input.customInstitutionName = form.customInstitutionName.trim();
    }

    const graduation = this.toMonth(form.expectedGraduationMonth);
    if (this.needsGraduationMonth() && graduation) {
      input.expectedGraduationMonth = graduation;
    }

    if (form.careerGoal.trim()) input.careerGoal = form.careerGoal.trim();

    // The reason travels only with the role it explains.
    if (form.targetRoleId) {
      input.targetRoleId = form.targetRoleId;
      if (form.targetRoleReason.trim()) input.targetRoleReason = form.targetRoleReason.trim();
    }

    if (form.githubUrl.trim()) input.githubUrl = form.githubUrl.trim();
    if (form.linkedinUrl.trim()) input.linkedinUrl = form.linkedinUrl.trim();
    if (form.portfolioUrl.trim()) input.portfolioUrl = form.portfolioUrl.trim();

    return input;
  }

  // ── Photo ─────────────────────────────────────────────────────────────────

  /**
   * Selecting a photo is a **local preview**, never an upload.
   *
   * A Student filling the form for the first time has no profile yet, so there
   * is nothing to attach an image to. The file is held until Save, which
   * creates the profile first.
   */
  protected onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear immediately so choosing the same file twice still fires.
    input.value = '';
    if (!file || this.photoBusy() || this.saving()) return;

    // Checked before the cropper opens, so an unusable file is refused while
    // the Student still has the file picker in mind rather than after they
    // have spent time framing a crop.
    if (file.size === 0 || file.size > PHOTO.maxBytes) {
      this.errorKey.set('student.profile.errors.photoTooLarge');
      return;
    }
    if (!PHOTO.mimeTypes.includes(file.type)) {
      this.errorKey.set('student.profile.errors.photoRejected');
      return;
    }

    this.errorKey.set(null);
    this.partialSuccess.set(false);
    this.saved.set(false);
    this.openCropper(file);
  }

  /**
   * Frame the photo before it is kept.
   *
   * A profile photo is rendered in a circle, so what a Student sees is a square
   * crop of whatever they picked — chosen by the browser, from the centre, with
   * no say from them. Letting them place that square themselves is the
   * difference between a portrait and an arbitrary rectangle of somebody's
   * shoulder.
   *
   * `aspectRatio: 1` and `maintainAspectRatio` therefore match the avatar
   * exactly: the crop the Student frames is the image that gets stored, not an
   * approximation of it.
   *
   * The dialog is the shared `image-cropper-dialog` the template already
   * carried, used as it stands.
   */
  private openCropper(file: File): void {
    this.cropperRef?.close();

    const opened = this.dialogService.open(ImageCropperDialogComponent, {
      header: this.translate.instant('student.profile.cropper.title'),
      data: {
        // Square, to match the circular avatar it becomes.
        aspectRatio: 1,
        maintainAspectRatio: true,
        imageFile: file,
        // The backend re-encodes to WebP regardless; producing it here means
        // what the Student previews is what gets uploaded.
        format: 'webp',
        max_image_width: 400,
      },
      width: 'min(30rem, 92vw)',
      // The dialog is appended to the body, outside the page's own direction.
      style: { direction: this.langService.currentDirection() },
      modal: true,
      closable: true,
      dismissableMask: true,
    });

    // PrimeNG returns null if the dialog cannot be opened. Refusing silently
    // would leave the Student clicking a button that appears to do nothing.
    if (!opened) {
      this.errorKey.set('student.profile.errors.photoRejected');
      this.changeDetector.markForCheck();
      return;
    }
    this.cropperRef = opened;

    opened.onClose.subscribe((croppedBase64: string | undefined) => {
      this.cropperRef = null;
      // Dismissed. Whatever photo was already there stays there — cancelling a
      // crop is not a request to remove anything.
      if (!croppedBase64) {
        this.changeDetector.markForCheck();
        return;
      }

      const cropped = this.toPhotoFile(croppedBase64);
      if (!cropped) {
        this.errorKey.set('student.profile.errors.photoRejected');
        this.changeDetector.markForCheck();
        return;
      }

      // Re-checked after cropping: the result is a different image from the one
      // that passed the check above.
      if (cropped.size === 0 || cropped.size > PHOTO.maxBytes) {
        this.errorKey.set('student.profile.errors.photoTooLarge');
        this.changeDetector.markForCheck();
        return;
      }

      this.pendingPhoto.set(cropped);
      // Shown straight from the cropped bytes. Nothing has left the browser yet.
      this.setObjectUrl(cropped);
      this.changeDetector.markForCheck();
    });
  }

  /**
   * Turn the cropper's data URL into a real `File`.
   *
   * The upload endpoint takes multipart, so the image has to be a file — and
   * giving it a `.webp` name with a matching type is what keeps the backend's
   * three checks (declared MIME, extension, and actual byte signature) in
   * agreement. Returns `null` for anything that is not a data URL of an
   * accepted type.
   */
  private toPhotoFile(dataUrl: string): File | null {
    const match = /^data:([a-z0-9.+/-]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) return null;

    const mimeType = match[1].toLowerCase();
    if (!PHOTO.mimeTypes.includes(mimeType)) return null;

    let binary: string;
    try {
      binary = atob(match[2]);
    } catch {
      return null;
    }

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const extension = mimeType.split('/')[1] ?? 'webp';
    return new File([bytes], `profile-photo.${extension}`, { type: mimeType });
  }

  /**
   * Remove the photo.
   *
   * A photo that was never uploaded is simply forgotten; a stored one is removed
   * on the server. Both end with no preview, which is what the Student asked
   * for either way.
   */
  protected removePhoto(): void {
    if (this.photoBusy() || this.saving()) return;

    if (this.pendingPhoto()) {
      this.pendingPhoto.set(null);
      this.releaseObjectUrl();
      this.photoPreview.set(null);
      // Fall through to the server only if something is actually stored there.
      if (this.profile()?.hasPhoto !== true) {
        this.changeDetector.markForCheck();
        return;
      }
    }

    if (this.profile()?.hasPhoto !== true) {
      this.releaseObjectUrl();
      this.photoPreview.set(null);
      return;
    }

    this.photoBusy.set(true);
    this.errorKey.set(null);

    this.profileApi
      .removePhoto()
      .pipe(finalize(() => this.photoBusy.set(false)))
      .subscribe({
        next: (profile) => {
          this.profile.set(profile);
          this.releaseObjectUrl();
          this.photoPreview.set(null);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => {
          this.errorKey.set(mapProfileError(error).key);
          this.changeDetector.markForCheck();
        },
      });
  }

  /** Retry just the photo, after a partial success. The form is untouched. */
  protected retryPhoto(): void {
    const pending = this.pendingPhoto();
    if (!pending || this.saving() || this.photoBusy()) return;

    this.errorKey.set(null);
    this.partialSuccess.set(false);
    this.saving.set(true);
    this.uploadPendingPhoto(pending);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /** Available once the profile is complete, so there is somewhere to go back to. */
  protected backToWelcome(): void {
    this.router.navigate([STUDENT_HOME]);
  }
}
