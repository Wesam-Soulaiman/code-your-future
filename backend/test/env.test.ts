/**
 * Environment-validation tests.
 *
 * Every test restores the original environment, so no other suite is affected
 * and no temporary state survives the run.
 */

import {test, describe, afterEach} from 'node:test';
import assert from 'node:assert/strict';

import {assertEnv, inspectEnv, REQUIRED_KEYS} from '../src/cloudCode/utils/config/env';

const SECRET_VALUE = 'mongodb://user:sup3rsecret@localhost:27017/cyf';
const snapshot: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in snapshot)) snapshot[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(snapshot)) delete snapshot[key];
});

function setAllRequired(): void {
  setEnv('databaseURI', SECRET_VALUE);
  setEnv('appId', 'cyf-app');
  setEnv('masterKey', 'master-key-canary');
  setEnv('serverURL', 'http://localhost:1337/api');
  setEnv('mountPath', '/api');
}

describe('inspectEnv', () => {
  test('reports every missing required key by name', () => {
    for (const key of REQUIRED_KEYS) setEnv(key, undefined);
    const result = inspectEnv();
    assert.deepEqual(result.missing.sort(), [...REQUIRED_KEYS].sort());
  });

  test('reports nothing missing when all keys are present', () => {
    setAllRequired();
    assert.deepEqual(inspectEnv().missing, []);
  });

  test('treats a whitespace-only value as absent', () => {
    setAllRequired();
    setEnv('masterKey', '   ');
    assert.deepEqual(inspectEnv().missing, ['masterKey']);
  });

  test('returns key names only — never values', () => {
    for (const key of REQUIRED_KEYS) setEnv(key, undefined);
    const serialised = JSON.stringify(inspectEnv());
    assert.ok(!serialised.includes(SECRET_VALUE));
    assert.ok(!serialised.includes('sup3rsecret'));
  });
});

describe('assertEnv', () => {
  test('throws listing missing key names', () => {
    setAllRequired();
    setEnv('databaseURI', undefined);
    setEnv('masterKey', undefined);

    assert.throws(assertEnv, (error: Error) => {
      assert.ok(error.message.includes('databaseURI'));
      assert.ok(error.message.includes('masterKey'));
      return true;
    });
  });

  test('the failure message never contains a value', () => {
    setAllRequired();
    // databaseURI is present but another key is missing: the error must still
    // not echo any configured value.
    setEnv('appId', undefined);

    assert.throws(assertEnv, (error: Error) => {
      assert.ok(!error.message.includes(SECRET_VALUE));
      assert.ok(!error.message.includes('sup3rsecret'));
      assert.ok(!error.message.includes('master-key-canary'));
      return true;
    });
  });

  test('passes when the environment is complete', () => {
    setAllRequired();
    assert.doesNotThrow(assertEnv);
  });
});
