import { describe, expect, it } from 'vitest';

import { normaliseSyrianPhone, SYRIAN_MOBILE_PATTERN } from './syrian-phone';

describe('normaliseSyrianPhone', () => {
  for (const [input, expected] of [
    ['0911111111', '+963911111111'],
    ['911111111', '+963911111111'],
    ['+963911111111', '+963911111111'],
    ['963 911 111 111', '+963911111111'],
    ['00963 (911) 111-111', '+963911111111'],
    ['\u0660\u0669\u0661\u0661\u0661\u0661\u0661\u0661\u0661\u0661', '+963911111111'],
    ['\u06f0\u06f9\u06f1\u06f1\u06f1\u06f1\u06f1\u06f1\u06f1\u06f1', '+963911111111'],
  ] as const) {
    it(`normalises ${input}`, () => {
      const result = normaliseSyrianPhone(input);

      expect(result).toBe(expected);
      expect(SYRIAN_MOBILE_PATTERN.test(result ?? '')).toBe(true);
    });
  }

  for (const input of [
    '',
    '+49 151 23456789',
    '(011) 555-1234',
    '091111111',
    '09111111111',
    'call me',
    "+963'; DROP TABLE--",
    null,
    undefined,
  ]) {
    it(`rejects ${String(input)}`, () => {
      expect(normaliseSyrianPhone(input)).toBeNull();
    });
  }
});
