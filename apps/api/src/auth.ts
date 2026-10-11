import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Session, User } from '@recollect/contracts';
import {
  DomainError,
  secretHash,
  transaction,
  type Database,
  type Transaction,
} from '@recollect/db';
import type { ApiConfig } from './config.js';

export type AppleClaims = { sub: string; nonce: string; email?: string };
export type AppleVerifier = (token: string, audience: string) => Promise<AppleClaims>;
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export const verifyApple: AppleVerifier = async (token, audience) => {
  const { payload } = await jwtVerify(token, appleKeys, {
    issuer: 'https://appleid.apple.com',
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  });
  if (typeof payload.sub !== 'string' || typeof payload.nonce !== 'string')
    throw new Error('Missing Apple identity claims');
  return {
    sub: payload.sub,
    nonce: payload.nonce,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
  };
};
declare module 'fastify' {
  interface FastifyRequest {
    identity?: { ownerId: string; sessionId: string };
  }
}
export class AuthService {
  constructor(
    readonly db: Database,
    readonly config: ApiConfig,
    readonly appleVerifier: AppleVerifier = verifyApple,
  ) {
    if (config.production && config.enableDevAuth)
      throw new Error('Development authentication cannot run in production.');
    if (config.accessSecret.length < 32)
      throw new Error('A dedicated strong access signing secret is required.');
  }
  async issue(tx: Transaction, user: User, familyId: string = randomUUID()): Promise<Session> {
    await tx.query(
      'INSERT INTO recollect.session_families(id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [familyId, user.id],
    );
    const family = (
      await tx.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM recollect.session_families WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [familyId, user.id],
      )
    ).rows[0];
    if (!family || family.revoked_at)
      throw new DomainError('invalid_refresh', 'Session family was revoked.', 401);
    const sessionId = randomUUID();
    const refreshToken = sessionId + '.' + randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000),
      exp = now + this.config.accessTtlSeconds;
    await tx.query(
      'INSERT INTO recollect.sessions(id,owner_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)',
      [
        sessionId,
        user.id,
        familyId,
        secretHash(refreshToken),
        new Date((now + this.config.refreshTtlSeconds) * 1000),
      ],
    );
    const accessToken = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer('recollect-v1')
      .setAudience('recollect-app')
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(this.config.accessSecret));
    return { accessToken, refreshToken, expiresAt: new Date(exp * 1000).toISOString(), user };
  }
  async authenticate(request: FastifyRequest): Promise<void> {
    const value = request.headers.authorization;
    if (!value?.startsWith('Bearer '))
      throw new DomainError('unauthorized', 'Sign in is required.', 401);
    let ownerId: string, sessionId: string;
    try {
      const { payload } = await jwtVerify(
        value.slice(7),
        new TextEncoder().encode(this.config.accessSecret),
        {
          issuer: 'recollect-v1',
          audience: 'recollect-app',
          algorithms: ['HS256'],
          requiredClaims: ['exp', 'iat', 'sub', 'sid'],
        },
      );
      ownerId = z.uuid().parse(payload.sub);
      sessionId = z.uuid().parse(payload.sid);
    } catch {
      throw new DomainError('unauthorized', 'Session expired or revoked. Sign in again.', 401);
    }
    // Infrastructure failures remain retriable server errors; they must not cause clients to erase valid credentials.
    const row = await this.db.query(
      'SELECT 1 FROM recollect.sessions s JOIN recollect.session_families f ON f.id=s.family_id JOIN recollect.users u ON u.id=s.owner_id WHERE s.id=$1 AND s.owner_id=$2 AND s.revoked_at IS NULL AND f.revoked_at IS NULL AND s.expires_at>now() AND u.is_active=true',
      [sessionId, ownerId],
    );
    if (!row.rowCount)
      throw new DomainError('unauthorized', 'Session expired or revoked. Sign in again.', 401);
    request.identity = { ownerId, sessionId };
  }
  async throttle(scope: string, limit: number): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const r = await this.db.query<{ count: number }>(
      'INSERT INTO recollect.rate_buckets(scope,bucket,count) VALUES($1,$2,1) ON CONFLICT(scope,bucket) DO UPDATE SET count=recollect.rate_buckets.count+1 RETURNING count',
      [scope, bucket],
    );
    if (r.rows[0]!.count > limit)
      throw new DomainError('rate_limited', 'Too many requests; retry in a minute.', 429);
  }
  async routes(app: FastifyInstance): Promise<void> {
    app.post('/v1/auth/apple/challenge', async (request) => {
      await this.throttle('challenge:' + secretHash(request.ip), 20);
      const challengeId = randomUUID(),
        nonce = randomBytes(32).toString('base64url'),
        expiresAt = new Date(Date.now() + 300_000).toISOString();
      await this.db.query(
        'INSERT INTO recollect.auth_challenges(id,nonce_hash,expires_at) VALUES($1,$2,$3)',
        [challengeId, secretHash(nonce), expiresAt],
      );
      return { challengeId, nonce, expiresAt };
    });
    app.post('/v1/auth/apple', async (request) => {
      const body = z
        .object({
          challengeId: z.uuid(),
          identityToken: z.string().min(20).max(20000),
          displayName: z.string().max(100).optional(),
        })
        .strict()
        .parse(request.body);
      await this.throttle('signin:' + secretHash(request.ip), 20);
      let claims: AppleClaims;
      try {
        claims = await this.appleVerifier(body.identityToken, this.config.appleAudience);
      } catch {
        throw new DomainError('invalid_apple_token', 'Apple identity could not be verified.', 401);
      }
      return transaction(this.db, async (tx) => {
        const r = await tx.query<{
          nonce_hash: string;
          expires_at: Date;
          consumed_at: Date | null;
        }>('SELECT * FROM recollect.auth_challenges WHERE id=$1 FOR UPDATE', [body.challengeId]);
        const challenge = r.rows[0];
        if (
          !challenge ||
          challenge.consumed_at ||
          challenge.expires_at.getTime() <= Date.now() ||
          claims.nonce !== challenge.nonce_hash
        )
          throw new DomainError(
            'invalid_challenge',
            'Apple challenge expired, mismatched or already used.',
            401,
          );
        await tx.query('UPDATE recollect.auth_challenges SET consumed_at=now() WHERE id=$1', [
          body.challengeId,
        ]);
        let found = (
          await tx.query<User & { is_active: boolean }>(
            'SELECT id,email,name,is_active FROM recollect.users WHERE apple_id=$1',
            [claims.sub],
          )
        ).rows[0];
        if (found && !found.is_active)
          throw new DomainError(
            'account_inactive',
            'Account is inactive; use account recovery.',
            403,
          );
        let user: User | undefined = found
          ? { id: found.id, email: found.email, name: found.name }
          : undefined;
        if (!user) {
          // Stable legacy UUID reuse relies only on a freshly verified Apple subject, never email or an old JWT.
          const exists = (
            await tx.query<{ present: string | null }>(
              "SELECT to_regclass('public.users')::text AS present",
            )
          ).rows[0]?.present;
          const legacy = exists
            ? (
                await tx.query<User & { is_active: boolean }>(
                  'SELECT id,email,name,is_active FROM public.users WHERE apple_id=$1',
                  [claims.sub],
                )
              ).rows[0]
            : undefined;
          if (legacy && !legacy.is_active)
            throw new DomainError(
              'account_inactive',
              'Legacy account is inactive; use account recovery.',
              403,
            );
          const created: User = legacy
            ? { id: legacy.id, email: legacy.email, name: legacy.name }
            : {
                id: randomUUID(),
                email: claims.email ?? null,
                name: body.displayName?.trim() || 'Learner',
              };
          user = (
            await tx.query<User>(
              'INSERT INTO recollect.users(id,apple_id,email,name) VALUES($1,$2,$3,$4) ON CONFLICT(apple_id) DO UPDATE SET apple_id=excluded.apple_id RETURNING id,email,name',
              [created.id, claims.sub, created.email, created.name],
            )
          ).rows[0]!;
        }
        return this.issue(tx, user);
      });
    });
    app.post('/v1/auth/refresh', async (request) => {
      const { refreshToken } = z
        .object({ refreshToken: z.string().min(40).max(200) })
        .strict()
        .parse(request.body);
      await this.throttle('refresh:' + secretHash(request.ip), 60);
      const result = await transaction(this.db, async (tx) => {
        const lookup = (
          await tx.query<{ family_id: string }>(
            'SELECT family_id FROM recollect.sessions WHERE token_hash=$1',
            [secretHash(refreshToken)],
          )
        ).rows[0];
        if (!lookup) return null;
        const family = (
          await tx.query<{ revoked_at: Date | null }>(
            'SELECT revoked_at FROM recollect.session_families WHERE id=$1 FOR UPDATE',
            [lookup.family_id],
          )
        ).rows[0];
        if (!family || family.revoked_at) return null;
        const row = (
          await tx.query<{
            id: string;
            owner_id: string;
            family_id: string;
            used_at: Date | null;
            revoked_at: Date | null;
            expires_at: Date;
          }>('SELECT * FROM recollect.sessions WHERE token_hash=$1 FOR UPDATE', [
            secretHash(refreshToken),
          ])
        ).rows[0];
        if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now()) return null;
        if (row.used_at) {
          await tx.query('UPDATE recollect.session_families SET revoked_at=now() WHERE id=$1', [
            row.family_id,
          ]);
          await tx.query('UPDATE recollect.sessions SET revoked_at=now() WHERE family_id=$1', [
            row.family_id,
          ]);
          return null;
        }
        await tx.query('UPDATE recollect.sessions SET used_at=now() WHERE id=$1', [row.id]);
        const user = (
          await tx.query<User>(
            'SELECT id,email,name FROM recollect.users WHERE id=$1 AND is_active=true',
            [row.owner_id],
          )
        ).rows[0];
        if (!user) return null;
        return this.issue(tx, user, row.family_id);
      });
      if (!result)
        throw new DomainError(
          'invalid_refresh',
          'Refresh token expired, revoked or reused. Sign in again.',
          401,
        );
      return result;
    });
    app.post(
      '/v1/auth/logout',
      { preHandler: (request) => this.authenticate(request) },
      async (request, reply) => {
        await transaction(this.db, async (tx) => {
          const row = (
            await tx.query<{ family_id: string }>(
              'SELECT family_id FROM recollect.sessions WHERE id=$1',
              [request.identity!.sessionId],
            )
          ).rows[0]!;
          await tx.query('SELECT id FROM recollect.session_families WHERE id=$1 FOR UPDATE', [
            row.family_id,
          ]);
          await tx.query('UPDATE recollect.session_families SET revoked_at=now() WHERE id=$1', [
            row.family_id,
          ]);
          await tx.query('UPDATE recollect.sessions SET revoked_at=now() WHERE family_id=$1', [
            row.family_id,
          ]);
        });
        return reply.code(204).send();
      },
    );
    if (this.config.enableDevAuth)
      app.post('/v1/auth/development', async (request) => {
        const body = z
          .object({ email: z.email(), name: z.string().min(1).max(100).optional() })
          .strict()
          .parse(request.body);
        return transaction(this.db, async (tx) => {
          const email = body.email.toLowerCase();
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['recollect-dev:' + email]);
          let user = (
            await tx.query<User>(
              'SELECT id,email,name FROM recollect.users WHERE email=$1 AND apple_id IS NULL AND is_active=true',
              [email],
            )
          ).rows[0];
          if (!user)
            user = (
              await tx.query<User>(
                'INSERT INTO recollect.users(id,email,name) VALUES($1,$2,$3) RETURNING id,email,name',
                [randomUUID(), email, body.name ?? 'Development user'],
              )
            ).rows[0]!;
          return this.issue(tx, user);
        });
      });
  }
}
