import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  ALGORITHM_VERSION,
  generationAcceptSchema,
  generationRequestSchema,
  importRequestSchema,
  pushRequestSchema,
  revisionSchema,
  syncOperationSchema,
  type GenerationJob,
} from '@recollect/contracts';
import { DomainError, type Database } from '@recollect/db';
import { AuthService, type AppleVerifier } from './auth.js';
import type { ApiConfig } from './config.js';
import { SyncService } from './sync.js';
import { GenerationService } from './generations.js';
import { importDevice } from './imports.js';
import { ProfileService } from './profile.js';
import { CommunityService } from './community.js';

function generationLog(job: GenerationJob) {
  return {
    component: 'generation',
    jobId: job.id,
    status: job.status,
    candidateCount: job.candidates.length,
    errorCode: job.error?.code ?? null,
  };
}

export async function buildApp(options: {
  db: Database;
  config: ApiConfig;
  appleVerifier?: AppleVerifier;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.authorization', 'req.body', 'res.headers.set-cookie'] }
      : false,
    bodyLimit: 8 * 1024 * 1024,
  });
  const { db, config } = options;
  const auth = new AuthService(db, config, options.appleVerifier),
    sync = new SyncService(db),
    profile = new ProfileService(db),
    community = new CommunityService(db),
    generation = new GenerationService(db, config.dailyGenerationCards);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'Request does not match the versioned contract.',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    if (error instanceof DomainError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 413)
      return reply.code(413).send({
        error: {
          code: 'payload_too_large',
          message: 'Split this import into smaller reviewable batches.',
        },
      });
    if (status >= 400 && status < 500)
      return reply
        .code(status)
        .send({ error: { code: 'invalid_request', message: 'Request could not be processed.' } });
    request.log.error(
      { code: (error as { code?: string }).code, name: (error as Error).name },
      'Request failed',
    );
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'The operation did not complete. Retry with the same operation ID.',
      },
    });
  });
  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', service: 'recollect-api' };
  });
  app.get('/ping', async () => ({ status: 'ok' }));
  // Legacy writers are deliberately gated until a recovery-capable client is released.
  app.all('/api/*', async (_request, reply) =>
    reply.code(426).send({
      error: {
        code: 'upgrade_required',
        message:
          'This endpoint requires the recovery-capable Recollect client. Existing local data must be preserved.',
      },
    }),
  );
  await auth.routes(app);
  await app.register(async (secured) => {
    secured.addHook('preHandler', (request) => auth.authenticate(request));
    secured.addHook('preHandler', async (request) => {
      if (request.headers['x-recollect-scheduler'] === ALGORITHM_VERSION) return;
      // v1 clients decode strict schedule contracts. They can keep using their
      // account until a v2 review exists, then must update before writing v1
      // schedules or receiving data they cannot decode. Their outbox stays local.
      const upgraded = await db.query(
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM recollect.cards WHERE owner_id=$1
          AND data->'schedule'->>'algorithmVersion'=$2)
         OR EXISTS (SELECT 1 FROM recollect.review_events WHERE owner_id=$1
          AND data->>'algorithmVersion'=$2)`,
        [request.identity!.ownerId, ALGORITHM_VERSION],
      );
      if (upgraded.rowCount)
        throw new DomainError(
          'upgrade_required',
          'Update Recollect in TestFlight to sync the new review schedule. Your cards and queued changes are saved on this device.',
          426,
        );
    });
    secured.get('/v1/profile', (request) => profile.get(request.identity!.ownerId));
    secured.patch('/v1/profile', (request) =>
      profile.update(request.identity!.ownerId, request.body),
    );
    secured.get('/v1/insights', (request) =>
      community.ownInsights(request.identity!.ownerId, request.query),
    );
    secured.get('/v1/community', (request) => community.overview(request.identity!.ownerId));
    secured.post('/v1/community/invites', (request) =>
      community.createInvite(request.identity!.ownerId),
    );
    secured.post('/v1/community/invites/accept', (request) =>
      community.acceptInvite(request.identity!.ownerId, request.body),
    );
    secured.delete('/v1/community/friends/:id', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.removeFriend(request.identity!.ownerId, id);
    });
    secured.get('/v1/community/friends/:id/insights', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.friendInsights(request.identity!.ownerId, id, request.query);
    });
    secured.post('/v1/community/shares', (request) =>
      community.createShare(request.identity!.ownerId, request.body),
    );
    secured.get('/v1/community/shares/:id', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.detail(request.identity!.ownerId, id);
    });
    secured.post('/v1/community/shares/:id/accept', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.acceptShare(request.identity!.ownerId, id, request.body);
    });
    secured.patch('/v1/community/shares/:id/progress', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.setProgress(request.identity!.ownerId, id, request.body);
    });
    secured.delete('/v1/community/shares/:id', (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return community.revokeShare(request.identity!.ownerId, id);
    });
    secured.get('/v1/community/shares/:id/insights/:userId', (request) => {
      const { id, userId } = z.object({ id: z.uuid(), userId: z.uuid() }).parse(request.params);
      return community.shareInsights(request.identity!.ownerId, id, userId, request.query);
    });
    secured.get('/v1/me', async (request) => (await sync.snapshot(request.identity!.ownerId)).user);
    secured.get('/v1/snapshot', (request) => sync.snapshot(request.identity!.ownerId));
    secured.get('/v1/sync/snapshot', (request) => sync.snapshot(request.identity!.ownerId));
    secured.post('/v1/sync/push', (request) =>
      sync.push(request.identity!.ownerId, pushRequestSchema.parse(request.body).operations),
    );
    secured.get('/v1/sync/pull', (request) => {
      const q = z
        .object({
          cursor: revisionSchema.default('0'),
          until: revisionSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        })
        .strict()
        .parse(request.query);
      return sync.pull(request.identity!.ownerId, q.cursor, q.until, q.limit);
    });
    secured.get('/v1/decks', async (request) => ({
      decks: (await sync.snapshot(request.identity!.ownerId)).decks.filter((d) => !d.deletedAt),
    }));
    secured.get('/v1/decks/:id/cards', async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params),
        snapshot = await sync.snapshot(request.identity!.ownerId);
      if (!snapshot.decks.some((d) => d.id === id && !d.deletedAt))
        throw new DomainError('not_found', 'Deck not found.', 404);
      return { cards: snapshot.cards.filter((c) => c.deckId === id && !c.deletedAt) };
    });
    // Direct command aliases share exactly the same receipts and transactions as sync.
    for (const [path, kind] of [
      ['/v1/decks/commands', 'deck'],
      ['/v1/cards/commands', 'card'],
    ] as const)
      secured.post(path, async (request) => {
        const op = syncOperationSchema.parse(request.body);
        if (!op.type.startsWith(kind + '.'))
          throw new DomainError('invalid_operation', 'Command type does not match the route.');
        return sync.push(request.identity!.ownerId, [op]);
      });
    secured.get('/v1/progress', async (request) => {
      const q = z.object({ timezone: z.string().max(100).default('UTC') }).parse(request.query);
      let format: Intl.DateTimeFormat;
      try {
        format = new Intl.DateTimeFormat('en-CA', {
          timeZone: q.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      } catch {
        throw new DomainError('invalid_timezone', 'Use a valid IANA timezone.');
      }
      const s = await sync.snapshot(request.identity!.ownerId),
        now = Date.now();
      const activeDecks = s.decks.filter((d) => !d.deletedAt),
        dueDecks = new Set(
          activeDecks
            .filter(
              (d) =>
                !d.isSilenced || Boolean(d.silencedUntil && Date.parse(d.silencedUntil) <= now),
            )
            .map((d) => d.id),
        );
      const active = s.cards.filter(
        (c) => !c.deletedAt && activeDecks.some((d) => d.id === c.deckId),
      );
      const dayMap = new Map<
        string,
        { date: string; reviews: number; selfRatedRecalled: number; elapsedMs: number }
      >();
      for (const r of s.reviews) {
        const date = format.format(new Date(r.reviewedAt));
        const row = dayMap.get(date) ?? { date, reviews: 0, selfRatedRecalled: 0, elapsedMs: 0 };
        row.reviews++;
        if (r.rating !== 'again') row.selfRatedRecalled++;
        row.elapsedMs += r.elapsedMs;
        dayMap.set(date, row);
      }
      return {
        totalDecks: activeDecks.length,
        totalCards: active.length,
        dueCards: active.filter(
          (c) => dueDecks.has(c.deckId) && Date.parse(c.schedule.dueAt) <= now,
        ).length,
        totalReviews: active.reduce((n, c) => n + c.schedule.totalReviews, 0),
        recordedReviewEvents: s.reviews.length,
        timezone: q.timezone,
        daily: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
        historyIncludesImportedCheckpoints: true,
      };
    });
    secured.post('/v1/generations', async (request, reply) => {
      const job = await generation.create(
        request.identity!.ownerId,
        generationRequestSchema.parse(request.body),
      );
      request.log.info(generationLog(job), 'Generation request accepted');
      return reply.code(202).send(job);
    });
    secured.get('/v1/generations/:id', async (request) => {
      const job = await generation.get(
        request.identity!.ownerId,
        z.object({ id: z.uuid() }).parse(request.params).id,
      );
      request.log.info(generationLog(job), 'Generation status checked');
      return job;
    });
    secured.delete('/v1/generations/:id', (request) =>
      generation.cancel(
        request.identity!.ownerId,
        z.object({ id: z.uuid() }).parse(request.params).id,
      ),
    );
    secured.post('/v1/generations/:id/accept', (request) =>
      generation.accept(
        request.identity!.ownerId,
        z.object({ id: z.uuid() }).parse(request.params).id,
        generationAcceptSchema.parse(request.body),
      ),
    );
    secured.post('/v1/imports', (request) =>
      importDevice(
        db,
        request.identity!.ownerId,
        request.identity!.sessionId,
        importRequestSchema.parse(request.body),
      ),
    );
  });
  await app.ready();
  return app;
}
