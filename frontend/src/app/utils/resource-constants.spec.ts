import { describe, expect, it } from 'vitest';

import {
  RESOURCE_DEFAULT_ICON,
  RESOURCE_FILE_FIELD,
  RESOURCE_KIND_ICON,
  acceptAttribute,
  fileSizeUnit,
  formatFileSize,
  resourceIcon,
} from './resource-constants';

/**
 * The browser's side of the Resource rules ⟨CP5⟩.
 *
 * What matters most about this file is what is **not** in it: accepted
 * extensions and the size limit are absent, because they arrive from the server
 * with every list and a second copy here would eventually disagree with the
 * first. That absence is asserted against the source in
 * `backend/test/templatePreservation.test.ts` — the only suite in this
 * repository with filesystem access.
 */
describe('resource constants', () => {
  it('exports nothing that looks like a copy of the server rules', () => {
    const exported = Object.keys({
      RESOURCE_FILE_FIELD,
      RESOURCE_KIND_ICON,
      RESOURCE_DEFAULT_ICON,
    });
    for (const name of exported) {
      expect(name).not.toMatch(/EXTENSION|MAX_BYTES|MIME/);
    }
  });

  it('names the multipart field the upload route expects', () => {
    expect(RESOURCE_FILE_FIELD).toBe('file');
  });

  describe('icons', () => {
    it('draws every kind the backend can produce', () => {
      // Keyed by kind, so `.htm` and `.html` share one entry without this file
      // knowing they are the same thing.
      for (const kind of ['pdf', 'html', 'docx', 'pptx', 'xlsx', 'txt', 'md']) {
        expect(RESOURCE_KIND_ICON[kind], `no icon for ${kind}`).toBeTruthy();
        expect(resourceIcon(kind)).not.toBe(RESOURCE_DEFAULT_ICON);
      }
    });

    it('falls back rather than rendering nothing for an unknown kind', () => {
      expect(resourceIcon('rtf')).toBe(RESOURCE_DEFAULT_ICON);
      expect(resourceIcon('')).toBe(RESOURCE_DEFAULT_ICON);
    });
  });

  describe('file sizes', () => {
    it('uses binary units, so the number agrees with the stated limit', () => {
      // Showing "21 MB" beside a limit of "20 MB" for a file the server just
      // refused would be true in decimal and useless to the reader.
      expect(formatFileSize(20 * 1024 * 1024, 'en')).toBe('20');
      expect(fileSizeUnit(20 * 1024 * 1024)).toBe('mb');
    });

    it('picks the unit from the size', () => {
      expect(fileSizeUnit(512)).toBe('bytes');
      expect(fileSizeUnit(2048)).toBe('kb');
      expect(fileSizeUnit(5 * 1024 * 1024)).toBe('mb');
    });

    it('keeps one decimal place while it is useful, and drops it after', () => {
      expect(formatFileSize(1536, 'en')).toBe('1.5');
      expect(formatFileSize(15 * 1024 * 1024, 'en')).toBe('15');
    });

    it('renders Latin digits on an Arabic page', () => {
      // Every other number in the application does, and a file size in
      // Eastern Arabic numerals beside a Latin page count reads as a bug.
      const arabic = formatFileSize(1536, 'ar');
      expect(arabic).toMatch(/^[0-9.,٫]+$/);
      expect(arabic).not.toMatch(/[٠-٩]/);
    });

    it('does not produce a negative or nonsensical size', () => {
      expect(formatFileSize(-5, 'en')).toBe('0');
      expect(formatFileSize(Number.NaN, 'en')).toBe('0');
      expect(fileSizeUnit(-5)).toBe('bytes');
    });
  });

  describe('the picker hint', () => {
    it('is built from whatever the server sent', () => {
      expect(acceptAttribute(['.pdf', '.docx'])).toBe('.pdf,.docx');
    });

    it('is empty when the rules have not arrived yet', () => {
      // An empty `accept` shows every file rather than none, which is the safe
      // direction: the server checks the bytes regardless.
      expect(acceptAttribute([])).toBe('');
    });
  });
});
