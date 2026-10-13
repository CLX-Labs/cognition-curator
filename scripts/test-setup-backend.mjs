import test from 'node:test';
import assert from 'node:assert/strict';
import { setupBackend } from './setup-backend.mjs';

test('setup completes migrations before initializing the durable generation queue', async () => {
  const calls = [], logs = [];
  await setupBackend({ DATABASE_URL: 'postgresql://local/test' }, {
    migration: async url => { calls.push(['migration', url]); },
    queue: async url => { calls.push(['queue', url]); },
    log: entry => logs.push(entry),
  });
  assert.deepEqual(calls.map(c => c[0]), ['migration', 'queue']);
  assert.equal(logs.at(-1).stage, 'ready');
});

test('a migration failure stops queue setup and reports its stage and PostgreSQL code without secrets', async () => {
  const logs = [];
  let queueCalled = false;
  const error = Object.assign(new Error('denied postgresql://alice:password@db/test private-key-123'), { code: '42501' });
  await assert.rejects(setupBackend({ DATABASE_URL: 'postgresql://alice:password@db/test', ANTHROPIC_API_KEY: 'private-key-123' }, {
    migration: async () => { throw error; },
    queue: async () => { queueCalled = true; },
    log: entry => logs.push(entry),
  }), error);
  assert.equal(queueCalled, false);
  assert.equal(logs.at(-1).stage, 'migration');
  assert.equal(logs.at(-1).error.code, '42501');
  assert.doesNotMatch(JSON.stringify(logs), /password|private-key-123/);
});

test('missing database configuration and unsupported Node versions fail before database writes', async () => {
  const work = async () => { throw new Error('must not run'); };
  const options = { migration: work, queue: work, log: () => {} };
  await assert.rejects(setupBackend({}, options), /DATABASE_URL is required/);
  await assert.rejects(setupBackend({ DATABASE_URL: 'test' }, { ...options, nodeVersion: '22.0.0' }), /Node 24/);
});

test('queue setup errors identify the queue stage without masking the underlying code', async () => {
  const logs = [];
  await assert.rejects(setupBackend({ DATABASE_URL: 'test' }, {
    migration: async () => {},
    queue: async () => { throw Object.assign(new Error('permission denied for schema recollect_boss'), { code: '42501' }); },
    log: entry => logs.push(entry),
  }), /permission denied/);
  assert.equal(logs.at(-1).stage, 'queue');
  assert.equal(logs.at(-1).error.code, '42501');
});
