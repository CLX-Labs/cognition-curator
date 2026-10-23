import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALGORITHM_VERSION,
  accountDeletionReceiptSchema,
  sessionSchema,
  type AccountDeletionRequest,
  type Session,
  type SyncOperation,
} from '@recollect/contracts';
import { createDatabase, secretHash, type Database } from '@recollect/db';
import { migrate } from '@recollect/db/migrate';
import { importLegacy } from '../../../packages/db/src/import-legacy.js';
import { buildApp } from '../src/app.js';
import {
  AppleDeletionError,
  processAccountDeletions,
  type AppleDeletionClient,
} from '../src/account-deletion.js';
import type { ApiConfig } from '../src/config.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('verified whole-account deletion', () => {
  let db: Database, app: FastifyInstance;
  const config: ApiConfig = {
    databaseUrl: process.env.TEST_DATABASE_URL ?? '',
    accessSecret: 'account-deletion-test-signing-key-32-characters',
    appleAudience: 'test.recollect',
    production: false,
    enableDevAuth: false,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 86_400,
    dailyGenerationCards: 100,
    appleSignInTeamId: 'TESTTEAM',
    appleSignInKeyId: 'TESTKEY',
    appleSignInPrivateKey: 'injected-apple-client-only-no-network',
    accountDeletionMaxDays: 7,
  };
  const ownerTables = [
    'sessions',
    'session_families',
    'sync_heads',
    'decks',
    'cards',
    'review_events',
    'operation_receipts',
    'changes',
    'generation_jobs',
    'quota_buckets',
    'acceptance_receipts',
    'import_batches',
    'legacy_archives',
  ] as const;
  const publicTables = [
    'review_sessions',
    'study_sessions',
    'retention_data',
    'performance_metrics',
    'learning_insights',
    'flashcards',
    'decks',
    'users',
  ] as const;
  const subjects = new Map<string, string>();
  const headers = (session: Session) => ({
    authorization: 'Bearer ' + session.accessToken,
    'x-recollect-scheduler': ALGORITHM_VERSION,
  });
  async function clearLegacy() {
    await db.query('DROP TABLE IF EXISTS public.deletion_unknown_notes CASCADE');
    for (const table of publicTables)
      await db.query(`DROP TABLE IF EXISTS public.${table} CASCADE`);
  }
  beforeAll(async () => {
    db = createDatabase(config.databaseUrl);
    await db.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(db);
    app = await buildApp({ db, config, appleVerifier: async (token) => JSON.parse(token) });
  });
  beforeEach(async () => {
    await clearLegacy();
    await db.query(
      'TRUNCATE recollect.users,recollect.auth_challenges,recollect.rate_buckets,recollect.account_deletion_requests CASCADE',
    );
    subjects.clear();
  });
  afterAll(async () => {
    if (db) await clearLegacy();
    await app?.close();
    await db?.end();
  });
  async function challenge(target = app) {
    const response = await target.inject({ method: 'POST', url: '/v1/auth/apple/challenge' });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ challengeId: string; nonce: string }>();
  }
  async function login(subject: string = randomUUID(), target = app): Promise<Session> {
    const proof = await challenge(target);
    const response = await target.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: proof.challengeId,
        identityToken: JSON.stringify({
          sub: subject,
          nonce: secretHash(proof.nonce),
          email: subject + '@example.test',
        }),
        displayName: 'Learner',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const session = sessionSchema.parse(response.json());
    subjects.set(session.user.id, subject);
    return session;
  }
  async function deletionBody(
    session: Session,
    authorizationCode: string | undefined = 'one-use-apple-code',
    target = app,
  ): Promise<AccountDeletionRequest> {
    const proof = await challenge(target);
    return {
      operationId: randomUUID(),
      ownerId: session.user.id,
      challengeId: proof.challengeId,
      identityToken: JSON.stringify({
        sub: subjects.get(session.user.id),
        nonce: secretHash(proof.nonce),
      }),
      ...(authorizationCode ? { authorizationCode } : {}),
    };
  }
  const request = (payload: AccountDeletionRequest, target = app) =>
    target.inject({
      method: 'POST',
      url: '/v1/account/deletion',
      payload,
    });
  async function confirm(session: Session, code = 'one-use-apple-code') {
    const body = await deletionBody(session, code);
    const response = await request(body);
    expect(response.statusCode, response.body).toBe(200);
    return { body, receipt: accountDeletionReceiptSchema.parse(response.json()) };
  }
  const apple = (): AppleDeletionClient => ({
    exchange: vi.fn(async () => 'reusable-apple-refresh-token'),
    revoke: vi.fn(async () => {}),
  });
  async function stored(owner: string) {
    return (
      await db.query('SELECT * FROM recollect.account_deletion_requests WHERE owner_id=$1', [owner])
    ).rows[0];
  }
  async function push(session: Session, operations: SyncOperation[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: headers(session),
      payload: { operations },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json().receipts.every((item: { status: string }) => item.status === 'accepted'),
    ).toBe(true);
  }
  async function library(session: Session, name = 'Private source') {
    const deckId = randomUUID(),
      cardId = randomUUID(),
      deviceId = randomUUID(),
      createdAt = new Date().toISOString();
    await push(session, [
      {
        type: 'deck.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt,
        baseVersion: 0,
        payload: {
          id: deckId,
          name,
          description: '',
          color: '#2441EA',
          icon: '📚',
          isSilenced: false,
          silencedUntil: null,
        },
      },
      {
        type: 'card.upsert',
        operationId: randomUUID(),
        deviceId,
        createdAt,
        baseVersion: 0,
        payload: {
          id: cardId,
          deckId,
          front: 'Alternator',
          back: 'Charges the battery',
          hint: '',
          explanation: '',
          tags: [],
          aiGenerated: false,
        },
      },
      {
        type: 'review.append',
        operationId: randomUUID(),
        deviceId,
        createdAt,
        payload: {
          id: randomUUID(),
          cardId,
          deckId,
          deviceId,
          deviceSequence: 1,
          rating: 'good',
          reviewedAt: createdAt,
          elapsedMs: 2000,
          algorithmVersion: ALGORITHM_VERSION,
        },
      },
    ]);
    return { deckId, cardId };
  }
  async function generation(
    owner: string,
    deck: string,
    status: 'queued' | 'running' | 'succeeded',
  ) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO recollect.generation_jobs(id,owner_id,deck_id,operation_id,payload_hash,prompt,card_count,status,fence,lease_until)
       VALUES($1,$2,$3,$4,'test-hash','Private generation prompt',1,$5,$6,now()+interval '1 minute')`,
      [id, owner, deck, randomUUID(), status, status === 'running' ? randomUUID() : null],
    );
    return id;
  }
  async function createLegacySchema() {
    await db.query(`
      CREATE TABLE public.users(id uuid PRIMARY KEY,apple_id text UNIQUE,email text,name text NOT NULL DEFAULT 'Legacy learner',is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.decks(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),name text NOT NULL DEFAULT 'Legacy deck');
      CREATE TABLE public.flashcards(id uuid PRIMARY KEY,deck_id uuid NOT NULL REFERENCES public.decks(id),front text NOT NULL DEFAULT 'Legacy question',back text NOT NULL DEFAULT 'Legacy answer');
      CREATE TABLE public.review_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),deck_id uuid NOT NULL REFERENCES public.decks(id),flashcard_id uuid NOT NULL REFERENCES public.flashcards(id));
      CREATE TABLE public.study_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),deck_id uuid REFERENCES public.decks(id));
      CREATE TABLE public.retention_data(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id),flashcard_id uuid NOT NULL REFERENCES public.flashcards(id));
      CREATE TABLE public.performance_metrics(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id));
      CREATE TABLE public.learning_insights(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id));
    `);
  }
  async function seedLegacy(owner: string, subject: string) {
    const deck = randomUUID(),
      card = randomUUID();
    await db.query('INSERT INTO public.users(id,apple_id,email) VALUES($1,$2,$3)', [
      owner,
      subject,
      subject + '@example.test',
    ]);
    await db.query('INSERT INTO public.decks(id,user_id) VALUES($1,$2)', [deck, owner]);
    await db.query('INSERT INTO public.flashcards(id,deck_id) VALUES($1,$2)', [card, deck]);
    await db.query(
      'INSERT INTO public.review_sessions(id,user_id,deck_id,flashcard_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), owner, deck, card],
    );
    await db.query('INSERT INTO public.study_sessions(id,user_id,deck_id) VALUES($1,$2,$3)', [
      randomUUID(),
      owner,
      deck,
    ]);
    await db.query('INSERT INTO public.retention_data(id,user_id,flashcard_id) VALUES($1,$2,$3)', [
      randomUUID(),
      owner,
      card,
    ]);
    for (const table of ['performance_metrics', 'learning_insights'])
      await db.query(`INSERT INTO public.${table}(id,user_id) VALUES($1,$2)`, [
        randomUUID(),
        owner,
      ]);
    return { deck, card };
  }

  it('rejects a verified different Apple account without disabling either account', async () => {
    const owner = await login(),
      other = await login();
    const body = await deletionBody(owner);
    body.identityToken = JSON.stringify({
      ...JSON.parse(body.identityToken),
      sub: subjects.get(other.user.id),
    });
    const response = await request(body);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('account_mismatch');
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.users WHERE is_active=true'))
        .rows[0].n,
    ).toBe(2);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.account_deletion_requests')).rows[0]
        .n,
    ).toBe(0);
    expect((await app.inject({ url: '/v1/me', headers: headers(owner) })).statusCode).toBe(200);
  });

  it('requires an unexpired, correctly bound, unused Apple challenge for the initial confirmation', async () => {
    const owner = await login();
    const wrongNonce = await deletionBody(owner);
    wrongNonce.identityToken = JSON.stringify({
      sub: subjects.get(owner.user.id),
      nonce: secretHash('other-challenge'),
    });
    expect((await request(wrongNonce)).statusCode).toBe(401);
    const expired = await deletionBody(owner);
    await db.query(
      "UPDATE recollect.auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.challengeId],
    );
    expect((await request(expired)).statusCode).toBe(401);
    const used = await deletionBody(owner);
    await db.query('UPDATE recollect.auth_challenges SET consumed_at=now() WHERE id=$1', [
      used.challengeId,
    ]);
    expect((await request(used)).statusCode).toBe(401);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM recollect.account_deletion_requests')).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await db.query('SELECT is_active FROM recollect.users WHERE id=$1', [owner.user.id])).rows[0]
        .is_active,
    ).toBe(true);
  });

  it('immediately disables all sessions, blocks authentication, and fences active generation work', async () => {
    const owner = await login(),
      secondSession = await login(subjects.get(owner.user.id)!);
    const { deckId } = await library(owner);
    const queued = await generation(owner.user.id, deckId, 'queued');
    const running = await generation(owner.user.id, deckId, 'running');
    const succeeded = await generation(owner.user.id, deckId, 'succeeded');
    const { body, receipt } = await confirm(owner, 'private-authorization-code');
    expect(receipt).toMatchObject({
      requestId: body.operationId,
      ownerId: owner.user.id,
      status: 'pending',
      completedAt: null,
      estimatedCompletionDays: 7,
      actionRequired: 'none',
    });
    for (const session of [owner, secondSession]) {
      expect((await app.inject({ url: '/v1/me', headers: headers(session) })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/auth/refresh',
            payload: { refreshToken: session.refreshToken },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM recollect.sessions WHERE owner_id=$1 AND revoked_at IS NULL',
          [owner.user.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM recollect.session_families WHERE owner_id=$1 AND revoked_at IS NULL',
          [owner.user.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const jobs = (
      await db.query(
        'SELECT id,status,fence,lease_until FROM recollect.generation_jobs ORDER BY id',
      )
    ).rows;
    for (const id of [queued, running])
      expect(jobs.find((job) => job.id === id)).toMatchObject({
        status: 'canceled',
        fence: null,
        lease_until: null,
      });
    expect(jobs.find((job) => job.id === succeeded)?.status).toBe('succeeded');
    const proof = await challenge();
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        challengeId: proof.challengeId,
        identityToken: JSON.stringify({
          sub: subjects.get(owner.user.id),
          nonce: secretHash(proof.nonce),
        }),
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('account_deletion_pending');
    expect(JSON.stringify(await stored(owner.user.id))).not.toContain('private-authorization-code');
    expect(JSON.stringify(receipt)).not.toContain(subjects.get(owner.user.id));
  });

  it('returns the same public receipt after lost responses, Apple revocation, and final purge', async () => {
    const owner = await login();
    await createLegacySchema();
    await seedLegacy(owner.user.id, subjects.get(owner.user.id)!);
    await db.query(
      'CREATE TABLE public.deletion_unknown_notes(id uuid PRIMARY KEY,user_id uuid REFERENCES public.users(id))',
    );
    const { body, receipt } = await confirm(owner);
    expect(accountDeletionReceiptSchema.parse((await request(body)).json())).toEqual(receipt);
    const client = apple();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    const afterRevocation = await stored(owner.user.id);
    expect(afterRevocation.apple_revoked_at).not.toBeNull();
    expect(afterRevocation.apple_token_ciphertext).toBeNull();
    expect(accountDeletionReceiptSchema.parse((await request(body)).json())).toMatchObject({
      requestId: receipt.requestId,
      status: 'pending',
      actionRequired: 'contact_support',
    });
    const fresh = await deletionBody(owner, 'must-not-replace-revoked-token');
    expect((await request(fresh)).json().requestId).toBe(receipt.requestId);
    expect((await stored(owner.user.id)).apple_token_ciphertext).toBeNull();
    await db.query('DROP TABLE public.deletion_unknown_notes');
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    expect(client.exchange).toHaveBeenCalledTimes(1);
    expect(client.revoke).toHaveBeenCalledTimes(1);
    const replay = await request(body);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(accountDeletionReceiptSchema.parse(replay.json())).toMatchObject({
      requestId: receipt.requestId,
      ownerId: owner.user.id,
      status: 'completed',
      actionRequired: 'none',
    });
    expect((await stored(owner.user.id)).completed_at).not.toBeNull();
    expect(
      (await db.query('SELECT 1 FROM recollect.users WHERE id=$1', [owner.user.id])).rowCount,
    ).toBe(0);
  });

  it('keeps deletion honestly pending when Apple revocation credentials are not configured', async () => {
    const missing = {
      ...config,
      appleSignInTeamId: undefined,
      appleSignInKeyId: undefined,
      appleSignInPrivateKey: undefined,
      accountDeletionMaxDays: undefined,
    };
    const missingApp = await buildApp({
      db,
      config: missing,
      appleVerifier: async (token) => JSON.parse(token),
    });
    try {
      const owner = await login(randomUUID(), missingApp);
      const body = await deletionBody(owner, 'private-code', missingApp);
      const response = await request(body, missingApp);
      expect(response.statusCode, response.body).toBe(200);
      expect(accountDeletionReceiptSchema.parse(response.json())).toMatchObject({
        status: 'pending',
        estimatedCompletionDays: null,
        completedAt: null,
        actionRequired: 'contact_support',
      });
      expect(await processAccountDeletions(db, missing)).toEqual({ completed: 0, pending: 1 });
      const row = await stored(owner.user.id);
      expect(row).toMatchObject({
        status: 'pending',
        error_code: 'apple_revocation_not_configured',
        completed_at: null,
      });
      expect(
        (await db.query('SELECT is_active FROM recollect.users WHERE id=$1', [owner.user.id]))
          .rows[0].is_active,
      ).toBe(false);
    } finally {
      await missingApp.close();
    }
  });

  it('asks for fresh Apple authorization when no authorization code was provided', async () => {
    const owner = await login(),
      body = await deletionBody(owner, undefined);
    // Explicitly omit the optional code; the helper's normal default supplies one.
    delete body.authorizationCode;
    const response = await request(body);
    expect(accountDeletionReceiptSchema.parse(response.json())).toMatchObject({
      status: 'pending',
      actionRequired: 'reauthenticate',
    });
    const client = apple();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
    expect((await stored(owner.user.id)).error_code).toBe('apple_authorization_required');
  });

  it('replaces an expired one-use code only after a fresh matching Apple proof and completes once', async () => {
    const owner = await login();
    const first = await confirm(owner, 'expired-code');
    await db.query(
      "UPDATE recollect.account_deletion_requests SET apple_code_created_at=now()-interval '5 minutes' WHERE owner_id=$1",
      [owner.user.id],
    );
    const client = apple();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect(client.exchange).not.toHaveBeenCalled();
    expect((await request(first.body)).json().actionRequired).toBe('reauthenticate');
    const fresh = await deletionBody(owner, 'fresh-one-use-code');
    expect((await request(fresh)).json()).toMatchObject({
      requestId: first.receipt.requestId,
      actionRequired: 'none',
    });
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    expect(client.exchange).toHaveBeenCalledExactlyOnceWith(
      'fresh-one-use-code',
      secretHash(subjects.get(owner.user.id)!),
    );
    expect(client.revoke).toHaveBeenCalledExactlyOnceWith('reusable-apple-refresh-token');
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 0,
    });
  });

  it('persists encrypted refresh tokens across revoke failures and never replaces them with another code', async () => {
    const owner = await login();
    await confirm(owner, 'first-code');
    let attempts = 0;
    const client: AppleDeletionClient = {
      exchange: vi.fn(async () => 'secret-refresh-token'),
      revoke: vi.fn(async () => {
        if (++attempts === 1) throw new Error('temporary Apple failure');
      }),
    };
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    const before = await stored(owner.user.id);
    expect(before).toMatchObject({
      apple_token_kind: 'refresh_token',
      apple_revoked_at: null,
      completed_at: null,
    });
    expect(JSON.stringify(before)).not.toContain('secret-refresh-token');
    expect(JSON.stringify(before)).not.toContain('first-code');
    expect(
      (await request(await deletionBody(owner, 'replacement-must-be-ignored'))).statusCode,
    ).toBe(200);
    expect((await stored(owner.user.id)).apple_token_ciphertext).toBe(
      before.apple_token_ciphertext,
    );
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    expect(client.exchange).toHaveBeenCalledExactlyOnceWith(
      'first-code',
      secretHash(subjects.get(owner.user.id)!),
    );
    expect(client.revoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.revoke).mock.calls).toEqual([
      ['secret-refresh-token'],
      ['secret-refresh-token'],
    ]);
    expect(await stored(owner.user.id)).toMatchObject({
      status: 'completed',
      apple_token_ciphertext: null,
      apple_token_kind: null,
    });
  });

  it('recovers from a definitively rejected refresh token using a fresh Apple authorization', async () => {
    const owner = await login();
    const { body, receipt } = await confirm(owner, 'original-code');
    let revocations = 0;
    const client: AppleDeletionClient = {
      exchange: vi.fn(async (code) =>
        code === 'fresh-code' ? 'fresh-refresh-token' : 'rejected-refresh-token',
      ),
      revoke: vi.fn(async () => {
        if (++revocations === 1) throw new AppleDeletionError('apple_refresh_token_rejected');
      }),
    };
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect(await stored(owner.user.id)).toMatchObject({
      status: 'pending',
      apple_token_ciphertext: null,
      apple_token_kind: null,
      apple_revoked_at: null,
      completed_at: null,
      error_code: 'apple_refresh_token_rejected',
    });
    const pending = await request(body);
    expect(accountDeletionReceiptSchema.parse(pending.json())).toMatchObject({
      requestId: receipt.requestId,
      status: 'pending',
      actionRequired: 'reauthenticate',
    });
    expect(
      (await db.query('SELECT is_active FROM recollect.users WHERE id=$1', [owner.user.id])).rows[0]
        .is_active,
    ).toBe(false);
    const replacement = await request(await deletionBody(owner, 'fresh-code'));
    expect(accountDeletionReceiptSchema.parse(replacement.json())).toMatchObject({
      requestId: receipt.requestId,
      status: 'pending',
      actionRequired: 'none',
    });
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    const subjectHash = secretHash(subjects.get(owner.user.id)!);
    expect(vi.mocked(client.exchange).mock.calls).toEqual([
      ['original-code', subjectHash],
      ['fresh-code', subjectHash],
    ]);
    expect(vi.mocked(client.revoke).mock.calls).toEqual([
      ['rejected-refresh-token'],
      ['fresh-refresh-token'],
    ]);
    expect(await stored(owner.user.id)).toMatchObject({
      status: 'completed',
      apple_token_ciphertext: null,
      apple_token_kind: null,
      error_code: null,
    });
    expect(
      (await db.query('SELECT 1 FROM recollect.users WHERE id=$1', [owner.user.id])).rowCount,
    ).toBe(0);
  });

  it('does not clear a fresh authorization when a worker still holds an expired code snapshot', async () => {
    const owner = await login();
    await confirm(owner, 'expired-snapshot-code');
    await db.query(
      "UPDATE recollect.account_deletion_requests SET apple_code_created_at=now()-interval '5 minutes' WHERE owner_id=$1",
      [owner.user.id],
    );
    let entered!: () => void, release!: () => void;
    const loaded = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalQuery = db.query.bind(db);
    const pausedDatabase = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'query')
          return async (...arguments_: unknown[]) => {
            if (
              typeof arguments_[0] === 'string' &&
              arguments_[0].includes('SET attempts=attempts+1')
            ) {
              entered();
              await paused;
            }
            return Reflect.apply(originalQuery, target, arguments_);
          };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const client = apple();
    const processing = processAccountDeletions(pausedDatabase, config, { apple: client });
    let fresh: Awaited<ReturnType<typeof stored>>;
    try {
      await loaded;
      const replacement = await request(await deletionBody(owner, 'newer-valid-code'));
      expect(replacement.statusCode, replacement.body).toBe(200);
      fresh = await stored(owner.user.id);
      expect(fresh).toMatchObject({
        apple_token_kind: 'authorization_code',
        apple_revoked_at: null,
        error_code: null,
      });
      expect(fresh.apple_token_ciphertext).not.toBeNull();
    } finally {
      release();
    }
    expect((await processing).completed).toBe(0);
    expect(await stored(owner.user.id)).toMatchObject({
      apple_token_ciphertext: fresh.apple_token_ciphertext,
      apple_token_kind: fresh.apple_token_kind,
      apple_code_created_at: fresh.apple_code_created_at,
      apple_revoked_at: null,
      error_code: null,
    });
    expect(client.exchange).not.toHaveBeenCalled();
    expect(client.revoke).not.toHaveBeenCalled();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    expect(client.exchange).toHaveBeenCalledExactlyOnceWith(
      'newer-valid-code',
      secretHash(subjects.get(owner.user.id)!),
    );
    expect(client.revoke).toHaveBeenCalledExactlyOnceWith('reusable-apple-refresh-token');
  });

  it('replaces unreadable encrypted credentials after a signing-secret rotation using fresh Apple proof', async () => {
    const owner = await login();
    const { body, receipt } = await confirm(owner, 'code-before-key-rotation');
    const temporaryFailure: AppleDeletionClient = {
      exchange: vi.fn(async () => 'refresh-encrypted-under-old-key'),
      revoke: vi.fn(async () => {
        throw new Error('temporary Apple outage');
      }),
    };
    expect(await processAccountDeletions(db, config, { apple: temporaryFailure })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect(await stored(owner.user.id)).toMatchObject({
      apple_token_kind: 'refresh_token',
      apple_revoked_at: null,
    });
    const rotatedConfig = {
      ...config,
      accessSecret: 'rotated-account-deletion-signing-secret-over-32-characters',
    };
    const rotatedApp = await buildApp({
      db,
      config: rotatedConfig,
      appleVerifier: async (token) => JSON.parse(token),
    });
    try {
      const client = apple();
      expect(await processAccountDeletions(db, rotatedConfig, { apple: client })).toEqual({
        completed: 0,
        pending: 1,
      });
      expect(await stored(owner.user.id)).toMatchObject({
        status: 'pending',
        apple_token_ciphertext: null,
        apple_token_kind: null,
        apple_code_created_at: null,
        apple_revoked_at: null,
        completed_at: null,
        error_code: 'apple_credential_unreadable',
      });
      expect(client.exchange).not.toHaveBeenCalled();
      expect(client.revoke).not.toHaveBeenCalled();
      const pending = await request(body, rotatedApp);
      expect(accountDeletionReceiptSchema.parse(pending.json())).toMatchObject({
        requestId: receipt.requestId,
        status: 'pending',
        actionRequired: 'reauthenticate',
      });
      const replacement = await request(
        await deletionBody(owner, 'code-after-key-rotation', rotatedApp),
        rotatedApp,
      );
      expect(replacement.statusCode, replacement.body).toBe(200);
      expect(accountDeletionReceiptSchema.parse(replacement.json())).toMatchObject({
        requestId: receipt.requestId,
        actionRequired: 'none',
      });
      expect(await processAccountDeletions(db, rotatedConfig, { apple: client })).toEqual({
        completed: 1,
        pending: 0,
      });
      expect(client.exchange).toHaveBeenCalledExactlyOnceWith(
        'code-after-key-rotation',
        secretHash(subjects.get(owner.user.id)!),
      );
      expect(client.revoke).toHaveBeenCalledExactlyOnceWith('reusable-apple-refresh-token');
      expect(await stored(owner.user.id)).toMatchObject({
        status: 'completed',
        apple_token_ciphertext: null,
        apple_token_kind: null,
        error_code: null,
      });
    } finally {
      await rotatedApp.close();
    }
  });

  it('erases current, social, archives, and supported legacy data while preserving independent copies and unrelated people', async () => {
    const owner = await login(),
      recipient = await login(),
      unrelated = await login();
    const source = await library(owner),
      independent = await library(recipient, 'Recipient private deck');
    await library(unrelated, 'Unrelated private deck');
    const invite = (
      await app.inject({ method: 'POST', url: '/v1/community/invites', headers: headers(owner) })
    ).json();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/invites/accept',
          headers: headers(recipient),
          payload: { code: invite.code },
        })
      ).statusCode,
    ).toBe(200);
    const offered = await app.inject({
      method: 'POST',
      url: '/v1/community/shares',
      headers: headers(owner),
      payload: {
        operationId: randomUUID(),
        friendId: recipient.user.id,
        deckId: source.deckId,
        shareProgress: true,
      },
    });
    expect(offered.statusCode, offered.body).toBe(200);
    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/community/shares/${offered.json().id}/accept`,
      headers: headers(recipient),
      payload: { shareProgress: true },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const copiedDeckId = accepted.json().recipientDeckId;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/community/shares',
          headers: headers(recipient),
          payload: {
            operationId: randomUUID(),
            friendId: owner.user.id,
            deckId: independent.deckId,
            shareProgress: true,
          },
        })
      ).statusCode,
    ).toBe(200);
    await db.query(
      "INSERT INTO recollect.friend_invites(id,owner_id,code_hash,expires_at,consumed_by) VALUES($1,$2,$3,now()+interval '1 day',$4)",
      [randomUUID(), recipient.user.id, secretHash(randomUUID()), owner.user.id],
    );
    await generation(owner.user.id, source.deckId, 'running');
    await db.query(
      'INSERT INTO recollect.quota_buckets(owner_id,quota_date,reserved) VALUES($1,current_date,3)',
      [owner.user.id],
    );
    await db.query(
      "INSERT INTO recollect.acceptance_receipts(owner_id,operation_id,payload_hash,result) VALUES($1,$2,'hash',$3)",
      [owner.user.id, randomUUID(), { cards: ['private receipt content'] }],
    );
    await db.query(
      "INSERT INTO recollect.import_batches(owner_id,batch_id,payload_hash,source,manifest,result) VALUES($1,$2,'hash','legacy',$3,$4)",
      [owner.user.id, randomUUID(), { name: 'private archived name' }, {}],
    );
    await db.query(
      "INSERT INTO recollect.legacy_archives(owner_id,source_type,source_id,data) VALUES($1,'review_sessions','old-review',$2)",
      [owner.user.id, { personal: 'private old history' }],
    );
    await db.query(
      'INSERT INTO recollect.user_blocks(blocker_id,blocked_id) VALUES($1,$2),($3,$1)',
      [owner.user.id, recipient.user.id, unrelated.user.id],
    );
    await db.query(
      "INSERT INTO recollect.content_reports(id,reporter_id,target_user_id,reason,evidence) VALUES($1,$2,$3,'other',$4),($5,$3,$2,'other',$4)",
      [
        randomUUID(),
        owner.user.id,
        recipient.user.id,
        { private: 'report evidence' },
        randomUUID(),
      ],
    );
    await db.query('INSERT INTO recollect.rate_buckets(scope,bucket,count) VALUES($1,1,1)', [
      'community:report:' + owner.user.id,
    ]);
    await createLegacySchema();
    await seedLegacy(owner.user.id, subjects.get(owner.user.id)!);
    await seedLegacy(unrelated.user.id, subjects.get(unrelated.user.id)!);
    await confirm(owner);
    const client = apple();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 1,
      pending: 0,
    });
    for (const table of ownerTables)
      expect(
        (
          await db.query(`SELECT count(*)::int AS n FROM recollect.${table} WHERE owner_id=$1`, [
            owner.user.id,
          ])
        ).rows[0].n,
        table,
      ).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM recollect.users')).rows[0].n).toBe(2);
    for (const table of [
      'deck_shares',
      'shared_card_mappings',
      'friendships',
      'friend_invites',
      'user_blocks',
      'content_reports',
    ])
      expect(
        (await db.query(`SELECT count(*)::int AS n FROM recollect.${table}`)).rows[0].n,
        table,
      ).toBe(0);
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM recollect.rate_buckets WHERE scope=$1', [
          'community:report:' + owner.user.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    for (const table of publicTables)
      expect(
        (await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n,
        table,
      ).toBe(1);
    expect(
      (
        await db.query('SELECT 1 FROM recollect.decks WHERE owner_id=$1 AND id=$2', [
          recipient.user.id,
          copiedDeckId,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM recollect.cards WHERE owner_id=$1', [
          recipient.user.id,
        ])
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM recollect.review_events WHERE owner_id=$1', [
          recipient.user.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await app.inject({ url: '/v1/snapshot', headers: headers(recipient) })).statusCode,
    ).toBe(200);
    const tombstone = await stored(owner.user.id);
    expect(tombstone).toMatchObject({
      status: 'completed',
      apple_subject_hash: secretHash(subjects.get(owner.user.id)!),
      apple_token_ciphertext: null,
      error_code: null,
    });
    expect(JSON.stringify(tombstone)).not.toContain(subjects.get(owner.user.id));
  });

  it('fails closed on legacy identity mismatch and cross-owner history instead of erasing another person', async () => {
    const owner = await login(),
      unrelated = await login();
    const source = await library(owner);
    await createLegacySchema();
    const legacy = await seedLegacy(owner.user.id, 'different-apple-subject');
    await db.query('INSERT INTO public.users(id,apple_id) VALUES($1,$2)', [
      unrelated.user.id,
      subjects.get(unrelated.user.id),
    ]);
    await confirm(owner);
    const client = apple();
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect((await stored(owner.user.id)).error_code).toBe('legacy_identity_review_required');
    await db.query('UPDATE public.users SET apple_id=$2 WHERE id=$1', [
      owner.user.id,
      subjects.get(owner.user.id),
    ]);
    await db.query(
      'INSERT INTO public.review_sessions(id,user_id,deck_id,flashcard_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), unrelated.user.id, legacy.deck, legacy.card],
    );
    expect(await processAccountDeletions(db, config, { apple: client })).toEqual({
      completed: 0,
      pending: 1,
    });
    expect((await stored(owner.user.id)).error_code).toBe('legacy_schema_review_required');
    expect(
      (await db.query('SELECT 1 FROM recollect.cards WHERE id=$1', [source.cardId])).rowCount,
    ).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM public.users')).rows[0].n).toBe(2);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM public.review_sessions')).rows[0].n,
    ).toBe(2);
    expect(client.revoke).toHaveBeenCalledTimes(1);
  });

  it('prevents operator import from resurrecting a deleted legacy UUID and signs in to a fresh empty account', async () => {
    const owner = await login(),
      subject = subjects.get(owner.user.id)!;
    await createLegacySchema();
    await seedLegacy(owner.user.id, subject);
    await confirm(owner);
    expect(await processAccountDeletions(db, config, { apple: apple() })).toEqual({
      completed: 1,
      pending: 0,
    });
    // A restored legacy backup still cannot override the retained deletion receipt.
    await seedLegacy(owner.user.id, subject);
    await expect(importLegacy(db)).rejects.toThrow('deletion receipt');
    expect(
      (await db.query('SELECT 1 FROM recollect.users WHERE id=$1', [owner.user.id])).rowCount,
    ).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM recollect.cards')).rows[0].n).toBe(0);
    const fresh = await login(subject);
    expect(fresh.user.id).not.toBe(owner.user.id);
    const snapshot = await app.inject({ url: '/v1/snapshot', headers: headers(fresh) });
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json().decks).toEqual([]);
    expect(snapshot.json().cards).toEqual([]);
  });
});
