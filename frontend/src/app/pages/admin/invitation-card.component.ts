import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { finalize } from 'rxjs';

import { AlertComponent } from '../../components/shared/alert.component';
import { InvitationStatus } from '../../models/Batch';
import { ChangeLangService } from '../../services/change-lang.service';
import { BatchApiService } from '../../services/dataService/batch-service';
import { QrCodeService } from '../../services/qr-code.service';
import { BatchErrorKey, mapBatchError } from '../../utils/batch-error';
import { formatInstant } from '../../utils/calendar-date';

/** What the QR dialog is currently showing. */
type CopyState = 'idle' | 'copied' | 'failed';

/**
 * The invitation panel — generate, rotate, revoke, expire, and share a join link.
 *
 * ── The token exists here and nowhere else ──────────────────────────────────
 * Issuing returns the one and only copy of the raw token. It is held in a signal
 * for as long as this panel is open and is **never** written to `localStorage`,
 * `sessionStorage`, a service field, a route, a query parameter, or a log. Leave
 * the page and it is gone — which is the truth the backend tells, and this panel
 * must not quietly make it false by caching it somewhere convenient.
 *
 * What survives is the *status*: a fingerprint derived from the hash, a version
 * number, a state, and an expiry. None of those can reconstruct a token.
 *
 * ── Rotating invalidates before it creates ─────────────────────────────────
 * "Generate a new link" retires the current one first. There is never a window
 * in which two links both work — that is enforced by a unique database index,
 * not by the order of calls here.
 *
 * ── The QR code is black on white ───────────────────────────────────────────
 * Deliberately not in the design system's palette: a scanner needs high contrast
 * and a light quiet zone, and a themed QR — especially in dark mode — is one
 * nobody can scan. The dialog around it carries the design system.
 */
@Component({
  selector: 'cyf-invitation-card',
  imports: [
    TranslateModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DatePickerModule,
    AlertComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invitation-card.component.html',
  styleUrl: './invitation-card.component.scss',
})
export class InvitationCardComponent {
  private batchApi = inject(BatchApiService);
  private qrCodes = inject(QrCodeService);
  private changeDetector = inject(ChangeDetectorRef);
  protected langService = inject(ChangeLangService);

  /** Which Batch this panel manages. */
  batchId = input.required<string>();

  /** Used only to name a downloaded QR file. Never the token. */
  batchName = input('');

  /** The status the detail page already loaded, so the panel does not re-fetch. */
  initialStatus = input<InvitationStatus | null>(null);

  protected status = signal<InvitationStatus | null>(null);
  protected busy = signal(false);
  protected errorKey = signal<BatchErrorKey | null>(null);
  protected noticeKey = signal<string | null>(null);

  /**
   * The raw link, for as long as this panel is open.
   *
   * Present only immediately after issuing. Reloading the page, navigating away,
   * or coming back later leaves this null — there is no second copy to read.
   */
  protected issuedUrl = signal<string | null>(null);

  protected qrOpen = signal(false);
  protected copyState = signal<CopyState>('idle');

  /** The expiry picker's working value. Null means "no expiry". */
  protected expiryDraft = signal<Date | null>(null);
  protected expiryOpen = signal(false);

  /** The earliest expiry the picker will offer. An expiry in the past is not one. */
  protected readonly now = new Date();

  private qrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');

  protected exists = computed(() => this.status()?.exists === true);
  protected usable = computed(() => this.status()?.usable === true);
  protected canManage = computed(() => this.status()?.canManage === true);

  protected state = computed(() => this.status()?.state ?? null);

  /** Tone for the state chip. A usable link is the only good state. */
  protected tone = computed(() => {
    const status = this.status();
    if (!status?.exists) return 'neutral';
    if (status.usable) return 'success';
    return status.state === 'revoked' ? 'error' : 'warning';
  });

  protected expiresAt = computed(() =>
    formatInstant(this.status()?.expiresAt, this.langService.currentLang()),
  );

  constructor() {
    // Adopt whatever the detail page already fetched, and follow it if the page
    // reloads the Batch. `untracked` keeps the write out of the dependency set.
    effect(() => {
      const incoming = this.initialStatus();
      untracked(() => {
        if (incoming) this.status.set(incoming);
      });
    });

    // Draw the code when the dialog opens, and redraw if a rotation replaces the
    // link while it is open. The canvas only exists while the dialog is open,
    // so both conditions have to be read here.
    effect(() => {
      const open = this.qrOpen();
      const url = this.issuedUrl();
      const canvas = this.qrCanvas();
      if (!open || !url || !canvas) return;
      untracked(() => this.qrCodes.draw(canvas.nativeElement, url));
    });
  }

  // ── Operations ────────────────────────────────────────────────────────────

  /** Generate the first link, or rotate to a new one. */
  protected issue(): void {
    if (this.busy()) return;
    this.begin();

    const expiresAt = this.expiryDraft()?.toISOString();

    this.batchApi
      .adminIssueInvitation(this.batchId(), expiresAt)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (issued) => {
          this.status.set(issued.invitation);
          // Absolute when the backend knows its frontend origin; otherwise
          // resolved against wherever this page is actually being served from,
          // which is the same host by definition.
          this.issuedUrl.set(
            issued.invitationUrl ?? new URL(issued.invitationPath, location.origin).toString(),
          );
          this.noticeKey.set('admin.batches.invitation.notices.issued');
          this.expiryOpen.set(false);
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected revoke(): void {
    if (this.busy()) return;
    this.begin();

    this.batchApi
      .adminRevokeInvitation(this.batchId())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          // The link this panel was holding no longer works. Keeping it on
          // screen would invite somebody to send a dead link.
          this.forgetToken();
          this.noticeKey.set('admin.batches.invitation.notices.revoked');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected expireNow(): void {
    if (this.busy()) return;
    this.begin();

    this.batchApi
      .adminExpireInvitation(this.batchId())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.forgetToken();
          this.noticeKey.set('admin.batches.invitation.notices.expired');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  /** Set or clear the expiry of the link that already exists. */
  protected applyExpiry(): void {
    if (this.busy()) return;
    this.begin();

    this.batchApi
      .adminSetInvitationExpiry(this.batchId(), this.expiryDraft()?.toISOString())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.expiryOpen.set(false);
          this.noticeKey.set('admin.batches.invitation.notices.expirySet');
          this.changeDetector.markForCheck();
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  // ── Sharing ───────────────────────────────────────────────────────────────

  protected openQr(): void {
    if (!this.issuedUrl()) return;
    this.copyState.set('idle');
    this.qrOpen.set(true);
  }

  protected closeQr(): void {
    this.qrOpen.set(false);
  }

  /**
   * Copy the link.
   *
   * The clipboard write can be refused — an insecure origin, a denied
   * permission — and a silent failure would have somebody paste nothing into a
   * message and wonder why nobody joined. Both outcomes are reported.
   */
  protected copyLink(): void {
    const url = this.issuedUrl();
    if (!url) return;

    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        this.copyState.set('copied');
        this.changeDetector.markForCheck();
      })
      .catch(() => {
        this.copyState.set('failed');
        this.changeDetector.markForCheck();
      });
  }

  /** Save the QR as a PNG, named after the Batch — never after the token. */
  protected downloadQr(): void {
    const url = this.issuedUrl();
    if (!url) return;
    this.qrCodes.download(url, this.fileName());
  }

  private fileName(): string {
    const name = (this.batchName() || 'batch')
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    return `${name || 'batch'}-invitation`;
  }

  // ── Plumbing ──────────────────────────────────────────────────────────────

  protected openExpiry(): void {
    this.expiryOpen.set(true);
  }

  protected closeExpiry(): void {
    this.expiryOpen.set(false);
  }

  protected clearExpiryDraft(): void {
    this.expiryDraft.set(null);
  }

  protected updateExpiryDraft(value: Date | null): void {
    this.expiryDraft.set(value);
  }

  private begin(): void {
    this.busy.set(true);
    this.errorKey.set(null);
    this.noticeKey.set(null);
  }

  private fail(error: unknown): void {
    this.errorKey.set(mapBatchError(error).key);
    this.changeDetector.markForCheck();
  }

  /** Drop the raw link and close anything showing it. */
  private forgetToken(): void {
    this.issuedUrl.set(null);
    this.qrOpen.set(false);
    this.copyState.set('idle');
  }
}
