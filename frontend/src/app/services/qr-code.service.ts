import { Injectable } from '@angular/core';
import qrcode from 'qrcode-generator';

/**
 * Rendering a join link as a QR code.
 *
 * ── Why a dependency, and why this one ──────────────────────────────────────
 * QR encoding is Reed–Solomon error correction, bit-stream construction, and
 * mask evaluation. Hand-rolling it risks producing something that *looks* like
 * a QR code and does not scan — a failure nobody notices until somebody is
 * standing in a room with a phone. `qrcode-generator` is the canonical
 * implementation, has **zero runtime dependencies**, ships types, and is one
 * file. That is the smallest honest way to get this right.
 *
 * ── Always black on white ───────────────────────────────────────────────────
 * The palette is deliberately *not* the design system's. A scanner needs a
 * light background and dark modules with high contrast; rendering a QR in theme
 * colours — especially in dark mode — produces codes that read poorly or not at
 * all. A QR code is a machine-readable artefact, and it is styled for the
 * machine that has to read it. The dialog around it carries the design system.
 *
 * ── Nothing is retained ─────────────────────────────────────────────────────
 * The link is passed in, drawn, and forgotten. This service holds no state, so
 * a token cannot outlive the component that had it.
 */

/** Error-correction level. `M` recovers ~15%, which survives a phone camera. */
const ERROR_CORRECTION = 'M';

/** Auto-select the smallest symbol version that fits the data. */
const AUTO_TYPE_NUMBER = 0;

/** Quiet-zone width, in modules. Four is the spec's minimum; less breaks scans. */
const QUIET_ZONE_MODULES = 4;

@Injectable({
  providedIn: 'root',
})
export class QrCodeService {
  /**
   * Draw a QR code for `text` onto a canvas.
   *
   * `size` is the target edge in CSS pixels; the module size is rounded down to
   * a whole number so every module lands on an exact pixel boundary. A
   * fractional module size produces anti-aliased edges, which is the usual
   * reason a rendered QR fails to scan.
   */
  draw(canvas: HTMLCanvasElement, text: string, size = 320): void {
    const context = canvas.getContext('2d');
    if (!context) return;

    const qr = qrcode(AUTO_TYPE_NUMBER, ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    const modules = qr.getModuleCount();
    const total = modules + QUIET_ZONE_MODULES * 2;
    const moduleSize = Math.max(1, Math.floor(size / total));
    const edge = moduleSize * total;

    // Render at the device's pixel density so the code stays crisp on a
    // high-DPI screen, which is where most people will scan it from.
    const ratio = typeof devicePixelRatio === 'number' ? Math.min(devicePixelRatio, 3) : 1;
    canvas.width = edge * ratio;
    canvas.height = edge * ratio;
    canvas.style.width = `${edge}px`;
    canvas.style.height = `${edge}px`;
    context.scale(ratio, ratio);

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, edge, edge);

    context.fillStyle = '#000000';
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (!qr.isDark(row, column)) continue;
        context.fillRect(
          (column + QUIET_ZONE_MODULES) * moduleSize,
          (row + QUIET_ZONE_MODULES) * moduleSize,
          moduleSize,
          moduleSize,
        );
      }
    }
  }

  /**
   * A PNG data URL for `text`, for downloading.
   *
   * Drawn on a detached canvas at a larger module size than the on-screen
   * preview: a downloaded QR is likely to be printed or projected, and a
   * 12-pixel module survives both.
   */
  toPngDataUrl(text: string, moduleSize = 12): string {
    const qr = qrcode(AUTO_TYPE_NUMBER, ERROR_CORRECTION);
    qr.addData(text);
    qr.make();

    const modules = qr.getModuleCount();
    const total = modules + QUIET_ZONE_MODULES * 2;
    const edge = total * moduleSize;

    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;

    const context = canvas.getContext('2d');
    if (!context) return '';

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, edge, edge);

    context.fillStyle = '#000000';
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (!qr.isDark(row, column)) continue;
        context.fillRect(
          (column + QUIET_ZONE_MODULES) * moduleSize,
          (row + QUIET_ZONE_MODULES) * moduleSize,
          moduleSize,
          moduleSize,
        );
      }
    }

    return canvas.toDataURL('image/png');
  }

  /**
   * Save a QR code as a PNG.
   *
   * The file is named after the Batch, never after the token — a downloaded
   * file sits in a folder with a visible name, and that name must not be a
   * credential.
   */
  download(text: string, fileName: string): void {
    const dataUrl = this.toPngDataUrl(text);
    if (!dataUrl) return;

    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}
