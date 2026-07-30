/**
 * Project-generator credential-safety tests.
 *
 * `create-project.js` used to prompt for the Admin password with a hardcoded
 * publicly-known default, echo the password to stdout on success, and overwrite
 * any existing `.env`. These tests lock the fixed behaviour in.
 *
 * The generator is **never executed** here — it is only required (which is inert
 * by design) and read as text. Nothing is cloned and no file is written.
 */

import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createRequire} from 'node:module';

/**
 * Walk up from this file until the repository root is found. Tests run from
 * `backend/build/test/` after compilation but may also be resolved from
 * `backend/test/`, so the depth is not fixed.
 */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'create-project.js'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repository root (containing create-project.js) not found');
}

const REPO_ROOT = findRepoRoot();
const GENERATOR_PATH = join(REPO_ROOT, 'create-project.js');
const BACKEND_SETUP_PATH = join(REPO_ROOT, 'backend', 'setup.js');

const generatorSource = readFileSync(GENERATOR_PATH, 'utf8');
const backendSetupSource = readFileSync(BACKEND_SETUP_PATH, 'utf8');

// Requiring is safe: the generator only runs under `require.main === module`.
const generator = createRequire(__filename)(GENERATOR_PATH) as {
  validateAdminPassword: (candidate: unknown) => string | null;
  MIN_ADMIN_PASSWORD_LENGTH: number;
  FORBIDDEN_ADMIN_PASSWORDS: string[];
};

describe('no hardcoded Admin-password fallback in tracked source', () => {
  test('the Admin password prompt has no default argument', () => {
    // Must be resolved through the dedicated helper, not `ask('...', 'default')`.
    assert.ok(
      /const adminPass = await resolveAdminPassword\(\);/.test(generatorSource),
      'the Admin password must come from resolveAdminPassword()'
    );
    assert.ok(
      !/ask\(\s*['"][^'"]*[Pp]assword[^'"]*['"]\s*,\s*['"][^'"]+['"]\s*\)/.test(generatorSource),
      'no password prompt may carry a default value'
    );
  });

  test('no well-known placeholder is used as a value anywhere in the generator', () => {
    // The deny-list itself contains these words; strip that array before scanning
    // so the guard does not match its own definition.
    const withoutDenyList = generatorSource.replace(
      /const FORBIDDEN_ADMIN_PASSWORDS[\s\S]*?\];/,
      ''
    );
    for (const placeholder of ['admin123', 'changeme', 'change-me', 'letmein', 'qwerty']) {
      assert.ok(
        !withoutDenyList.toLowerCase().includes(placeholder),
        `'${placeholder}' must not appear as a credential value`
      );
    }
  });

  test('the backend setup script defines no Admin credential at all', () => {
    assert.ok(
      !/ADMIN_PASSWORD/.test(backendSetupSource),
      'backend/setup.js must not write an Admin password'
    );
  });

  test('server keys use a cryptographically secure RNG', () => {
    for (const [name, source] of [
      ['create-project.js', generatorSource],
      ['backend/setup.js', backendSetupSource],
    ] as const) {
      const generateKeyBody = source.match(/function generateKey[\s\S]*?\n}/);
      assert.ok(generateKeyBody, `${name} must define generateKey`);
      assert.ok(
        generateKeyBody![0].includes('crypto.randomBytes'),
        `${name} generateKey must use crypto.randomBytes`
      );
      assert.ok(
        !generateKeyBody![0].includes('Math.random'),
        `${name} generateKey must not use Math.random`
      );
    }
  });
});

describe('missing or weak Admin password fails safely', () => {
  const {validateAdminPassword, MIN_ADMIN_PASSWORD_LENGTH} = generator;

  test('undefined is rejected', () => {
    assert.ok(validateAdminPassword(undefined));
  });

  test('empty string is rejected', () => {
    assert.ok(validateAdminPassword(''));
  });

  test('whitespace-only is rejected', () => {
    assert.ok(validateAdminPassword('     '));
  });

  test('a non-string is rejected', () => {
    assert.ok(validateAdminPassword(12345678901234 as unknown as string));
  });

  test('a value shorter than the minimum is rejected', () => {
    assert.ok(validateAdminPassword('a'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1)));
  });

  test('surrounding whitespace is rejected', () => {
    assert.ok(validateAdminPassword(` ${'a'.repeat(MIN_ADMIN_PASSWORD_LENGTH)} `));
  });

  test('every deny-listed placeholder is rejected', () => {
    for (const forbidden of generator.FORBIDDEN_ADMIN_PASSWORDS) {
      assert.ok(
        validateAdminPassword(forbidden),
        `'${forbidden}' must be rejected`
      );
      // …and case-insensitively.
      assert.ok(validateAdminPassword(forbidden.toUpperCase()));
    }
  });

  test('a sufficiently long unique value is accepted', () => {
    assert.equal(validateAdminPassword('Cyf-Unique-Passphrase-2026'), null);
  });

  test('a rejection message never contains the candidate value', () => {
    const candidate = 'SuperSecretCanaryValue';
    const message = validateAdminPassword(candidate.slice(0, 4)); // too short
    assert.ok(message, 'must be rejected');
    assert.ok(!message!.includes(candidate.slice(0, 4)), 'message must not echo the value');
  });

  test('the minimum length is at least 12', () => {
    assert.ok(MIN_ADMIN_PASSWORD_LENGTH >= 12);
  });
});

describe('the password is never printed', () => {
  test('the success summary does not interpolate the password', () => {
    const summary = generatorSource.slice(generatorSource.indexOf('Setup complete!'));
    assert.ok(
      !summary.includes('${adminPass}'),
      'the completion summary must not print the Admin password'
    );
    assert.ok(
      summary.includes('${adminUser}'),
      'the username may still be shown'
    );
  });

  test('no console call interpolates the password', () => {
    const consoleCalls = generatorSource.match(/console\.(log|error|warn)\([\s\S]*?\);/g) ?? [];
    for (const call of consoleCalls) {
      assert.ok(
        !call.includes('adminPass'),
        `a console call must not include the password: ${call.slice(0, 60)}…`
      );
    }
  });

  test('the failure handler prints only the message, not the error object', () => {
    assert.ok(
      /Setup failed: \$\{err && err\.message/.test(generatorSource),
      'the catch handler must print err.message only'
    );
  });

  test('interactive entry suppresses terminal echo', () => {
    assert.ok(
      /function askSecret/.test(generatorSource),
      'a masked prompt helper must exist'
    );
    assert.ok(
      /muted = true;/.test(generatorSource),
      'the prompt must mute echoed output'
    );
  });

  test('an environment variable path exists so the value need not be typed', () => {
    assert.ok(generatorSource.includes('CYF_ADMIN_PASSWORD'));
  });
});

describe('the password is written only to the ignored env destination', () => {
  test('adminPass reaches exactly one destination: the .env content', () => {
    const uses = generatorSource.match(/adminPass/g) ?? [];
    // Declaration + the ADMIN_PASSWORD line in envContent. Nothing else.
    assert.equal(uses.length, 2, `adminPass should be used twice, found ${uses.length}`);
    assert.ok(/ADMIN_PASSWORD=\$\{adminPass\}/.test(generatorSource));
  });

  test('the env file is written under backend/.env', () => {
    assert.ok(/join\(projectDir, 'backend', '\.env'\)/.test(generatorSource));
  });

  test('.env is git-ignored in the template', () => {
    const backendGitignore = readFileSync(
      join(REPO_ROOT, 'backend', '.gitignore'),
      'utf8'
    );
    assert.ok(
      backendGitignore.split(/\r?\n/).includes('.env'),
      'backend/.gitignore must ignore .env'
    );
  });

  test('the password is not passed to any shell command', () => {
    const execCalls = generatorSource.match(/execSync\([\s\S]*?\)/g) ?? [];
    for (const call of execCalls) {
      assert.ok(!call.includes('adminPass'), 'no shell command may receive the password');
    }
  });
});

describe('an existing env file is never overwritten', () => {
  test('the generator checks existsSync before writing .env', () => {
    const envSection = generatorSource.slice(
      generatorSource.indexOf('const envPath'),
      generatorSource.indexOf('Created backend/.env')
    );
    assert.ok(
      envSection.includes('fs.existsSync(envPath)'),
      'the generator must check for an existing .env'
    );
    assert.ok(
      /Refusing to overwrite/.test(envSection),
      'the generator must refuse rather than clobber'
    );
    // The guard must precede the write.
    assert.ok(
      envSection.indexOf('fs.existsSync(envPath)') <
        envSection.indexOf('fs.writeFileSync(envPath'),
      'the existence check must come before the write'
    );
  });

  test('backend/setup.js also refuses to overwrite an existing .env', () => {
    assert.ok(backendSetupSource.includes('fs.existsSync(envPath)'));
    assert.ok(/already exists — not overwritten/.test(backendSetupSource));
  });
});
