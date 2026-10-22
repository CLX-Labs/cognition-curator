import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { createDatabase } from '@recollect/db';
import { migrate } from '../packages/db/src/migrate.ts';
import {
  ALGORITHM_VERSION,
  cardInput,
  deckInput,
  importResponseSchema,
  pullResponseSchema,
  pushResponseSchema,
  sessionSchema,
  snapshotSchema,
  type Session,
} from '@recollect/contracts';
import { initialSchedule } from '@recollect/scheduler';
import { Repository, type SqlDatabase, type SqlExecutor } from '../apps/mobile/src/repository.ts';
import { SyncEngine, type Transport } from '../apps/mobile/src/sync.ts';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('real SQLite → sync engine → authenticated API → PostgreSQL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recollect-flow-'));
  const database = createDatabase(url ?? 'postgresql://unused');
  let app: Awaited<ReturnType<typeof buildApp>>;
  let clock = Date.now() - 60_000;
  const now = () => new Date(clock).toISOString();
  const handles = new Set<DatabaseSync>();

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.RECOLLECT_EMBEDDED_TEST !== 'true' && !parsed.pathname.endsWith('_test')) {
      throw new Error('Integration tests require a disposable database whose name ends in _test.');
    }
    await database.query('DROP SCHEMA IF EXISTS recollect CASCADE');
    await migrate(database);
    app = await buildApp({
      db: database,
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        ACCESS_TOKEN_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
        APPLE_BUNDLE_ID: 'collect.software.cognition-curator',
        ENABLE_DEV_AUTH: 'true',
      }),
    });
  });
  afterAll(async () => {
    for (const handle of handles) handle.close();
    if (app) await app.close();
    await database.end();
    rmSync(directory, { recursive: true, force: true });
  });

  async function login(): Promise<Session> {
    const result = await app.inject({
      method: 'POST',
      url: '/v1/auth/development',
      payload: { email: `${randomUUID()}@example.test`, name: 'Offline learner' },
    });
    expect(result.statusCode).toBe(200);
    return sessionSchema.parse(result.json());
  }
  function transport(session: Session): Transport {
    return {
      request: async (path, options = {}) => {
        const response = await app.inject({
          method: options.method === 'POST' ? 'POST' : 'GET',
          url: path,
          headers: {
            authorization: `Bearer ${session.accessToken}`,
            'content-type': 'application/json',
            'x-recollect-scheduler': ALGORITHM_VERSION,
          },
          payload: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        if (response.statusCode >= 400) throw new Error(JSON.stringify(response.json()));
        return response.json();
      },
    };
  }
  async function device(session: Session, file = randomUUID() + '.sqlite', id = randomUUID()) {
    const handle = new DatabaseSync(join(directory, file));
    handles.add(handle);
    handle.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const executor: SqlExecutor = {
      exec: async (sql) => {
        handle.exec(sql);
      },
      run: async (sql, params = []) => {
        handle.prepare(sql).run(...(params as SQLInputValue[]));
      },
      all: async <T>(sql: string, params: unknown[] = []) =>
        handle.prepare(sql).all(...(params as SQLInputValue[])) as T[],
    };
    const adapter: SqlDatabase = {
      ...executor,
      transaction: async (work) => {
        handle.exec('BEGIN IMMEDIATE');
        try {
          const value = await work(executor);
          handle.exec('COMMIT');
          return value;
        } catch (error) {
          handle.exec('ROLLBACK');
          throw error;
        }
      },
    };
    const repo = new Repository(adapter, session.user.id, id, randomUUID, now);
    await repo.initialize();
    return {
      repo,
      file,
      id,
      adapter,
      sync: new SyncEngine(repo, transport(session), () => {}),
      close() {
        handle.close();
        handles.delete(handle);
      },
    };
  }
  async function seed(repo: Repository) {
    const deckId = randomUUID(),
      cardId = randomUUID();
    await repo.saveDeck({
      id: deckId,
      name: 'A durable deck',
      description: '',
      color: '#315D5B',
      icon: 'book',
      isSilenced: false,
      silencedUntil: null,
    });
    await repo.saveCard({
      id: cardId,
      deckId,
      front: 'What survives a restart?',
      back: 'The review and its outbox command.',
      hint: '',
      explanation: '',
      tags: [],
      aiGenerated: false,
    });
    return { deckId, cardId };
  }

  it('recovers an offline review after two restarts and a lost acknowledgement, with one server event', async () => {
    const session = await login();
    let phone = await device(session);
    const { cardId } = await seed(phone.repo);
    await phone.sync.run();
    clock += 1_000;
    const event = await phone.repo.rateCard(cardId, 'good', 3_200);
    expect((await phone.repo.snapshot()).cards[0]!.schedule.intervalSeconds).toBe(7 * 86_400);
    const { file, id } = phone;
    phone.close();
    phone = await device(session, file, id);
    expect((await phone.repo.snapshot()).pending).toBe(1);
    let dropped = false;
    const online = transport(session);
    const interrupted = new SyncEngine(
      phone.repo,
      {
        request: async (path, options) => {
          const result = await online.request(path, options);
          if (path === '/v1/sync/push' && !dropped) {
            dropped = true;
            throw new Error('Connection dropped after server commit');
          }
          return result;
        },
      },
      () => {},
    );
    await expect(interrupted.run()).rejects.toThrow('after server commit');
    phone.close();
    clock += 10_000;
    phone = await device(session, file, id);
    await phone.sync.run();
    const local = await phone.repo.snapshot();
    const server = snapshotSchema.parse(await online.request('/v1/snapshot'));
    expect(local.pending).toBe(0);
    expect(local.reviews).toHaveLength(1);
    expect(local.cards[0]!.schedule.totalReviews).toBe(1);
    expect(local.cards[0]!.schedule.dueAt).toBe(
      new Date(Date.parse(event.reviewedAt) + 7 * 86_400_000).toISOString(),
    );
    expect(server.reviews).toHaveLength(1);
    expect(server.cards[0]!.schedule).toEqual(local.cards[0]!.schedule);
    const replay = pushResponseSchema.parse(
      await online.request('/v1/sync/push', {
        method: 'POST',
        body: {
          operations: [
            {
              operationId: randomUUID(),
              deviceId: id,
              createdAt: now(),
              type: 'review.append',
              payload: event,
            },
          ],
        },
      }),
    );
    expect(replay.receipts[0]!.status).toBe('duplicate');
    expect(
      snapshotSchema.parse(await online.request('/v1/snapshot')).cards[0]!.schedule.totalReviews,
    ).toBe(1);
  });

  it('preserves both offline edits when another device changed the same card before the first upload', async () => {
    const session = await login(),
      a = await device(session),
      b = await device(session);
    const { cardId } = await seed(a.repo);
    await a.sync.run();
    await b.sync.run();
    const original = (await a.repo.snapshot()).cards.find((c) => c.id === cardId)!;
    await a.repo.saveCard({ ...cardInput(original), front: 'Unsent local variant' });
    await b.repo.saveCard({ ...cardInput(original), front: 'Other device variant' });
    await b.sync.run();
    const page = pullResponseSchema.parse(
      await transport(session).request('/v1/sync/pull?cursor=' + (await a.repo.cursor())),
    );
    await a.repo.applyChanges(page.changes, page.cursor);
    await a.sync.run();
    const local = await a.repo.snapshot();
    expect(local.issues).toHaveLength(1);
    expect(local.cards[0]!.front).toBe('Unsent local variant');
    expect(local.issues[0]!.canonical).toMatchObject({ front: 'Other device variant' });
    await a.repo.resolveIssue(local.issues[0]!.id, 'server');
    expect((await a.repo.snapshot()).cards[0]!.front).toBe('Other device variant');
    expect((await a.repo.exportData()).recoveryCopies.length).toBeGreaterThan(0);
  });

  it('keeps two accounts apart in one SQLite database and rejects cross-owner server commands', async () => {
    const first = await login(),
      second = await login(),
      phone = await device(first);
    const { cardId, deckId } = await seed(phone.repo);
    await phone.sync.run();
    const other = new Repository(phone.adapter, second.user.id, phone.id, randomUUID, now);
    await other.initialize();
    expect((await other.snapshot()).cards).toHaveLength(0);
    expect((await other.snapshot()).pending).toBe(0);
    const rejected = pushResponseSchema.parse(
      await transport(second).request('/v1/sync/push', {
        method: 'POST',
        body: {
          operations: [
            {
              operationId: randomUUID(),
              deviceId: phone.id,
              createdAt: now(),
              type: 'card.upsert',
              baseVersion: 0,
              payload: {
                id: cardId,
                deckId,
                front: 'Foreign',
                back: 'Must not replace',
                hint: '',
                explanation: '',
                tags: [],
                aiGenerated: false,
              },
            },
          ],
        },
      }),
    );
    expect(rejected.receipts[0]!.status).toBe('rejected');
    expect((await phone.repo.snapshot()).cards[0]!.front).toBe('What survives a restart?');
    expect(
      snapshotSchema.parse(await transport(second).request('/v1/snapshot')).cards,
    ).toHaveLength(0);
  });

  it('does not let an accepted offline review conceal a concurrent content edit before its dependent edit', async () => {
    const session = await login(),
      a = await device(session),
      b = await device(session);
    const { cardId } = await seed(a.repo);
    await a.sync.run();
    await b.sync.run();
    const original = (await a.repo.snapshot()).cards[0]!;
    clock += 1_000;
    await a.repo.rateCard(cardId, 'good', 2_000);
    await a.repo.saveCard({ ...cardInput(original), front: 'Local edit after an offline review' });
    await b.repo.saveCard({ ...cardInput(original), front: 'Concurrent edit from device B' });
    await b.sync.run();
    await a.sync.run();
    const server = snapshotSchema.parse(await transport(session).request('/v1/snapshot'));
    expect(server.reviews).toHaveLength(1);
    expect(server.cards[0]!.front).toBe('Concurrent edit from device B');
    const local = await a.repo.snapshot();
    expect(local.issues).toHaveLength(1);
    expect(local.cards[0]!.front).toBe('Local edit after an offline review');
  });

  it('imports schedule checkpoints idempotently without replaying archived reviews as new activity', async () => {
    const session = await login(),
      online = transport(session);
    const deckId = randomUUID(),
      cardId = randomUUID(),
      deviceId = randomUUID();
    const previousReview = new Date(clock - 2 * 86_400_000).toISOString();
    const schedule = {
      ...initialSchedule(now()),
      phase: 'review' as const,
      intervalSeconds: 86_400,
      dueAt: new Date(clock + 86_400_000).toISOString(),
      lastReviewedAt: previousReview,
      repetitions: 4,
      totalReviews: 17,
    };
    const request = {
      batchId: randomUUID(),
      source: 'swiftdata-v1',
      exportedAt: now(),
      sourceAccountId: session.user.id,
      ownershipConfirmed: true,
      decks: [
        {
          id: deckId,
          name: 'Recovered',
          description: '',
          color: '#315D5B',
          icon: 'book',
          isSilenced: false,
          silencedUntil: null,
        },
      ],
      cards: [
        {
          id: cardId,
          deckId,
          front: 'Retained',
          back: 'History',
          hint: '',
          explanation: '',
          tags: [],
          aiGenerated: false,
          schedule,
          checkpointAt: now(),
        },
      ],
      archivedReviews: [{ id: randomUUID(), intervalMinutes: 1440, reviewedAt: previousReview }],
    };
    const imported = importResponseSchema.parse(
      await online.request('/v1/imports', { method: 'POST', body: request }),
    );
    expect(imported.importedCardIds).toEqual([cardId]);
    expect(await online.request('/v1/imports', { method: 'POST', body: request })).toEqual(
      imported,
    );
    const before = snapshotSchema.parse(await online.request('/v1/snapshot'));
    expect(before.reviews).toHaveLength(0);
    expect(before.cards[0]!.schedule.totalReviews).toBe(17);
    clock += 1_000;
    const reviewed = pushResponseSchema.parse(
      await online.request('/v1/sync/push', {
        method: 'POST',
        body: {
          operations: [
            {
              operationId: randomUUID(),
              deviceId,
              createdAt: now(),
              type: 'review.append',
              payload: {
                id: randomUUID(),
                cardId,
                deckId,
                deviceId,
                deviceSequence: 1,
                rating: 'good',
                reviewedAt: now(),
                elapsedMs: 1000,
                algorithmVersion: 'sm2-v1',
              },
            },
          ],
        },
      }),
    );
    expect(reviewed.receipts[0]!.status).toBe('accepted');
    expect(
      snapshotSchema.parse(await online.request('/v1/snapshot')).cards[0]!.schedule.totalReviews,
    ).toBe(18);
  });
});
