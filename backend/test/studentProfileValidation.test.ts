/**
 * Profile validation — pure behaviour tests.
 *
 * The validation layer has no Parse dependency and no I/O, so these run the
 * real functions directly against real inputs. Nothing is stubbed and nothing is
 * asserted from source text.
 */

import {test, describe, before, after} from 'node:test';
import assert from 'node:assert/strict';

import {clearTrackedIntervals, installParseTestGlobal} from './support/parseTestGlobal';

let validation: typeof import('../src/cloudCode/modules/StudentProfile/validation');
let constants: typeof import('../src/cloudCode/modules/StudentProfile/constants');

/**
 * A payload that passes every rule, so each test can break exactly one thing.
 *
 * The four catalog selections are deliberately absent: they need a database
 * lookup and are resolved by `catalogRefs.ts`, which keeps this module pure.
 * What the scalar validator still owns are the two rules that depend on the
 * *outcome* of that lookup, passed in through the context argument.
 */
function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Lina Haddad',
    phone: '+963 944 123 456',
    educationStatus: 'Current Student',
    expectedGraduationMonth: '2027-06',
    ...overrides,
  };
}

/** The context the cloud function supplies once the catalog has been resolved. */
type Context = {institutionIsOther?: boolean; hasTargetRole?: boolean};

before(async () => {
  installParseTestGlobal();
  validation = await import('../src/cloudCode/modules/StudentProfile/validation');
  constants = await import('../src/cloudCode/modules/StudentProfile/constants');
});

after(() => clearTrackedIntervals());

describe('required fields', () => {
  test('a complete payload passes', () => {
    const {errors} = validation.validateProfileInput(validInput());
    assert.deepEqual(errors, {});
  });

  for (const field of ['fullName', 'phone', 'educationStatus']) {
    test(`${field} is required`, () => {
      const {errors} = validation.validateProfileInput(validInput({[field]: ''}));
      assert.equal(errors[field], 'REQUIRED', `${field} must be required`);
    });

    test(`${field} treats whitespace as empty`, () => {
      const {errors} = validation.validateProfileInput(validInput({[field]: '   '}));
      assert.ok(errors[field], `${field} must reject whitespace only`);
    });
  }

  test('optional fields may all be absent', () => {
    const {errors} = validation.validateProfileInput(
      validInput({educationStatus: 'Graduate', expectedGraduationMonth: ''})
    );
    assert.deepEqual(errors, {});
  });
});

describe('fullName', () => {
  test('is trimmed and internally collapsed', () => {
    const {values} = validation.validateProfileInput(
      validInput({fullName: '  Lina   Haddad  '})
    );
    assert.equal(values.fullName, 'Lina Haddad');
  });

  test('rejects a single character', () => {
    const {errors} = validation.validateProfileInput(validInput({fullName: 'L'}));
    assert.equal(errors['fullName'], 'TOO_SHORT');
  });

  test('rejects an overlong value', () => {
    const {errors} = validation.validateProfileInput(
      validInput({fullName: 'x'.repeat(constants.LIMITS.fullName.max + 1)})
    );
    assert.equal(errors['fullName'], 'TOO_LONG');
  });
});

describe('phone', () => {
  for (const value of ['+963944123456', '+49 151 23456789', '0944 123 456', '(011) 555-1234']) {
    test(`accepts ${value.replace(/\d/g, '#')}`, () => {
      const {errors} = validation.validateProfileInput(validInput({phone: value}));
      assert.equal(errors['phone'], undefined);
    });
  }

  for (const [label, value] of [
    ['letters', '+963 call me'],
    ['too few digits', '+12'],
    ['too many digits', '+1234567890123456789'],
    ['an injection attempt', "+963'; DROP TABLE--"],
  ] as const) {
    test(`rejects ${label}`, () => {
      const {errors} = validation.validateProfileInput(validInput({phone: value}));
      assert.equal(errors['phone'], 'INVALID');
    });
  }

  test('no country is invented for a local number', () => {
    // The value is stored as the person typed it; guessing a country is exactly
    // what gets it wrong for someone who has moved.
    const {values} = validation.validateProfileInput(validInput({phone: '0944 123 456'}));
    assert.equal(values.phone, '0944 123 456');
    assert.ok(!values.phone.startsWith('+'));
  });
});

describe('date of birth', () => {
  test('is optional', () => {
    const {errors, values} = validation.validateProfileInput(validInput({dateOfBirth: ''}));
    assert.equal(errors['dateOfBirth'], undefined);
    assert.equal(values.dateOfBirth, undefined);
  });

  test('accepts a plausible date and stores it in UTC', () => {
    const {values} = validation.validateProfileInput(validInput({dateOfBirth: '2001-03-14'}));
    assert.equal(values.dateOfBirth?.toISOString(), '2001-03-14T00:00:00.000Z');
  });

  test('rejects a malformed value', () => {
    const {errors} = validation.validateProfileInput(validInput({dateOfBirth: '14/03/2001'}));
    assert.equal(errors['dateOfBirth'], 'INVALID');
  });

  test('rejects an impossible calendar date', () => {
    const {errors} = validation.validateProfileInput(validInput({dateOfBirth: '2001-02-30'}));
    assert.equal(errors['dateOfBirth'], 'INVALID');
  });

  test('rejects a date in the future', () => {
    const next = new Date();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const {errors} = validation.validateProfileInput(
      validInput({dateOfBirth: next.toISOString().slice(0, 10)})
    );
    assert.equal(errors['dateOfBirth'], 'OUT_OF_RANGE');
  });
});

describe('institution', () => {
  test('a name sent in place of an id is refused outright', () => {
    // The column holds a pointer the backend resolves. A bare `institution` in
    // the payload is somebody writing a name straight into the record.
    const privileged = validation.findPrivilegedFields({institution: 'Tishreen University'});
    assert.deepEqual(privileged, ['institution']);
  });

  test('every catalog column is refused as a raw name', () => {
    for (const field of ['city', 'institution', 'major', 'targetRole']) {
      assert.deepEqual(validation.findPrivilegedFields({[field]: 'anything'}), [field]);
    }
  });

  test('the Other institution requires a custom name', () => {
    const {errors} = validation.validateProfileInput(
      validInput({customInstitutionName: ''}),
      {institutionIsOther: true} as Context
    );
    assert.equal(errors['customInstitutionName'], 'REQUIRED');
  });

  test('Other with a custom name passes', () => {
    const {errors, values} = validation.validateProfileInput(
      validInput({customInstitutionName: 'Aleppo Technical Institute'}),
      {institutionIsOther: true} as Context
    );
    assert.deepEqual(errors, {});
    assert.equal(values.customInstitutionName, 'Aleppo Technical Institute');
  });

  test('a custom name is dropped when the institution is not the Other item', () => {
    // Otherwise switching away from "Other" would leave a stale name behind.
    const {values} = validation.validateProfileInput(
      validInput({customInstitutionName: 'Left over'}),
      {institutionIsOther: false} as Context
    );
    assert.equal(values.customInstitutionName, undefined);
  });

  test('the institution list is no longer hard-coded in the backend', () => {
    // It moved into ProfileCatalogItem, so an Admin edits it rather than a
    // deployment. A leftover constant here would be a second source of truth.
    assert.equal((constants as Record<string, unknown>)['INSTITUTIONS'], undefined);
    assert.equal((constants as Record<string, unknown>)['INSTITUTION_OTHER'], undefined);
  });

  test('the four catalog selections are named with an Id suffix', () => {
    const params = Object.values(constants.CATALOG_REFERENCE_FIELDS).map(entry => entry.param);
    assert.deepEqual(params, ['cityId', 'institutionId', 'majorId', 'targetRoleId']);
  });
});

describe('education status and graduation', () => {
  test('refuses an unknown status', () => {
    const {errors} = validation.validateProfileInput(
      validInput({educationStatus: 'Alumnus'})
    );
    assert.equal(errors['educationStatus'], 'NOT_ALLOWED');
  });

  test('a Current Student must supply a graduation month', () => {
    const {errors} = validation.validateProfileInput(
      validInput({educationStatus: 'Current Student', expectedGraduationMonth: ''})
    );
    assert.equal(errors['expectedGraduationMonth'], 'REQUIRED');
  });

  test('a Graduate does not need one', () => {
    const {errors} = validation.validateProfileInput(
      validInput({educationStatus: 'Graduate', expectedGraduationMonth: ''})
    );
    assert.deepEqual(errors, {});
  });

  test("a Graduate's graduation date is cleared even if supplied", () => {
    // The product says Graduate clears it; keeping it would contradict the
    // status the Student just chose.
    const {values} = validation.validateProfileInput(
      validInput({educationStatus: 'Graduate', expectedGraduationMonth: '2024-06'})
    );
    assert.equal(values.expectedGraduationDate, undefined);
  });

  test('June 2027 normalises to the first of the month at midnight UTC', () => {
    const {values} = validation.validateProfileInput(
      validInput({expectedGraduationMonth: '2027-06'})
    );
    assert.equal(values.expectedGraduationDate?.toISOString(), '2027-06-01T00:00:00.000Z');
  });

  test('normalisation does not drift with the server timezone', () => {
    // Date.UTC is used rather than a local-time constructor: in a UTC+3
    // deployment the latter would store the previous month.
    const {value} = validation.normaliseGraduationMonth('2027-01');
    assert.equal(value?.getUTCFullYear(), 2027);
    assert.equal(value?.getUTCMonth(), 0);
    assert.equal(value?.getUTCDate(), 1);
    assert.equal(value?.getUTCHours(), 0);
    assert.equal(value?.getUTCMinutes(), 0);
    assert.equal(value?.getUTCSeconds(), 0);
    assert.equal(value?.getUTCMilliseconds(), 0);
  });

  test('a stored date renders back to the same month', () => {
    const {value} = validation.normaliseGraduationMonth('2027-06');
    assert.equal(validation.toGraduationMonth(value), '2027-06');
  });

  test('rejects a malformed month', () => {
    for (const bad of ['2027', '2027-13', 'June 2027', '2027-6']) {
      const {reason} = validation.normaliseGraduationMonth(bad);
      assert.equal(reason, 'INVALID', `${bad} must be refused`);
    }
  });

  test('rejects an implausible year', () => {
    const {reason} = validation.normaliseGraduationMonth('2999-06');
    assert.equal(reason, 'OUT_OF_RANGE');
  });
});

describe('URL validation', () => {
  test('accepts a real GitHub profile', () => {
    const {value} = validation.validateUrl('https://github.com/lina', ['github.com', 'www.github.com']);
    assert.ok(value?.startsWith('https://github.com/'));
  });

  test('accepts a real LinkedIn profile', () => {
    const {value} = validation.validateUrl('https://www.linkedin.com/in/lina', [
      'linkedin.com',
      'www.linkedin.com',
    ]);
    assert.ok(value);
  });

  test('refuses a look-alike domain', () => {
    // Substring matching would accept this; hostname matching does not.
    const {reason} = validation.validateUrl('https://github.com.evil.test/lina', [
      'github.com',
      'www.github.com',
    ]);
    assert.equal(reason, 'WRONG_DOMAIN');
  });

  test('refuses the wrong site entirely', () => {
    const {reason} = validation.validateUrl('https://example.com/lina', ['github.com']);
    assert.equal(reason, 'WRONG_DOMAIN');
  });

  test('refuses a bare domain with no profile path', () => {
    const {reason} = validation.validateUrl('https://github.com', ['github.com']);
    assert.equal(reason, 'INVALID');
  });

  for (const dangerous of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ]) {
    test(`refuses ${dangerous.split(':')[0]}: URLs`, () => {
      const {reason} = validation.validateUrl(dangerous);
      assert.equal(reason, 'INVALID');
    });
  }

  test('a portfolio may be any http(s) site', () => {
    const {value} = validation.validateUrl('https://lina.dev/work');
    assert.ok(value);
  });

  test('plain http is accepted', () => {
    const {value} = validation.validateUrl('http://lina.dev/work');
    assert.ok(value);
  });

  test('refuses an overlong URL', () => {
    const long = `https://lina.dev/${'x'.repeat(constants.LIMITS.url.max)}`;
    const {reason} = validation.validateUrl(long);
    assert.equal(reason, 'TOO_LONG');
  });

  test('all three URL fields are optional', () => {
    const {errors} = validation.validateProfileInput(
      validInput({githubUrl: '', linkedinUrl: '', portfolioUrl: ''})
    );
    assert.deepEqual(errors, {});
  });

  test('an invalid link is reported against its own field', () => {
    const {errors} = validation.validateProfileInput(
      validInput({githubUrl: 'not a url', linkedinUrl: 'https://example.com/x'})
    );
    assert.equal(errors['githubUrl'], 'INVALID');
    assert.equal(errors['linkedinUrl'], 'WRONG_DOMAIN');
  });
});

describe('target role reason', () => {
  test('is optional even when a role is chosen', () => {
    const {errors} = validation.validateProfileInput(
      validInput({targetRoleReason: ''}),
      {hasTargetRole: true} as Context
    );
    assert.equal(errors['targetRoleReason'], undefined);
  });

  test('is kept when a role resolved', () => {
    const {values} = validation.validateProfileInput(
      validInput({targetRoleReason: 'I enjoy building interfaces.'}),
      {hasTargetRole: true} as Context
    );
    assert.equal(values.targetRoleReason, 'I enjoy building interfaces.');
  });

  test('is cleared when no role resolved', () => {
    // The reason belongs to the role. A Student clearing the role is a valid
    // save, so the answer is dropped rather than the request refused.
    const {values, errors} = validation.validateProfileInput(
      validInput({targetRoleReason: 'Left over'}),
      {hasTargetRole: false} as Context
    );
    assert.equal(values.targetRoleReason, undefined);
    assert.deepEqual(errors, {});
  });

  test('rejects more than 500 characters', () => {
    const {errors} = validation.validateProfileInput(
      validInput({targetRoleReason: 'x'.repeat(501)}),
      {hasTargetRole: true} as Context
    );
    assert.equal(errors['targetRoleReason'], 'TOO_LONG');
  });

  test('accepts exactly 500 characters', () => {
    const {errors} = validation.validateProfileInput(
      validInput({targetRoleReason: 'x'.repeat(500)}),
      {hasTargetRole: true} as Context
    );
    assert.equal(errors['targetRoleReason'], undefined);
  });

  test('the bound is 500, matching the career goal', () => {
    assert.equal(constants.LIMITS.targetRoleReason.max, 500);
  });
});

describe('career goal', () => {
  test('is optional', () => {
    const {errors} = validation.validateProfileInput(validInput({careerGoal: ''}));
    assert.equal(errors['careerGoal'], undefined);
  });

  test('is bounded', () => {
    const {errors} = validation.validateProfileInput(
      validInput({careerGoal: 'x'.repeat(constants.LIMITS.careerGoal.max + 1)})
    );
    assert.equal(errors['careerGoal'], 'TOO_LONG');
  });
});

describe('the writable field allow-list', () => {
  test('server-controlled fields are refused, not ignored', () => {
    const found = validation.findPrivilegedFields({
      fullName: 'Lina',
      verifiedEmail: 'attacker@example.com',
      user: 'someone-else',
      isComplete: true,
    });
    assert.deepEqual(found.sort(), ['isComplete', 'user', 'verifiedEmail']);
  });

  test('an ordinary payload trips nothing', () => {
    assert.deepEqual(validation.findPrivilegedFields(validInput()), []);
  });

  test('an unknown key is simply never read', () => {
    const {values} = validation.validateProfileInput(
      validInput({salary: 100000, cvUrl: 'https://x.test/cv.pdf', skills: ['a']})
    );
    assert.equal((values as unknown as Record<string, unknown>)['salary'], undefined);
    assert.equal((values as unknown as Record<string, unknown>)['cvUrl'], undefined);
    assert.equal((values as unknown as Record<string, unknown>)['skills'], undefined);
  });

  test('the writable list is exactly the approved fields', () => {
    assert.deepEqual([...constants.WRITABLE_PROFILE_FIELDS].sort(), [
      'careerGoal',
      'cityId',
      'customInstitutionName',
      'dateOfBirth',
      'educationStatus',
      'expectedGraduationMonth',
      'fullName',
      'githubUrl',
      'institutionId',
      'linkedinUrl',
      'majorId',
      'phone',
      'portfolioUrl',
      'targetRoleId',
      'targetRoleReason',
    ]);
  });

  test('no prohibited product field exists anywhere in the vocabulary', () => {
    const declared = JSON.stringify(constants.WRITABLE_PROFILE_FIELDS).toLowerCase();
    for (const forbidden of [
      'cv',
      'salary',
      'experience',
      'skill',
      'rating',
      'score',
      'evaluation',
      'recommendation',
      'biography',
      'employment',
      'workpreference',
    ]) {
      assert.ok(!declared.includes(forbidden), `${forbidden} must not be a profile field`);
    }
  });
});

describe('completion is calculated, never asserted by a client', () => {
  const complete = {
    fullName: 'Lina Haddad',
    verifiedEmail: 'lina@example.com',
    phone: '+963944123456',
    hasCity: true,
    hasInstitution: true,
    hasMajor: true,
    educationStatus: 'Graduate',
  };

  test('a fully answered Graduate profile is complete', () => {
    assert.equal(validation.calculateIsComplete(complete), true);
  });

  for (const field of ['fullName', 'verifiedEmail', 'phone', 'educationStatus']) {
    test(`missing ${field} makes it incomplete`, () => {
      assert.equal(validation.calculateIsComplete({...complete, [field]: ''}), false);
    });
  }

  for (const field of ['hasCity', 'hasInstitution', 'hasMajor']) {
    test(`an unresolved ${field.slice(3).toLowerCase()} selection makes it incomplete`, () => {
      assert.equal(validation.calculateIsComplete({...complete, [field]: false}), false);
    });
  }

  test('a Current Student needs the graduation date', () => {
    assert.equal(
      validation.calculateIsComplete({...complete, educationStatus: 'Current Student'}),
      false
    );
    assert.equal(
      validation.calculateIsComplete({
        ...complete,
        educationStatus: 'Current Student',
        expectedGraduationDate: new Date('2027-06-01T00:00:00.000Z'),
      }),
      true
    );
  });

  test('the Other institution needs the custom name', () => {
    assert.equal(
      validation.calculateIsComplete({...complete, institutionIsOther: true}),
      false
    );
    assert.equal(
      validation.calculateIsComplete({
        ...complete,
        institutionIsOther: true,
        customInstitutionName: 'Aleppo Technical Institute',
      }),
      true
    );
  });

  test('a target role and its reason never affect completion', () => {
    // Optional by product decision. Neither presence nor absence changes this.
    assert.equal(validation.calculateIsComplete(complete), true);
    assert.ok(!constants.REQUIRED_PROFILE_FIELDS.includes('targetRole'));
    assert.ok(!constants.REQUIRED_PROFILE_FIELDS.includes('targetRoleReason'));
    assert.ok(!(constants.REQUIRED_CATALOG_FIELDS as readonly string[]).includes('targetRole'));
  });

  test('optional fields never block completion', () => {
    // No photo, no date of birth, no links, no career goal.
    assert.equal(validation.calculateIsComplete(complete), true);
  });
});
